import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type Scope = {
  storeId: string;
  role: "submit" | "receive";
  receiveInstallationId?: string;
};
type RelayRequest = {
  id: string;
  storeId: string;
  terminalId: string;
  kind: "pair" | "rpc";
  method: string;
  params: unknown;
  sessionId?: string;
  sessionHash?: string;
  createdAt: number;
  expiresAt: number;
  result?: unknown;
  error?: RelayError;
  dedupeKey?: string;
  payloadHash?: string;
  pairReceiptHash?: string;
  receiptConsumed?: boolean;
};
type Challenge = { storeId: string; terminalId: string; expiresAt: number };
type Session = { storeId: string; terminalId: string; expiresAt: number };
type RelayError = { code: string; message?: string };
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const MAX_BODY = 64 * 1024;
const MAX_RESPONSE = 512 * 1024;
const QUEUE_LIMIT = 32;
const STORE_REQUEST_LIMIT = 64;
const TOTAL_REQUEST_LIMIT = 512;
const QUEUE_TTL_MS = 120_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const RPC_METHODS = new Set([
  "waiter.getState",
  "waiter.submitBatch",
  "waiter.getBatch",
  "waiter.revoke",
]);

function send(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}
function fail(status: number, code: string): never {
  throw Object.assign(new Error(code), { status, code });
}
async function body(
  req: IncomingMessage,
  limit = MAX_BODY,
): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? ""))
    fail(415, "unsupported_media_type");
  if (Number(req.headers["content-length"]) > limit) {
    req.resume();
    fail(413, "too_large");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) fail(413, "too_large");
    chunks.push(Buffer.from(part));
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v))
      fail(400, "bad_request");
    return v as Record<string, unknown>;
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    fail(400, "bad_request");
  }
}
function bearer(req: IncomingMessage) {
  const h = req.headers.authorization;
  if (typeof h !== "string") return undefined;
  return /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(h)?.[1];
}
function validId(v: unknown): v is string {
  return typeof v === "string" && ID.test(v);
}
function validRelayError(v: unknown): v is RelayError {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return (
    Object.keys(e).every((k) => k === "code" || k === "message") &&
    typeof e.code === "string" &&
    /^[A-Za-z0-9_-]{1,80}$/.test(e.code) &&
    (e.message === undefined ||
      (typeof e.message === "string" && e.message.length <= 160))
  );
}

/** Short-lived, RAM-only bridge. It deliberately does not write mobile payloads, PINs, or session tokens to disk/logs. */
export class WaiterRelay {
  private readonly publicBaseUrl: string;
  private challenges = new Map<string, Challenge>();
  private requests = new Map<string, RelayRequest>();
  private sessions = new Map<string, Session>();
  private rates = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly authenticateTerminal: (token: string) => Scope | undefined,
    publicBaseUrl: string,
    private readonly waiterHtml: string,
  ) {
    const base = new URL(publicBaseUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      base.hostname.toLowerCase(),
    );
    if (
      (base.protocol !== "https:" &&
        !(base.protocol === "http:" && loopback)) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      throw new Error("Invalid waiter public URL");
    this.publicBaseUrl = `${base.origin}/`;
  }
  private sweep(now = Date.now()) {
    for (const [k, v] of this.challenges)
      if (v.expiresAt <= now) this.challenges.delete(k);
    for (const [k, v] of this.requests)
      if (v.expiresAt <= now) this.requests.delete(k);
    for (const [k, v] of this.sessions)
      if (v.expiresAt <= now) this.sessions.delete(k);
    for (const [k, v] of this.rates) if (v.reset <= now) this.rates.delete(k);
  }
  private rate(key: string, cap: number, windowMs = 60_000) {
    const now = Date.now();
    this.sweep(now);
    let r = this.rates.get(key);
    if (!r && this.rates.size >= 10_000) fail(429, "rate_limited");
    if (!r || r.reset <= now) {
      r = { count: 0, reset: now + windowMs };
      this.rates.set(key, r);
    }
    if (++r.count > cap) fail(429, "rate_limited");
  }
  private terminal(req: IncomingMessage, storeId?: string): Scope {
    const token = bearer(req);
    const scope = token ? this.authenticateTerminal(token) : undefined;
    if (
      !scope ||
      scope.role !== "receive" ||
      (storeId && storeId !== scope.storeId)
    )
      fail(401, "unauthorized");
    if (
      scope.receiveInstallationId &&
      req.headers["x-pos-installation"] !== scope.receiveInstallationId
    )
      fail(401, "unauthorized");
    return scope;
  }
  private session(req: IncomingMessage): {
    token: string;
    hash: string;
    value: Session;
  } {
    const token = bearer(req);
    const hash = token ? digest(token) : "";
    const value = this.sessions.get(hash);
    if (!token || !value || value.expiresAt <= Date.now())
      fail(401, "unauthorized");
    return { token, hash, value };
  }
  private add(
    req: Omit<RelayRequest, "id" | "createdAt" | "expiresAt">,
  ): RelayRequest {
    this.sweep();
    if (
      this.requests.size >= TOTAL_REQUEST_LIMIT ||
      [...this.requests.values()].filter((x) => x.storeId === req.storeId)
        .length >= STORE_REQUEST_LIMIT
    )
      fail(429, "queue_full");
    const count = [...this.requests.values()].filter(
      (x) =>
        x.storeId === req.storeId &&
        x.result === undefined &&
        !x.error &&
        !x.receiptConsumed,
    ).length;
    if (count >= QUEUE_LIMIT) fail(429, "queue_full");
    const now = Date.now();
    const entry: RelayRequest = {
      ...req,
      id: randomUUID(),
      createdAt: now,
      expiresAt: now + QUEUE_TTL_MS,
    };
    this.requests.set(entry.id, entry);
    return entry;
  }
  private requestStatus(id: string) {
    const r = this.requests.get(id);
    if (!r || r.expiresAt <= Date.now()) return { status: "expired" };
    if (r.receiptConsumed) return { status: "expired" };
    return r.error
      ? { status: "failed", error: r.error }
      : r.result !== undefined
        ? { status: "completed", result: r.result }
        : { status: "pending" };
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    method: string,
  ): Promise<boolean> {
    this.sweep();
    if (
      (pathname === "/waiter" ||
        pathname === "/waiter/" ||
        pathname.startsWith("/v1/waiter/")) &&
      (req.headers.host ?? "").toLowerCase() !==
        new URL(this.publicBaseUrl).host.toLowerCase()
    )
      fail(403, "forbidden");
    if (pathname === "/waiter" || pathname === "/waiter/") {
      if (method !== "GET" && method !== "HEAD") fail(404, "not_found");
      const inlineScripts = [
        ...this.waiterHtml.matchAll(
          /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi,
        ),
      ].map(
        (m) =>
          `'sha256-${createHash("sha256")
            .update(m[1] ?? "")
            .digest("base64")}'`,
      );
      const data = Buffer.from(this.waiterHtml);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": data.length,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' ${inlineScripts.join(" ")}; base-uri 'none'; frame-ancestors 'none'`,
      });
      if (method === "HEAD") res.end();
      else res.end(data);
      return true;
    }
    if (!pathname.startsWith("/v1/waiter/")) return false;
    // Browser APIs are same-origin only; native POS requests omit Origin.
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== new URL(this.publicBaseUrl).origin)
      fail(403, "forbidden");
    if (method === "POST" && pathname === "/v1/waiter/invitations") {
      const b = await body(req);
      const scope = this.terminal(req);
      if (
        Object.keys(b).length !== 1 ||
        typeof b.challengeId !== "string" ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(b.challengeId)
      )
        fail(400, "bad_request");
      if (!scope.receiveInstallationId) fail(401, "unauthorized");
      this.rate(
        `invite:${scope.storeId}:${scope.receiveInstallationId ?? scope.storeId}`,
        10,
      );
      if (!this.challenges.has(b.challengeId) && this.challenges.size >= 10_000)
        fail(429, "queue_full");
      const terminalId = scope.receiveInstallationId;
      const now = Date.now();
      this.challenges.set(b.challengeId, {
        storeId: scope.storeId,
        terminalId,
        expiresAt: now + QUEUE_TTL_MS,
      });
      const u = new URL("waiter", this.publicBaseUrl);
      u.hash = new URLSearchParams({
        tenant: scope.storeId,
        terminal: terminalId,
        challenge: b.challengeId,
      }).toString();
      return (
        send(res, 201, {
          inviteUrl: u.toString(),
          challengeId: b.challengeId,
          expiresAt: new Date(now + QUEUE_TTL_MS).toISOString(),
        }),
        true
      );
    }
    if (method === "POST" && pathname === "/v1/waiter/pair") {
      const b = await body(req);
      if (
        Object.keys(b).some(
          (k) => !["tenantId", "terminalId", "challengeId", "pin"].includes(k),
        ) ||
        !validId(b.tenantId) ||
        !validId(b.terminalId) ||
        typeof b.challengeId !== "string" ||
        typeof b.pin !== "string" ||
        !/^\d{4,8}$/.test(b.pin)
      )
        fail(400, "bad_request");
      this.rate(`pair-global`, 500, 60_000);
      this.rate(`pair-tenant:${b.tenantId}`, 30, 60_000);
      const c = this.challenges.get(b.challengeId);
      if (
        !c ||
        c.storeId !== b.tenantId ||
        c.terminalId !== b.terminalId ||
        c.expiresAt <= Date.now()
      )
        fail(401, "pairing_expired");
      this.challenges.delete(b.challengeId);
      const entry = this.add({
        storeId: c.storeId,
        terminalId: c.terminalId,
        kind: "pair",
        method: "waiter.pair",
        params: { challengeId: b.challengeId, pin: b.pin },
        pairReceiptHash: digest(b.challengeId),
      });
      return (send(res, 202, { requestId: entry.id }), true);
    }
    const pair = /^\/v1\/waiter\/pair\/([0-9a-f-]{36})$/.exec(pathname);
    if (method === "GET" && pair) {
      const r = this.requests.get(pair[1]!);
      if (!r || r.kind !== "pair") fail(404, "not_found");
      if (
        typeof req.headers["x-waiter-challenge"] !== "string" ||
        digest(req.headers["x-waiter-challenge"] as string) !==
          r.pairReceiptHash
      )
        fail(401, "unauthorized");
      const status = this.requestStatus(pair[1]!);
      send(res, 200, status);
      if (status.status === "completed") {
        r.result = undefined;
        r.receiptConsumed = true;
      }
      return true;
    }
    if (method === "GET" && pathname === "/v1/waiter/terminal/requests") {
      const scope = this.terminal(req);
      if (!scope.receiveInstallationId) fail(401, "unauthorized");
      const terminalId = scope.receiveInstallationId;
      const requests = [...this.requests.values()]
        .filter(
          (x) =>
            x.storeId === scope.storeId &&
            x.terminalId === terminalId &&
            x.result === undefined &&
            !x.error &&
            !x.receiptConsumed &&
            x.expiresAt > Date.now(),
        )
        .map((x) => ({
          requestId: x.id,
          kind: x.kind,
          ...(x.sessionId ? { sessionId: x.sessionId } : {}),
          method: x.method,
          params: x.params,
          createdAt: new Date(x.createdAt).toISOString(),
          expiresAt: new Date(x.expiresAt).toISOString(),
        }));
      return (send(res, 200, { requests }), true);
    }
    const response =
      /^\/v1\/waiter\/terminal\/requests\/([0-9a-f-]{36})\/response$/.exec(
        pathname,
      );
    if (method === "POST" && response) {
      const current = this.requests.get(response[1]!);
      if (!current) fail(404, "not_found");
      const scope = this.terminal(req, current.storeId);
      if (!scope.receiveInstallationId) fail(401, "unauthorized");
      const terminalId = scope.receiveInstallationId;
      if (current.terminalId !== terminalId) fail(404, "not_found");
      if (current.result !== undefined || current.error)
        return (send(res, 200, { ok: true }), true);
      const b = await body(req, MAX_RESPONSE);
      if (
        Object.keys(b).some((k) => !["result", "error"].includes(k)) ||
        (b.error !== undefined && !validRelayError(b.error)) ||
        (b.result !== undefined &&
          Buffer.byteLength(JSON.stringify(b.result)) > MAX_RESPONSE)
      )
        fail(400, "bad_request");
      if (b.error === undefined && b.result === undefined)
        fail(400, "bad_request");
      if (b.error !== undefined) current.error = b.error as RelayError;
      else {
        current.result = b.result;
        if (current.kind === "pair") {
          const result = b.result as {
            sessionToken?: unknown;
            expiresAt?: unknown;
          };
          if (
            typeof result?.sessionToken !== "string" ||
            result.sessionToken.length < 32 ||
            result.sessionToken.length > 256
          ) {
            current.result = undefined;
            current.error = { code: "pair_failed" };
          } else
            this.sessions.set(digest(result.sessionToken), {
              storeId: current.storeId,
              terminalId: current.terminalId,
              expiresAt: Math.min(
                Date.now() + SESSION_TTL_MS,
                typeof result.expiresAt === "string" &&
                  Number.isFinite(Date.parse(result.expiresAt))
                  ? Date.parse(result.expiresAt)
                  : Date.now() + SESSION_TTL_MS,
              ),
            });
        }
      }
      current.params = null;
      current.sessionId = undefined;
      if (
        current.sessionHash &&
        (current.method === "waiter.revoke" ||
          (current.error &&
            ["unauthorized", "session_revoked"].includes(current.error.code)))
      )
        this.sessions.delete(current.sessionHash);
      return (send(res, 200, { ok: true }), true);
    }
    if (method === "POST" && pathname === "/v1/waiter/rpc") {
      const s = this.session(req);
      const b = await body(req);
      if (
        Object.keys(b).some(
          (k) => !["requestId", "method", "params"].includes(k),
        ) ||
        typeof b.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(b.requestId) ||
        typeof b.method !== "string" ||
        !RPC_METHODS.has(b.method) ||
        b.params === undefined ||
        Buffer.byteLength(JSON.stringify(b.params)) > MAX_BODY
      )
        fail(400, "bad_request");
      this.rate(`session:${s.hash}`, 60);
      const dedupeKey = `${s.hash}:${b.requestId}`;
      const payloadHash = digest(
        JSON.stringify({ method: b.method, params: b.params }),
      );
      const existing = [...this.requests.values()].find(
        (x) => x.dedupeKey === dedupeKey,
      );
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          fail(409, "idempotency_conflict");
        return (send(res, 202, { requestId: existing.id }), true);
      }
      const entry = this.add({
        storeId: s.value.storeId,
        terminalId: s.value.terminalId,
        kind: "rpc",
        method: b.method,
        params: b.params,
        sessionId: s.token,
        sessionHash: s.hash,
        dedupeKey,
        payloadHash,
      });
      return (send(res, 202, { requestId: entry.id }), true);
    }
    const rpcStatus = /^\/v1\/waiter\/requests\/([0-9a-f-]{36})$/.exec(
      pathname,
    );
    if (method === "GET" && rpcStatus) {
      const s = this.session(req);
      const r = this.requests.get(rpcStatus[1]!);
      if (!r || r.sessionHash !== s.hash) fail(404, "not_found");
      return (send(res, 200, this.requestStatus(r.id)), true);
    }
    return (send(res, 404, { error: "not_found" }), true);
  }
  close() {
    this.challenges.clear();
    this.requests.clear();
    this.sessions.clear();
    this.rates.clear();
  }
}
