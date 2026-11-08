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
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyWebSiteTicket, verifyWaiterTicket } from "@gastronomy/web-orders/provision";
import { createTenantStorefront } from "./tenant-storefront.js";
import { WaiterRelay } from "./waiter-relay.js";
import { waiterHtml } from "./waiter-page.js";

const MAX_BODY = 64 * 1024;
const MAX_CATALOG_BODY = 2 * 1024 * 1024;
// Valid desktop proof refreshes the waiter credential; without refresh it expires.
const WAITER_CONNECTION_TTL_MS = 48 * 60 * 60 * 1000;
type Rate = { count: number; reset: number };
export type OrdersServerOptions = {
  dbPath: string;
  stores: StoreConfig[];
  rateLimit?: number;
  provisioning?: {
    secret: string;
    baseDomain: string;
    reservedSlugs?: string[];
  };
  waiterPublicBaseUrl?: string;
  waiterProvisionSecret?: string;
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
async function readJson(
  req: IncomingMessage,
  maxBytes = MAX_BODY,
): Promise<unknown> {
  if (Number(req.headers["content-length"]) > maxBytes) {
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
      if (size > maxBytes) {
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
  const stores =
    (options.provisioning || options.waiterProvisionSecret) &&
    Array.isArray(options.stores) &&
    options.stores.length === 0
      ? []
      : validateStores(options.stores);
  const rateLimit = options.rateLimit ?? 120;
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 10 || rateLimit > 10_000)
    throw new Error("Invalid rateLimit");
  if (
    options.provisioning &&
    (Buffer.byteLength(options.provisioning.secret) < 32 ||
      options.provisioning.baseDomain.length > 188 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
        options.provisioning.baseDomain,
      ))
  )
    throw new Error("Invalid provisioning configuration");
  if (options.waiterProvisionSecret && Buffer.byteLength(options.waiterProvisionSecret) < 32)
    throw new Error("Invalid waiter provisioning configuration");
  const store = new OrdersStore(options.dbPath, stores);
  const limits = new Map<string, Rate>();
  const reservedSlugs = [
    ...new Set(
      [
        "www",
        "api",
        "admin",
        "app",
        "mail",
        "ftp",
        "localhost",
        "gastronomia",
        "pedidos",
        ...(options.provisioning?.reservedSlugs ?? []),
        ...stores.flatMap((s) => [s.id, ...s.sites.map((site) => site.id)]),
      ].map((s) => s.toLowerCase()),
    ),
  ];
  const tenantStorefront = options.provisioning
    ? createTenantStorefront({
        store,
        dbPath: options.dbPath,
        hostSuffix: options.provisioning.baseDomain,
        reservedHosts: reservedSlugs,
      })
    : undefined;
  const waiterPublicBaseUrl = options.waiterPublicBaseUrl ?? (options.provisioning ? `https://pedidos.${options.provisioning.baseDomain}/` : undefined);
  const waiterRelay = waiterPublicBaseUrl
    ? new WaiterRelay((credential) => store.authenticateWaiter(credential) ?? store.authenticate(credential), waiterPublicBaseUrl, waiterHtml)
    : undefined;
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
      if (
        !req.url?.startsWith("/") ||
        req.url.startsWith("//") ||
        url.origin !== "http://orders.local"
      )
        error(400, "bad_request");
      if (waiterRelay && await waiterRelay.handle(req, res, url.pathname, req.method ?? "GET")) return;
      if (tenantStorefront && options.provisioning) {
        const handled = await tenantStorefront.handle(
          req,
          res,
          req.headers.host,
        );
        if (handled) return;
        // Never fall through from unknown/invalid shop names into private API routes.
        const base = options.provisioning.baseDomain.toLowerCase();
        const apiHosts = [
          "localhost",
          "127.0.0.1",
          "[::1]",
          `api.${base}`,
          `pedidos.${base}`,
        ];
        const raw = (req.headers.host ?? "").toLowerCase();
        if (
          !apiHosts.some(
            (host) =>
              raw === host ||
              (raw.startsWith(host + ":") &&
                /^\d{1,5}$/.test(raw.slice(host.length + 1))),
          )
        )
          error(404, "not_found");
      }
      const ip = req.socket.remoteAddress ?? "unknown";
      const token = bearer(req);
      const scope = token ? store.authenticate(token) : undefined;
      if (
        scope?.role === "receive" &&
        scope.receiveInstallationId &&
        req.headers["x-pos-installation"] !== scope.receiveInstallationId
      )
        error(401, "unauthorized");
      // Authenticated stores do not share an IP budget behind the same proxy.
      // Keep raw credentials out of rate-limit keys and cap the map cardinality.
      const rateKey = scope
        ? `scope:${scope.storeId}:${scope.role}:${scope.siteId ?? ""}`
        : `ip:${ip}`;
      if (boundedRate(limits, rateKey, rateLimit)) error(429, "rate_limited");
      if (req.headers.origin !== undefined) error(403, "forbidden");
      if (
        scope &&
        req.headers["x-expected-store-id"] !== undefined &&
        req.headers["x-expected-store-id"] !== scope.storeId
      )
        error(403, "forbidden");
      if (
        scope &&
        req.headers["x-expected-site-id"] !== undefined &&
        req.headers["x-expected-site-id"] !== scope.siteId
      )
        error(403, "forbidden");
      if (req.method === "POST" && url.pathname === "/v1/web-sites") {
        if (!options.provisioning) error(404, "not_found");
        if (!isJson(req)) error(415, "unsupported_media_type");
        const auth = req.headers.authorization;
        if (
          typeof auth !== "string" ||
          !/^Bearer [A-Za-z0-9_.-]{20,4096}$/.test(auth)
        )
          error(401, "unauthorized");
        let claims;
        try {
          claims = verifyWebSiteTicket(
            auth.slice(7),
            options.provisioning.secret,
          );
        } catch {
          error(401, "unauthorized");
        }
        const body = (await readJson(req)) as Record<string, unknown>;
        if (
          !body ||
          Object.keys(body).some(
            (k) => !["slug", "whatsappNumber"].includes(k),
          ) ||
          typeof body.slug !== "string" ||
          typeof body.whatsappNumber !== "string" ||
          !/^\d{8,15}$/.test(body.whatsappNumber)
        )
          error(400, "bad_request");
        const slug = body.slug.toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug))
          error(400, "bad_request");
        if (
          reservedSlugs.includes(slug) ||
          stores.some((s) => s.receiveInstallationId === claims.installationId)
        )
          error(409, "idempotency_conflict");
        const receiveToken = createHmac("sha256", options.provisioning.secret)
          .update(`gastronomy:web-site:receive:v1:${claims.installationId}`)
          .digest("base64url");
        const tenant = store.provisionTenant({
          ...claims,
          slug,
          whatsappNumber: body.whatsappNumber,
          receiveToken,
        });
        return json(res, 201, {
          ...tenant,
          url: `https://${tenant.slug}.${options.provisioning.baseDomain}`,
          receiveToken,
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/waiter-connections") {
        if (!waiterRelay) error(404, "not_found");
        const secret = options.waiterProvisionSecret ?? options.provisioning?.secret;
        if (!secret) error(404, "not_found");
        if (!isJson(req)) error(415, "unsupported_media_type");
        const auth = req.headers.authorization;
        if (typeof auth !== "string" || !/^Bearer [A-Za-z0-9_.-]{20,4096}$/.test(auth)) error(401, "unauthorized");
        let claims;
        try { claims = verifyWaiterTicket(auth.slice(7), secret); } catch { error(401, "unauthorized"); }
        if (stores.some(s => s.receiveInstallationId === claims.installationId))
          error(409, "idempotency_conflict");
        const waiterToken = createHmac("sha256", secret)
          .update(`gastronomy:waiter-connection:v1:${claims.licenseId}:${claims.installationId}`)
          .digest("base64url");
        const connection = store.provisionWaiterConnection({ ...claims, waiterToken, expiresAt: Date.now() + WAITER_CONNECTION_TTL_MS });
        if (!connection) error(409, "idempotency_conflict");
        return json(res, 201, { storeId: connection.storeId, waiterToken });
      }
      if (
        (req.method === "GET" || req.method === "PATCH") &&
        url.pathname === "/v1/web-sites/branding"
      ) {
        if (
          !scope ||
          scope.role !== "receive" ||
          !scope.receiveInstallationId ||
          req.headers["x-pos-installation"] !== scope.receiveInstallationId
        )
          error(401, "unauthorized");
        if (req.method === "GET") {
          const branding = store.getTenantBranding(scope.storeId);
          if (!branding) error(404, "not_found");
          return json(res, 200, branding);
        }
        if (!isJson(req)) error(415, "unsupported_media_type");
        const body = (await readJson(req)) as Record<string, unknown>;
        if (
          !body ||
          Object.keys(body).some(
            (k) => !["displayName", "tagline", "accent"].includes(k),
          ) ||
          typeof body.displayName !== "string" ||
          !body.displayName.trim() ||
          body.displayName.length > 80 ||
          typeof body.tagline !== "string" ||
          body.tagline.length > 160 ||
          typeof body.accent !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(body.accent)
        )
          error(400, "bad_request");
        if (
          !store.updateTenantBranding(scope.storeId, {
            displayName: body.displayName.trim(),
            tagline: body.tagline,
            accent: body.accent,
          })
        )
          error(403, "forbidden");
        return json(res, 200, store.getTenantBranding(scope.storeId));
      }
      if (req.method === "GET" && url.pathname === "/health")
        return json(res, 200, { ok: true });
      if (url.pathname === "/v1/web-catalog" && req.method === "PUT") {
        if (!scope || scope.role !== "receive") error(401, "unauthorized");
        const expectedStoreId = req.headers["x-expected-store-id"];
        if (
          typeof expectedStoreId !== "string" ||
          expectedStoreId !== scope.storeId
        )
          error(403, "forbidden");
        if (!isJson(req)) error(415, "unsupported_media_type");
        return json(
          res,
          200,
          store.publishCatalog(
            scope.storeId,
            await readJson(req, MAX_CATALOG_BODY),
          ),
        );
      }
      if (url.pathname === "/v1/web-catalog" && req.method === "GET") {
        if (!scope || scope.role !== "submit" || !scope.siteId)
          error(401, "unauthorized");
        const catalog = store.getCatalog(scope.storeId);
        return catalog
          ? json(res, 200, catalog)
          : json(res, 404, { error: "catalog_not_published" });
      }
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
          req.headers["x-require-published-catalog"] === "true",
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
      return json(res, status, {
        error:
          typeof candidate.code === "string" &&
          ["pairing_expired", "queue_full"].includes(candidate.code)
            ? candidate.code
            :
          status === 409 &&
          (candidate.code === "catalog_changed" ||
            candidate.code === "catalog_not_published")
            ? candidate.code
            : (codes[status] ?? "internal_error"),
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
          tenantStorefront?.close();
          waiterRelay?.close();
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
  if (process.env.WAITER_PROVISION_SECRET && process.env.WAITER_PROVISION_SECRET_FILE)
    throw new Error("Set only one waiter provisioning secret source");
  if (process.env.WAITER_PROVISION_SECRET_FILE && !isAbsolute(process.env.WAITER_PROVISION_SECRET_FILE))
    throw new Error("WAITER_PROVISION_SECRET_FILE must be absolute");
  const waiterProvisionSecret = process.env.WAITER_PROVISION_SECRET_FILE
    ? readFileSync(process.env.WAITER_PROVISION_SECRET_FILE, "utf8").trim()
    : process.env.WAITER_PROVISION_SECRET;
  if (
    process.env.WEB_SITE_PROVISION_SECRET &&
    process.env.WEB_SITE_PROVISION_SECRET_FILE
  )
    throw new Error("Set only one provisioning secret source");
  if (
    process.env.WEB_SITE_PROVISION_SECRET_FILE &&
    !isAbsolute(process.env.WEB_SITE_PROVISION_SECRET_FILE)
  )
    throw new Error("WEB_SITE_PROVISION_SECRET_FILE must be absolute");
  const provisionSecret = process.env.WEB_SITE_PROVISION_SECRET_FILE
    ? readFileSync(process.env.WEB_SITE_PROVISION_SECRET_FILE, "utf8").trim()
    : process.env.WEB_SITE_PROVISION_SECRET;
  if (Boolean(provisionSecret) !== Boolean(process.env.WEB_SITE_BASE_DOMAIN))
    throw new Error("Set a provisioning secret and WEB_SITE_BASE_DOMAIN");
  if (process.env.WAITER_PUBLIC_BASE_URL && !/^https:\/\//i.test(process.env.WAITER_PUBLIC_BASE_URL))
    throw new Error("WAITER_PUBLIC_BASE_URL must use HTTPS");
  if (!dbPath || (!configFile && !provisionSecret && !waiterProvisionSecret))
    throw new Error(
      "Set WEB_ORDERS_DB_PATH and WEB_ORDERS_CONFIG_FILE (or enable provisioning)",
    );
  const port = Number(process.env.PORT ?? 8098);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || !host)
    throw new Error("Invalid listen configuration");
  const service = createOrdersServer({
    dbPath,
    stores: configFile ? loadStores(configFile) : [],
    ...(provisionSecret && process.env.WEB_SITE_BASE_DOMAIN
      ? {
          provisioning: {
            secret: provisionSecret,
            baseDomain: process.env.WEB_SITE_BASE_DOMAIN,
            reservedSlugs: (process.env.WEB_SITE_RESERVED_SLUGS ?? "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          },
        }
      : {}),
    ...(waiterProvisionSecret ? { waiterProvisionSecret } : {}),
    ...(process.env.WAITER_PUBLIC_BASE_URL ? { waiterPublicBaseUrl: process.env.WAITER_PUBLIC_BASE_URL } : {}),
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
