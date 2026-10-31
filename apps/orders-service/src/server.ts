import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, isAbsolute } from "node:path";
import { OrdersStore } from "./store.js";
import { loadStores, validateStores, type StoreConfig } from "./config.js";

const MAX_BODY = 64 * 1024;
type Rate = { count: number; reset: number };
export type OrdersServerOptions = {
  dbPath: string;
  stores: StoreConfig[];
  rateLimit?: number;
};
function json(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(status === 429 ? { "retry-after": "60" } : {}),
    ...(status === 413 ? { connection: "close" } : {}),
  });
  res.end(data);
}
function error(status: number, code: string): never {
  throw Object.assign(new Error(code), { status, code });
}
function isJson(req: IncomingMessage): boolean {
  return /^application\/json(?:\s*;|$)/i.test(
    req.headers["content-type"] ?? "",
  );
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"]) > MAX_BODY) {
    req.resume();
    error(413, "too_large");
  }
  // Avoid for-await's automatic stream destruction on an oversized body: the
  // caller must still be able to send a deterministic HTTP 413 before closing.
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAbort);
      req.off("error", onError);
    };
    const onError = () => {
      cleanup();
      reject(Object.assign(new Error("bad_request"), { status: 400 }));
    };
    const onAbort = () => onError();
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        cleanup();
        req.resume();
        reject(
          Object.assign(new Error("too_large"), {
            status: 413,
            code: "too_large",
          }),
        );
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        if (!size) throw new Error();
        resolveBody(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
      } catch {
        reject(Object.assign(new Error("bad_request"), { status: 400 }));
      }
    };
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("aborted", onAbort);
    req.once("error", onError);
  });
}
function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization;
  const match =
    typeof value === "string" && /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(value);
  return match ? match[1] : undefined;
}
function boundedRate(
  map: Map<string, Rate>,
  key: string,
  max: number,
): boolean {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry && map.size >= 10_000) return true;
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + 60_000 };
    map.set(key, entry);
  }
  entry.count++;
  return entry.count > max;
}

export function createOrdersServer(options: OrdersServerOptions): {
  server: Server;
  close: () => Promise<void>;
} {
  if (typeof options.dbPath !== "string" || !isAbsolute(options.dbPath))
    throw new Error("dbPath must be absolute");
  const stores = validateStores(options.stores);
  const rateLimit = options.rateLimit ?? 120;
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 10 || rateLimit > 10_000)
    throw new Error("Invalid rateLimit");
  const store = new OrdersStore(options.dbPath, stores);
  const limits = new Map<string, Rate>();
  // Periodic work, not an O(n) sweep on every request at capacity.
  const rateSweep = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of limits)
      if (value.reset <= now) limits.delete(key);
  }, 60_000);
  rateSweep.unref();
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://orders.local");
      const ip = req.socket.remoteAddress ?? "unknown";
      const token = bearer(req);
      const scope = token ? store.authenticate(token) : undefined;
      // Authenticated stores do not share an IP budget behind the same proxy.
      // Keep raw credentials out of rate-limit keys and cap the map cardinality.
      const rateKey = scope
        ? `scope:${scope.storeId}:${scope.role}:${scope.siteId ?? ""}`
        : `ip:${ip}`;
      if (boundedRate(limits, rateKey, rateLimit)) error(429, "rate_limited");
      if (req.headers.origin !== undefined) error(403, "forbidden");
      if (req.method === "GET" && url.pathname === "/health")
        return json(res, 200, { ok: true });
      if (req.method === "POST" && url.pathname === "/v1/web-orders") {
        if (!isJson(req)) error(415, "unsupported_media_type");
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
          error(400, "bad_request");
        if (!scope || scope.role !== "submit" || !scope.siteId)
          error(401, "unauthorized");
        const result = store.submit(
          scope.storeId,
          scope.siteId,
          key,
          await readJson(req),
        );
        return json(res, result.status, result.result);
      }
      if (req.method === "GET" && url.pathname === "/v1/web-orders") {
        if (!scope || scope.role !== "receive") error(401, "unauthorized");
        const afterText = url.searchParams.get("after") ?? "0";
        const limitText = url.searchParams.get("limit") ?? "50";
        if (!/^\d+$/.test(afterText) || !/^\d+$/.test(limitText))
          error(400, "bad_request");
        const after = Number(afterText);
        const limit = Number(limitText);
        if (
          !Number.isSafeInteger(after) ||
          after < 0 ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          error(400, "bad_request");
        return json(res, 200, store.list(scope.storeId, after, limit));
      }
      const ack = /^\/v1\/web-orders\/([A-Za-z0-9-]{36})\/received$/.exec(
        url.pathname,
      );
      if (req.method === "POST" && ack) {
        if (!scope || scope.role !== "receive") error(401, "unauthorized");
        const order = store.acknowledge(scope.storeId, ack[1]!);
        if (!order) error(404, "not_found");
        return json(res, 200, { order });
      }
      return json(res, 404, { error: "not_found" });
    } catch (e) {
      const candidate =
        typeof e === "object" && e !== null
          ? (e as { status?: unknown; code?: unknown })
          : {};
      const status =
        Number.isInteger(candidate.status) &&
        Number(candidate.status) >= 400 &&
        Number(candidate.status) < 500
          ? Number(candidate.status)
          : 500;
      const codes: Record<number, string> = {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "idempotency_conflict",
        413: "too_large",
        415: "unsupported_media_type",
        429: "rate_limited",
      };
      return json(res, status, { error: codes[status] ?? "internal_error" });
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
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    clearInterval(rateSweep);
    closing = new Promise<void>((resolveClose, reject) => {
      const deadline = setTimeout(() => server.closeAllConnections(), 15_000);
      deadline.unref();
      server.close(() => {
        clearTimeout(deadline);
        try {
          store.close();
          resolveClose();
        } catch (error) {
          reject(error);
        }
      });
    });
    return closing;
  };
  return { server, close };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const dbPath = process.env.WEB_ORDERS_DB_PATH;
  const configFile = process.env.WEB_ORDERS_CONFIG_FILE;
  if (!dbPath || !configFile)
    throw new Error("Set WEB_ORDERS_DB_PATH and WEB_ORDERS_CONFIG_FILE");
  const port = Number(process.env.PORT ?? 8098);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || !host)
    throw new Error("Invalid listen configuration");
  const service = createOrdersServer({
    dbPath,
    stores: loadStores(configFile),
    rateLimit: process.env.WEB_ORDERS_RATE_LIMIT
      ? Number(process.env.WEB_ORDERS_RATE_LIMIT)
      : undefined,
  });
  service.server.listen(port, host);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void service.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
