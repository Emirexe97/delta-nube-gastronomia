import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createPublicKey,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  devicePublicKeyFingerprint,
  signLease,
  verifyLease,
  verifyDeviceProof,
  GRACE_MS,
  type LicenseLease,
  type DeviceProof,
} from "@gastronomy/licensing";
import { verifyPanelPassword } from "./panel-auth.js";

const MAX_BODY = 16 * 1024;
type Env = {
  dbPath: string;
  adminToken: string;
  privateKey: string;
  rateLimit?: number;
  panelAuth?: {
    username: string;
    passwordHash: string;
    origin: string;
    secureCookies?: boolean;
  };
};
type LicenseRow = {
  id: string;
  business_name: string;
  paid_through: string;
  revision: number;
  status: "ACTIVE" | "SUSPENDED";
  activation_hash: string;
  installation_id: string | null;
};
type RateEntry = { count: number; reset: number; blockedUntil: number };
type DeviceStatus = "PENDING" | "APPROVED" | "REJECTED";
type DeviceRequestRow = {
  id: string;
  installation_id: string;
  business_name: string;
  key_fingerprint: string;
  public_key: string;
  status: DeviceStatus;
  license_id: string | null;
  created_at: string;
};
type ChallengeRow = {
  id: string;
  nonce: string;
  installation_id: string;
  key_fingerprint: string;
  public_key: string;
  purpose: "request" | "lease";
  expires_at: string;
  used_at: string | null;
};
type PanelSessionRow = {
  username: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
};
const CHALLENGE_TTL_MS = 2 * 60_000;
const PANEL_SESSION_TTL_MS = 8 * 60 * 60_000;
const MAX_LIVE_CHALLENGES = 10_000;
const MAX_DEVICE_REQUESTS = 10_000;
const DEVICE_REQUEST_TTL_MS = 7 * 24 * 60 * 60_000;
const OWNER_COOKIE = "dng_owner";

function canonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return false;
  const millis = Date.parse(value);
  return (
    new Date(millis).toISOString() === value &&
    Number.isFinite(millis + GRACE_MS) &&
    millis + GRACE_MS <= 8.64e15
  );
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function json(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(data);
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > MAX_BODY)
      throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(b);
  }
  if (!chunks.length)
    throw Object.assign(new Error("Body required"), { status: 400 });
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}
function validId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(v);
}

export function createLicenseServer(
  env: Env,
  suppliedDb?: DatabaseSync,
): { server: Server; close: () => void } {
  if (Buffer.byteLength(env.adminToken) < 32)
    throw new Error("ADMIN_TOKEN must be at least 32 bytes");
  if (!env.dbPath || !env.dbPath.match(/^(?:[A-Za-z]:\\|\\\\|\/)/))
    throw new Error("DB_PATH must be absolute");
  if (env.panelAuth) {
    const { username, passwordHash, origin } = env.panelAuth;
    let parsedOrigin: URL | undefined;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error("PANEL_ORIGIN must be an exact HTTP(S) origin");
    }
    const localHttp =
      parsedOrigin.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
    if (
      !username ||
      username.length > 128 ||
      !/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(passwordHash) ||
      parsedOrigin.origin !== origin ||
      (parsedOrigin.protocol !== "https:" && !localHttp) ||
      (env.panelAuth.secureCookies !== undefined &&
        typeof env.panelAuth.secureCookies !== "boolean")
    )
      throw new Error("Invalid owner panel configuration");
  }
  const db = suppliedDb ?? new DatabaseSync(env.dbPath);
  const schema = `
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY, business_name TEXT NOT NULL, paid_through TEXT NOT NULL,
      revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED')),
      activation_hash TEXT NOT NULL UNIQUE, installation_id TEXT UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS renewals (
      idempotency_key TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id),
      paid_through TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_challenges (
      id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, installation_id TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL, public_key TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(purpose IN ('request','lease')),
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS device_challenges_expiry ON device_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS device_requests (
      id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, business_name TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
      license_id TEXT REFERENCES licenses(id), created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_request_per_device_key
      ON device_requests(installation_id, key_fingerprint);
    CREATE UNIQUE INDEX IF NOT EXISTS one_approved_device_per_installation
      ON device_requests(installation_id) WHERE status = 'APPROVED';
    CREATE INDEX IF NOT EXISTS device_requests_created ON device_requests(created_at DESC);
    CREATE INDEX IF NOT EXISTS device_requests_expiry ON device_requests(status,updated_at);
    CREATE TABLE IF NOT EXISTS panel_sessions (
      id_hash TEXT PRIMARY KEY, username TEXT NOT NULL, csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS panel_sessions_expiry ON panel_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS owner_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL,
      license_id TEXT, request_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );`;
  db.exec(schema);
  const privateKey = env.privateKey;
  const publicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  const rates = new Map<string, RateEntry>();
  const maxRate = Math.max(5, Math.min(1000, env.rateLimit ?? 30));
  const throttled = (key: string): boolean => {
    const now = Date.now();
    let e = rates.get(key);
    if (!e && rates.size >= 10_000) {
      for (const [k, v] of rates)
        if (now >= v.reset && now >= v.blockedUntil) rates.delete(k);
      if (rates.size >= 10_000) return true;
    }
    if (!e || now >= e.reset) {
      e = { count: 0, reset: now + 60_000, blockedUntil: 0 };
      rates.set(key, e);
    }
    if (now < e.blockedUntil) return true;
    e.count++;
    if (e.count > maxRate) {
      e.blockedUntil = now + 60_000;
      return true;
    }
    if (rates.size > 10000)
      for (const [k, v] of rates)
        if (now >= v.reset && now >= v.blockedUntil) rates.delete(k);
    return false;
  };
  const issueToken = (row: LicenseRow, installationId: string): string => {
    const paid = Date.parse(row.paid_through);
    const lease: LicenseLease = {
      schema: 1,
      product: "delta-nube-gastronomia",
      licenseId: row.id,
      installationId,
      businessName: row.business_name,
      issuedAt: new Date().toISOString(),
      paidThrough: row.paid_through,
      graceUntil: new Date(paid + GRACE_MS).toISOString(),
      revision: row.revision,
      status: row.status,
    };
    return signLease(lease, privateKey);
  };
  const rowById = (id: string): LicenseRow | undefined =>
    db.prepare("SELECT * FROM licenses WHERE id = ?").get(id) as
      LicenseRow | undefined;
  const withTransaction = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const panelEnabled = env.panelAuth !== undefined;
  const panelOrigin = env.panelAuth?.origin;
  const cookieSecure =
    panelOrigin?.startsWith("https://") === true || env.panelAuth?.secureCookies === true;
  const exactOrigin = (req: IncomingMessage) =>
    panelOrigin !== undefined &&
    typeof req.headers.origin === "string" &&
    safeEqual(req.headers.origin, panelOrigin);
  const panelCookie = (req: IncomingMessage): string | null => {
    const cookie = req.headers.cookie ?? "";
    for (const part of cookie.split(";")) {
      const [name, ...value] = part.trim().split("=");
      if (name === OWNER_COOKIE) {
        const token = value.join("=");
        return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
      }
    }
    return null;
  };
  const sessionFor = (req: IncomingMessage): PanelSessionRow | undefined => {
    const token = panelCookie(req);
    if (!token) return undefined;
    const row = db
      .prepare(
        "SELECT username,csrf_token,expires_at,revoked_at FROM panel_sessions WHERE id_hash = ?",
      )
      .get(hash(token)) as PanelSessionRow | undefined;
    if (
      !row ||
      row.revoked_at ||
      Date.parse(row.expires_at) <= Date.now()
    )
      return undefined;
    return row;
  };
  const privateResponseHeaders = {
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
  const writeAudit = (
    action: string,
    licenseId: string | null,
    requestId: string | null,
    reason: string,
    createdAt = new Date().toISOString(),
  ) =>
    db
      .prepare(
        "INSERT INTO owner_audit(action,license_id,request_id,reason,created_at) VALUES(?,?,?,?,?)",
      )
      .run(action, licenseId, requestId, reason, createdAt);
  const panelRequestShape = (row: DeviceRequestRow) => ({
    id: row.id,
    installationId: row.installation_id,
    businessName: row.business_name,
    keyFingerprint: row.key_fingerprint,
    status: row.status,
    licenseId: row.license_id,
    createdAt: row.created_at,
  });
  const panelLicenseShape = (row: LicenseRow) => ({
    id: row.id,
    businessName: row.business_name,
    paidThrough: row.paid_through,
    revision: row.revision,
    status: row.status,
    installationId: row.installation_id,
    createdAt: (
      db.prepare("SELECT created_at FROM licenses WHERE id = ?").get(row.id) as
        | { created_at: string }
        | undefined
    )?.created_at,
    keyFingerprint: (
      db
        .prepare(
          "SELECT key_fingerprint FROM device_requests WHERE license_id = ? AND status = 'APPROVED'",
        )
        .get(row.id) as { key_fingerprint: string } | undefined
    )?.key_fingerprint ?? null,
  });
  const handlePanel = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ip: string,
  ): Promise<boolean> => {
    if (!url.pathname.startsWith("/manage")) return false;
    if (!panelEnabled || !env.panelAuth) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    if (req.method === "GET" && ["/manage", "/manage/"].includes(url.pathname)) {
      const file = readFileSync(new URL("./panel/index.html", import.meta.url));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": file.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...privateResponseHeaders,
      });
      res.end(file);
      return true;
    }
    const assets: Record<string, { contentType: string; file: string }> = {
      "/manage/panel.js": {
        contentType: "text/javascript; charset=utf-8",
        file: "panel.js",
      },
      "/manage/panel.css": {
        contentType: "text/css; charset=utf-8",
        file: "panel.css",
      },
    };
    if (req.method === "GET" && assets[url.pathname]) {
      const asset = assets[url.pathname]!;
      const file = readFileSync(
        new URL(`./panel/${asset.file}`, import.meta.url),
      );
      res.writeHead(200, {
        "content-type": asset.contentType,
        "content-length": file.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...privateResponseHeaders,
      });
      res.end(file);
      return true;
    }
    if (url.pathname === "/manage/api/login" && req.method === "POST") {
      if (!exactOrigin(req)) {
        json(res, 403, { error: "origin_rejected" });
        return true;
      }
      if (throttled(`panel-login:${ip}`)) {
        json(res, 429, { error: "rate_limited" });
        return true;
      }
      if (!isJson(req)) {
        json(res, 415, { error: "unsupported_media_type" });
        return true;
      }
      const b = await body(req);
      const username = typeof b.username === "string" ? b.username : "";
      const password = typeof b.password === "string" ? b.password : "";
      const usernameMatches = safeEqual(username, env.panelAuth.username);
      // Always run scrypt, including unknown-user attempts, to reduce timing leaks.
      const passwordMatches = await verifyPanelPassword(
        password,
        env.panelAuth.passwordHash,
      );
      if (!usernameMatches || !passwordMatches) {
        json(res, 401, { error: "invalid_credentials" });
        return true;
      }
      const token = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + PANEL_SESSION_TTL_MS);
      db.prepare(
        "INSERT INTO panel_sessions(id_hash,username,csrf_token,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,NULL)",
      ).run(
        hash(token),
        env.panelAuth.username,
        csrfToken,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
      db.prepare(
        "DELETE FROM panel_sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?",
      ).run(createdAt.toISOString());
      const cookie = `${OWNER_COOKIE}=${token}; Path=/manage; HttpOnly; SameSite=Strict; Max-Age=${PANEL_SESSION_TTL_MS / 1000}${cookieSecure ? "; Secure" : ""}`;
      json(
        res,
        200,
        { username: env.panelAuth.username, csrfToken },
        { "set-cookie": cookie },
      );
      return true;
    }
    if (url.pathname.startsWith("/manage/api/")) {
      const session = sessionFor(req);
      if (!session) {
        json(res, 401, { error: "unauthorized" });
        return true;
      }
      const mutating = req.method !== "GET";
      const csrfHeader = req.headers["x-panel-csrf"];
      if (
        mutating &&
        (!exactOrigin(req) ||
          typeof csrfHeader !== "string" ||
          !safeEqual(csrfHeader, session.csrf_token))
      ) {
        json(res, 403, { error: "csrf_rejected" });
        return true;
      }
      if (url.pathname === "/manage/api/session" && req.method === "GET") {
        json(res, 200, {
          username: session.username,
          csrfToken: session.csrf_token,
        });
        return true;
      }
      if (url.pathname === "/manage/api/logout" && req.method === "POST") {
        const token = panelCookie(req);
        if (token)
          db.prepare(
            "UPDATE panel_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL",
          ).run(new Date().toISOString(), hash(token));
        const cookie = `${OWNER_COOKIE}=; Path=/manage; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecure ? "; Secure" : ""}`;
        json(res, 200, { ok: true }, { "set-cookie": cookie });
        return true;
      }
      if (url.pathname === "/manage/api/overview" && req.method === "GET") {
        const requests = db
          .prepare("SELECT * FROM device_requests ORDER BY created_at DESC LIMIT 500")
          .all() as DeviceRequestRow[];
        const licenses = db
          .prepare("SELECT * FROM licenses ORDER BY created_at DESC LIMIT 1000")
          .all() as LicenseRow[];
        const audit = db
          .prepare(
            "SELECT id,action,license_id,request_id,reason,created_at FROM owner_audit ORDER BY id DESC LIMIT 500",
          )
          .all() as Array<{
          id: number;
          action: string;
          license_id: string | null;
          request_id: string | null;
          reason: string;
          created_at: string;
        }>;
        json(res, 200, {
          requests: requests.map(panelRequestShape),
          licenses: licenses.map(panelLicenseShape),
          audit: audit.map((row) => ({
            id: row.id,
            action: row.action,
            licenseId: row.license_id,
            requestId: row.request_id,
            reason: row.reason,
            createdAt: row.created_at,
          })),
        });
        return true;
      }
      if (mutating && !isJson(req)) {
        json(res, 415, { error: "unsupported_media_type" });
        return true;
      }
      const approve = url.pathname.match(
        /^\/manage\/api\/requests\/([A-Za-z0-9_-]{8,128})\/approve$/,
      );
      const reject = url.pathname.match(
        /^\/manage\/api\/requests\/([A-Za-z0-9_-]{8,128})\/reject$/,
      );
      const statusMatch = url.pathname.match(
        /^\/manage\/api\/licenses\/([A-Za-z0-9_-]{8,128})\/status$/,
      );
      const renewMatch = url.pathname.match(
        /^\/manage\/api\/licenses\/([A-Za-z0-9_-]{8,128})\/renew$/,
      );
      if (req.method === "POST" && approve) {
        const b = await body(req);
        const requestId = approve[1]!;
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (!reason || reason.length > 500) {
          json(res, 400, { error: "invalid_reason" });
          return true;
        }
        let result: { request: DeviceRequestRow; license: LicenseRow; idempotent: boolean };
        try {
          result = withTransaction(() => {
            const requestRow = db
              .prepare("SELECT * FROM device_requests WHERE id = ?")
              .get(requestId) as DeviceRequestRow | undefined;
            if (!requestRow)
              throw Object.assign(new Error("not_found"), { panelStatus: 404 });
            if (requestRow.status === "APPROVED") {
              if (
                (typeof b.licenseId === "string" && b.licenseId !== requestRow.license_id) ||
                !requestRow.license_id
              )
                throw Object.assign(new Error("request_already_approved"), { panelStatus: 409 });
              const prior = rowById(requestRow.license_id);
              if (!prior || prior.installation_id !== requestRow.installation_id)
                throw Object.assign(new Error("license_binding_conflict"), { panelStatus: 409 });
              return { request: requestRow, license: prior, idempotent: true };
            }
            const approvedForInstall = db
              .prepare(
                "SELECT id FROM device_requests WHERE installation_id = ? AND status = 'APPROVED'",
              )
              .get(requestRow.installation_id) as { id: string } | undefined;
            if (approvedForInstall && approvedForInstall.id !== requestRow.id)
              throw Object.assign(new Error("installation_already_has_approved_device"), { panelStatus: 409 });
            const selectedLicenseId =
              typeof b.licenseId === "string" && b.licenseId ? b.licenseId : null;
            let license: LicenseRow | undefined;
            const now = new Date().toISOString();
            if (selectedLicenseId) {
              license = rowById(selectedLicenseId);
              if (!license)
                throw Object.assign(new Error("license_not_found"), { panelStatus: 404 });
              if (
                license.installation_id &&
                license.installation_id !== requestRow.installation_id
              )
                throw Object.assign(new Error("license_bound_to_other_installation"), { panelStatus: 409 });
              const priorDevice = db
                .prepare(
                  "SELECT id,key_fingerprint FROM device_requests WHERE license_id = ? AND status = 'APPROVED'",
                )
                .get(license.id) as
                | { id: string; key_fingerprint: string }
                | undefined;
              if (
                priorDevice &&
                (priorDevice.id !== requestRow.id ||
                  priorDevice.key_fingerprint !== requestRow.key_fingerprint)
              )
                throw Object.assign(new Error("license_bound_to_other_device"), { panelStatus: 409 });
              db.prepare(
                "UPDATE licenses SET installation_id = ? WHERE id = ? AND (installation_id IS NULL OR installation_id = ?)",
              ).run(requestRow.installation_id, license.id, requestRow.installation_id);
            } else {
              if (
                typeof b.businessName !== "string" ||
                !b.businessName.trim() ||
                b.businessName.length > 160 ||
                !canonicalIso(b.paidThrough)
              )
                throw Object.assign(new Error("invalid_new_license"), { panelStatus: 400 });
              const id = randomBytes(16).toString("base64url");
              const unusedSecret = randomBytes(32).toString("base64url");
              db.prepare(
                "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
              ).run(
                id,
                b.businessName.trim(),
                b.paidThrough,
                1,
                "ACTIVE",
                hash(unusedSecret),
                requestRow.installation_id,
                now,
              );
              license = rowById(id);
            }
            if (!license)
              throw Object.assign(new Error("license_create_failed"), { panelStatus: 500 });
            db.prepare(
              "UPDATE device_requests SET status = 'APPROVED', license_id = ?, updated_at = ? WHERE id = ? AND status IN ('PENDING','REJECTED')",
            ).run(license.id, now, requestRow.id);
            const approved = db
              .prepare("SELECT * FROM device_requests WHERE id = ?")
              .get(requestRow.id) as DeviceRequestRow;
            writeAudit("REQUEST_APPROVED", license.id, requestRow.id, reason, now);
            return { request: approved, license: rowById(license.id)!, idempotent: false };
          });
        } catch (error) {
          const status =
            typeof error === "object" && error !== null && "panelStatus" in error
              ? Number((error as { panelStatus: unknown }).panelStatus)
              : 500;
          json(res, status, {
            error:
              status === 500
                ? "internal_error"
                : error instanceof Error
                  ? error.message
                  : "approval_failed",
          });
          return true;
        }
        json(res, 200, {
          request: panelRequestShape(result.request),
          license: panelLicenseShape(result.license),
          idempotent: result.idempotent,
        });
        return true;
      }
      if (req.method === "POST" && reject) {
        const b = await body(req);
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (!reason || reason.length > 500) {
          json(res, 400, { error: "invalid_reason" });
          return true;
        }
        const requestId = reject[1]!;
        const result = withTransaction(() => {
          const row = db
            .prepare("SELECT * FROM device_requests WHERE id = ?")
            .get(requestId) as DeviceRequestRow | undefined;
          if (!row) return { status: 404 as const };
          if (row.status === "APPROVED") return { status: 409 as const };
          if (row.status === "REJECTED") return { status: 200 as const, row, idempotent: true };
          const now = new Date().toISOString();
          db.prepare(
            "UPDATE device_requests SET status = 'REJECTED', updated_at = ? WHERE id = ? AND status = 'PENDING'",
          ).run(now, row.id);
          writeAudit("REQUEST_REJECTED", row.license_id, row.id, reason, now);
          return {
            status: 200 as const,
            row: db.prepare("SELECT * FROM device_requests WHERE id = ?").get(row.id) as DeviceRequestRow,
            idempotent: false,
          };
        });
        if (result.status !== 200) {
          json(res, result.status, { error: result.status === 404 ? "not_found" : "request_already_approved" });
          return true;
        }
        json(res, 200, { request: panelRequestShape(result.row), idempotent: result.idempotent });
        return true;
      }
      if (req.method === "POST" && statusMatch) {
        const b = await body(req);
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (
          !["ACTIVE", "SUSPENDED"].includes(String(b.status)) ||
          !Number.isSafeInteger(b.expectedRevision) ||
          !reason ||
          reason.length > 500
        ) {
          json(res, 400, { error: "invalid_status_change" });
          return true;
        }
        const nextStatus = b.status as "ACTIVE" | "SUSPENDED";
        const expectedRevision = b.expectedRevision as number;
        const id = statusMatch[1]!;
        const result = withTransaction(() => {
          const row = rowById(id);
          if (!row) return { status: 404 as const };
          if (row.revision !== expectedRevision)
            return { status: 409 as const, license: row };
          if (row.status === nextStatus)
            return { status: 200 as const, license: row, idempotent: true };
          const now = new Date().toISOString();
          const updated = db
            .prepare(
              "UPDATE licenses SET status = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
            )
            .run(nextStatus, id, row.revision);
          if (Number(updated.changes) !== 1)
            return { status: 409 as const, license: rowById(id)! };
          writeAudit(
            nextStatus === "SUSPENDED" ? "LICENSE_SUSPENDED" : "LICENSE_REACTIVATED",
            id,
            null,
            reason,
            now,
          );
          return { status: 200 as const, license: rowById(id)!, idempotent: false };
        });
        if (result.status !== 200) {
          json(res, result.status, {
            error: result.status === 404 ? "not_found" : "revision_conflict",
            ...(result.status === 409 ? { license: panelLicenseShape(result.license) } : {}),
          });
          return true;
        }
        json(res, 200, {
          license: panelLicenseShape(result.license),
          idempotent: result.idempotent,
        });
        return true;
      }
      if (req.method === "POST" && renewMatch) {
        const b = await body(req);
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (
          !canonicalIso(b.paidThrough) ||
          !Number.isSafeInteger(b.expectedRevision) ||
          !reason ||
          reason.length > 500
        ) {
          json(res, 400, { error: "invalid_renewal" });
          return true;
        }
        const paidThrough = b.paidThrough as string;
        const expectedRevision = b.expectedRevision as number;
        const id = renewMatch[1]!;
        const result = withTransaction(() => {
          const row = rowById(id);
          if (!row) return { status: 404 as const };
          if (row.revision !== expectedRevision)
            return { status: 409 as const, license: row };
          if (Date.parse(paidThrough) < Date.parse(row.paid_through))
            return { status: 422 as const, license: row };
          if (row.paid_through === paidThrough)
            return { status: 200 as const, license: row, idempotent: true };
          const now = new Date().toISOString();
          const updated = db
            .prepare(
              "UPDATE licenses SET paid_through = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
            )
            .run(paidThrough, id, row.revision);
          if (Number(updated.changes) !== 1)
            return { status: 409 as const, license: rowById(id)! };
          writeAudit("LICENSE_RENEWED", id, null, reason, now);
          return { status: 200 as const, license: rowById(id)!, idempotent: false };
        });
        if (result.status !== 200) {
          if (result.status === 404) {
            json(res, 404, { error: "not_found" });
            return true;
          }
          json(res, result.status, {
            error: result.status === 422 ? "renewal_cannot_shorten" : "revision_conflict",
            license: panelLicenseShape(result.license),
          });
          return true;
        }
        json(res, 200, {
          license: panelLicenseShape(result.license),
          idempotent: result.idempotent,
        });
        return true;
      }
      json(res, 404, { error: "not_found" });
      return true;
    }
    json(res, 404, { error: "not_found" });
    return true;
  };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const rawTarget = req.url ?? "";
      if (!rawTarget.startsWith("/") || rawTarget.startsWith("//"))
        return json(res, 400, { error: "invalid_request_target" });
      const url = new URL(rawTarget, "http://localhost");
      if (
        url.origin !== "http://localhost" ||
        url.username ||
        url.password ||
        url.hash
      )
        return json(res, 400, { error: "invalid_request_target" });
      const ip = req.socket.remoteAddress ?? "unknown";
      if (req.method === "GET" && url.pathname === "/health")
        return json(res, 200, { status: "ok" });
      if (url.pathname.startsWith("/manage")) {
        await handlePanel(req, res, url, ip);
        return;
      }
      if (url.pathname.startsWith("/admin/")) {
        const bucket = `admin:${ip}`;
        if (throttled(bucket)) return json(res, 429, { error: "rate_limited" });
        const header = req.headers.authorization ?? "";
        const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!safeEqual(provided, env.adminToken))
          return json(res, 401, { error: "unauthorized" });
        if (req.method === "POST" && url.pathname === "/admin/licenses") {
          if (!isJson(req))
            return json(res, 415, { error: "unsupported_media_type" });
          const b = await body(req);
          if (
            typeof b.businessName !== "string" ||
            !b.businessName.trim() ||
            b.businessName.length > 160 ||
            !canonicalIso(b.paidThrough)
          )
            return json(res, 400, { error: "invalid_license" });
          const id = randomBytes(16).toString("base64url");
          const code = randomBytes(32).toString("base64url");
          const createdAt = new Date().toISOString();
          db.prepare(
            "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)",
          ).run(
            id,
            b.businessName.trim(),
            b.paidThrough,
            1,
            "ACTIVE",
            hash(code),
            createdAt,
          );
          return json(res, 201, {
            license: {
              id,
              businessName: b.businessName.trim(),
              paidThrough: b.paidThrough,
              revision: 1,
              status: "ACTIVE",
              installationId: null,
              createdAt,
            },
            activationCode: code,
          });
        }
        const renewMatch = url.pathname.match(
          /^\/admin\/licenses\/([A-Za-z0-9_-]{8,128})\/renew$/,
        );
        if (req.method === "POST" && renewMatch) {
          const b = await body(req);
          const id = renewMatch[1]!;
          if (
            !canonicalIso(b.paidThrough) ||
            typeof b.reason !== "string" ||
            !b.reason.trim() ||
            b.reason.length > 500 ||
            typeof b.idempotencyKey !== "string" ||
            !/^[A-Za-z0-9_-]{8,128}$/.test(b.idempotencyKey)
          )
            return json(res, 400, { error: "invalid_renewal" });
          const prior = db
            .prepare(
              "SELECT license_id,paid_through,reason FROM renewals WHERE idempotency_key = ?",
            )
            .get(b.idempotencyKey) as
            | { license_id: string; paid_through: string; reason: string }
            | undefined;
          if (prior)
            return prior.license_id === id &&
              prior.paid_through === b.paidThrough &&
              prior.reason === b.reason.trim()
              ? json(res, 200, {
                  license: publicRow(rowById(id)!),
                  idempotent: true,
                })
              : json(res, 409, { error: "idempotency_conflict" });
          const row = rowById(id);
          if (!row) return json(res, 404, { error: "not_found" });
          if (Date.parse(b.paidThrough) < Date.parse(row.paid_through))
            return json(res, 409, { error: "renewal_cannot_shorten" });
          const update = db.prepare(
            "UPDATE licenses SET paid_through = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
          );
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare(
              "INSERT INTO renewals(idempotency_key,license_id,paid_through,reason,created_at) VALUES(?,?,?,?,?)",
            ).run(
              b.idempotencyKey,
              id,
              b.paidThrough,
              b.reason.trim(),
              new Date().toISOString(),
            );
            update.run(b.paidThrough, id, row.revision);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          return json(res, 200, {
            license: publicRow(rowById(id)!),
            idempotent: false,
          });
        }
        if (req.method === "GET" && url.pathname === "/admin/licenses") {
          const rows = db
            .prepare(
              "SELECT * FROM licenses ORDER BY created_at DESC LIMIT 1000",
            )
            .all() as LicenseRow[];
          return json(res, 200, { licenses: rows.map(publicRow) });
        }
        return json(res, 404, { error: "not_found" });
      }
      if (
        req.method === "POST" &&
        url.pathname === "/v2/devices/challenge"
      ) {
        if (throttled(`device:${ip}`))
          return json(res, 429, { error: "rate_limited" });
        if (!isJson(req))
          return json(res, 415, { error: "unsupported_media_type" });
        const b = await body(req);
        if (
          !validId(b.installationId) ||
          typeof b.publicKey !== "string" ||
          b.publicKey.length < 40 ||
          b.publicKey.length > 2048 ||
          (b.purpose !== "request" && b.purpose !== "lease")
        )
          return json(res, 400, { error: "invalid_challenge_request" });
        let fingerprint: string;
        try {
          fingerprint = devicePublicKeyFingerprint(b.publicKey);
        } catch {
          return json(res, 400, { error: "invalid_device_key" });
        }
        if (!/^[a-f0-9]{64}$/.test(fingerprint))
          return json(res, 400, { error: "invalid_device_key" });
        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        // Bound both active and retained replay records; old used/expired rows
        // are retained briefly so retries get a clear replay/expiry response.
        db.prepare(
          "DELETE FROM device_challenges WHERE (used_at IS NOT NULL OR expires_at <= ?) AND created_at <= ?",
        ).run(nowIso, new Date(now - 10 * 60_000).toISOString());
        const retained = db
          .prepare("SELECT COUNT(*) AS count FROM device_challenges")
          .get() as { count: number };
        if (retained.count >= MAX_LIVE_CHALLENGES)
          return json(res, 429, { error: "challenge_capacity_reached" });
        const id = randomBytes(18).toString("base64url");
        const nonce = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
        db.prepare(
          "INSERT INTO device_challenges(id,nonce,installation_id,key_fingerprint,public_key,purpose,expires_at,created_at,used_at) VALUES(?,?,?,?,?,?,?,?,NULL)",
        ).run(
          id,
          nonce,
          b.installationId,
          fingerprint,
          b.publicKey,
          b.purpose,
          expiresAt,
          nowIso,
        );
        return json(res, 200, { challengeId: id, nonce, expiresAt });
      }
      if (
        req.method === "POST" &&
        (url.pathname === "/v2/devices/request" ||
          url.pathname === "/v2/devices/lease")
      ) {
        if (throttled(`device:${ip}`))
          return json(res, 429, { error: "rate_limited" });
        if (!isJson(req))
          return json(res, 415, { error: "unsupported_media_type" });
        const b = await body(req);
        const purpose =
          url.pathname === "/v2/devices/request" ? "request" : "lease";
        if (
          !validId(b.installationId) ||
          typeof b.publicKey !== "string" ||
          b.publicKey.length < 40 ||
          b.publicKey.length > 2048 ||
          typeof b.challengeId !== "string" ||
          !validId(b.challengeId) ||
          typeof b.signature !== "string" ||
          !/^[A-Za-z0-9_-]{86}$/.test(b.signature) ||
          (purpose === "request" &&
            (typeof b.businessName !== "string" ||
              !b.businessName.trim() ||
              b.businessName.length > 160)) ||
          (purpose === "lease" && Object.hasOwn(b, "businessName"))
        )
          return json(res, 400, { error: "invalid_device_proof" });
        let fingerprint: string;
        try {
          fingerprint = devicePublicKeyFingerprint(b.publicKey);
        } catch {
          return json(res, 400, { error: "invalid_device_key" });
        }
        const challenge = db
          .prepare("SELECT * FROM device_challenges WHERE id = ?")
          .get(b.challengeId) as ChallengeRow | undefined;
        if (!challenge) return json(res, 409, { error: "challenge_invalid" });
        if (challenge.used_at)
          return json(res, 409, { error: "challenge_replayed" });
        if (Date.parse(challenge.expires_at) <= Date.now())
          return json(res, 410, { error: "challenge_expired" });
        if (
          challenge.purpose !== purpose ||
          challenge.installation_id !== b.installationId ||
          challenge.key_fingerprint !== fingerprint ||
          challenge.public_key !== b.publicKey
        )
          return json(res, 409, { error: "challenge_binding_mismatch" });
        const proof: DeviceProof = {
          purpose,
          challengeId: challenge.id,
          nonce: challenge.nonce,
          installationId: challenge.installation_id,
          keyFingerprint: challenge.key_fingerprint,
          ...(purpose === "request"
            ? { businessName: (b.businessName as string).trim() }
            : {}),
        } as const;
        if (!verifyDeviceProof(proof, b.signature, challenge.public_key))
          return json(res, 401, { error: "invalid_device_signature" });
        const consumed = db
          .prepare(
            "UPDATE device_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?",
          )
          .run(new Date().toISOString(), challenge.id, new Date().toISOString());
        if (Number(consumed.changes) !== 1)
          return json(res, 409, { error: "challenge_replayed" });
        if (purpose === "lease") {
          const device = db
            .prepare(
              "SELECT * FROM device_requests WHERE installation_id = ? AND key_fingerprint = ? AND status = 'APPROVED'",
            )
            .get(challenge.installation_id, challenge.key_fingerprint) as
            | DeviceRequestRow
            | undefined;
          if (!device?.license_id)
            return json(res, 401, { error: "device_not_approved" });
          const license = rowById(device.license_id);
          if (!license || license.installation_id !== device.installation_id)
            return json(res, 401, { error: "device_not_approved" });
          return json(res, 200, {
            request: panelRequestShape(device),
            token: issueToken(license, device.installation_id),
          });
        }
        const businessName = (b.businessName as string).trim();
        let requestRow: DeviceRequestRow;
        const existingFingerprint = db
          .prepare("SELECT * FROM device_requests WHERE key_fingerprint = ?")
          .get(challenge.key_fingerprint) as DeviceRequestRow | undefined;
        if (
          existingFingerprint &&
          existingFingerprint.installation_id !== challenge.installation_id
        )
          return json(res, 409, { error: "device_key_already_registered" });
        const existing = db
          .prepare(
            "SELECT * FROM device_requests WHERE installation_id = ? AND key_fingerprint = ?",
          )
          .get(challenge.installation_id, challenge.key_fingerprint) as
          | DeviceRequestRow
          | undefined;
        if (existing) {
          requestRow = existing;
        } else {
          const createdAtDate = new Date();
          const createdAt = createdAtDate.toISOString();
          const expiresBefore = new Date(
            createdAtDate.getTime() - DEVICE_REQUEST_TTL_MS,
          ).toISOString();
          withTransaction(() => {
            db.prepare(
              "DELETE FROM device_requests WHERE status IN ('PENDING','REJECTED') AND updated_at <= ? AND license_id IS NULL",
            ).run(expiresBefore);
          });
          const count = db
            .prepare("SELECT COUNT(*) AS count FROM device_requests WHERE status = 'PENDING'")
            .get() as { count: number };
          if (count.count >= MAX_DEVICE_REQUESTS)
            return json(res, 429, { error: "request_capacity_reached" });
          const id = randomBytes(18).toString("base64url");
          db.prepare(
            "INSERT INTO device_requests(id,installation_id,business_name,key_fingerprint,public_key,status,license_id,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',NULL,?,?)",
          ).run(
            id,
            challenge.installation_id,
            businessName,
            challenge.key_fingerprint,
            challenge.public_key,
            createdAt,
            createdAt,
          );
          requestRow = db
            .prepare("SELECT * FROM device_requests WHERE id = ?")
            .get(id) as DeviceRequestRow;
        }
        const response: {
          request: ReturnType<typeof panelRequestShape>;
          token?: string;
        } = { request: panelRequestShape(requestRow) };
        if (requestRow.status === "APPROVED" && requestRow.license_id) {
          const license = rowById(requestRow.license_id);
          if (license?.installation_id === requestRow.installation_id)
            response.token = issueToken(license, requestRow.installation_id);
        }
        return json(res, 200, response);
      }
      if (
        req.method === "POST" &&
        (url.pathname === "/v1/activate" || url.pathname === "/v1/verify")
      ) {
        if (throttled(`public:${ip}`))
          return json(res, 429, { error: "rate_limited" });
        if (!isJson(req))
          return json(res, 415, { error: "unsupported_media_type" });
        const b = await body(req);
        if (!validId(b.installationId))
          return json(res, 400, { error: "invalid_installation" });
        if (url.pathname === "/v1/activate") {
          if (typeof b.code !== "string" || b.code.length > 128)
            return json(res, 400, { error: "invalid_activation" });
          const row = db
            .prepare("SELECT * FROM licenses WHERE activation_hash = ?")
            .get(hash(b.code)) as LicenseRow | undefined;
          if (!row) return json(res, 401, { error: "invalid_activation" });
          if (row.installation_id && row.installation_id !== b.installationId)
            return json(res, 409, { error: "installation_mismatch" });
          if (!row.installation_id) {
            let result;
            try {
              result = db
                .prepare(
                  "UPDATE licenses SET installation_id = ? WHERE id = ? AND installation_id IS NULL",
                )
                .run(b.installationId, row.id);
            } catch {
              return json(res, 409, { error: "installation_mismatch" });
            }
            if (Number(result.changes) !== 1) {
              const latest = rowById(row.id);
              if (latest?.installation_id !== b.installationId)
                return json(res, 409, { error: "installation_mismatch" });
            }
          }
          return json(res, 200, {
            token: issueToken(rowById(row.id)!, b.installationId),
          });
        }
        if (typeof b.token !== "string" || b.token.length > 8192)
          return json(res, 400, { error: "invalid_token" });
        try {
          const lease = verifyLease(b.token, publicKey, b.installationId);
          const row = rowById(lease.licenseId);
          if (
            !row ||
            row.installation_id !== b.installationId ||
            lease.revision > row.revision
          )
            throw new Error();
          return json(res, 200, { token: issueToken(row, b.installationId) });
        } catch {
          return json(res, 401, { error: "invalid_token" });
        }
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status: unknown }).status)
          : 500;
      return json(res, status >= 400 && status < 500 ? status : 500, {
        error: status === 500 ? "internal_error" : "bad_request",
      });
    }
  };
  const server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
      else res.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 1_000;
  server.on("connection", (socket) =>
    socket.setTimeout(15_000, () => socket.destroy()),
  );
  let databaseClosed = false;
  const close = () => {
    if (databaseClosed) return;
    databaseClosed = true;
    if (server.listening) server.close();
    db.close();
  };
  return { server, close };
}
function publicRow(row: LicenseRow): unknown {
  return {
    id: row.id,
    businessName: row.business_name,
    paidThrough: row.paid_through,
    revision: row.revision,
    status: row.status,
    installationId: row.installation_id,
  };
}
function isJson(req: IncomingMessage): boolean {
  return /^application\/json(?:\s*;|$)/i.test(
    req.headers["content-type"] ?? "",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const dbPath = process.env.DB_PATH;
  const adminFile = process.env.ADMIN_TOKEN_FILE;
  const privateFile = process.env.LEASE_PRIVATE_KEY_FILE;
  const panelUsername = process.env.PANEL_USERNAME;
  const panelPasswordFile = process.env.PANEL_PASSWORD_HASH_FILE;
  const panelOrigin = process.env.PANEL_ORIGIN;
  const panelEnvCount = [panelUsername, panelPasswordFile, panelOrigin].filter(
    (value) => value !== undefined,
  ).length;
  if (!dbPath || !adminFile || !privateFile)
    throw new Error("Set DB_PATH, ADMIN_TOKEN_FILE and LEASE_PRIVATE_KEY_FILE");
  if (panelEnvCount !== 0 && panelEnvCount !== 3)
    throw new Error(
      "Set PANEL_USERNAME, PANEL_PASSWORD_HASH_FILE and PANEL_ORIGIN together to enable the owner panel",
    );
  const { server, close } = createLicenseServer({
    dbPath,
    adminToken: readFileSync(adminFile, "utf8").trim(),
    privateKey: readFileSync(privateFile, "utf8"),
    ...(panelEnvCount === 3
      ? {
          panelAuth: {
            username: panelUsername!,
            passwordHash: readFileSync(panelPasswordFile!, "utf8").trim(),
            origin: panelOrigin!,
            secureCookies: panelOrigin!.startsWith("https://"),
          },
        }
      : {}),
  });
  const port = Number(process.env.PORT ?? 8097);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be an integer from 1 to 65535");
  server.listen(port, process.env.HOST ?? "0.0.0.0");
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      close();
      process.exitCode = 0;
    });
    server.closeAllConnections();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
