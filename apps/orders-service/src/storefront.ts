import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  WebOrdersClient,
  WebOrdersHttpError,
  WebOrderValidationError,
  parseWebOrderSubmission,
} from "@gastronomy/web-orders";
import { storefrontHtml as html } from "./storefront-page.js";

const MAX_CHECKOUT = 16 * 1024;
type StorefrontOptions = {
  ordersUrl: string;
  storeId: string;
  submitToken: string;
  siteId: string;
  origin: string;
  rateLimit?: number;
};
function json(res: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
  });
  res.end(body);
}
async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > MAX_CHECKOUT) throw Object.assign(new Error(), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error(), { status: 400 });
  }
}
export function createStorefrontServer(options: StorefrontOptions): {
  server: Server;
  close: () => Promise<void>;
} {
  const origin = new URL(options.origin).origin;
  if (origin !== options.origin.replace(/\/$/, ""))
    throw new Error("origin must be an origin without trailing slash");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.siteId))
    throw new Error("Invalid siteId");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(options.storeId))
    throw new Error("Invalid storeId");
  const client = new WebOrdersClient(options.ordersUrl, options.submitToken),
    rates = new Map<string, { count: number; reset: number }>(),
    max = options.rateLimit ?? 20;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10000)
    throw new Error("Invalid storefront rate limit");
  const rateSweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, rate] of rates) if (rate.reset <= now) rates.delete(ip);
  }, 60_000);
  rateSweep.unref();
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", origin),
          ip = req.socket.remoteAddress ?? "unknown",
          now = Date.now();
        let rate = rates.get(ip);
        if (!rate && rates.size >= 10000)
          return json(res, 429, { error: "rate_limited" });
        if (!rate || rate.reset < now) {
          rate = { count: 0, reset: now + 60_000 };
          rates.set(ip, rate);
        }
        if (++rate.count > max)
          return json(res, 429, { error: "rate_limited" });
        if (req.method === "GET" && url.pathname === "/") {
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-length": Buffer.byteLength(html),
            "cache-control": "no-store",
            "content-security-policy":
              "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
          });
          return res.end(html);
        }
        if (req.headers.origin !== undefined && req.headers.origin !== origin)
          return json(res, 403, { error: "forbidden" });
        if (req.method === "GET" && url.pathname === "/api/catalog") {
          return json(
            res,
            200,
            await client.getCatalog({
              storeId: options.storeId,
              siteId: options.siteId,
            }),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/checkout") {
          if (req.headers.origin !== origin)
            return json(res, 403, { error: "forbidden" });
          if (
            !/^application\/json(?:\s*;|$)/i.test(
              req.headers["content-type"] ?? "",
            )
          )
            return json(res, 415, { error: "unsupported_media_type" });
          const key = req.headers["idempotency-key"];
          if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
            return json(res, 400, { error: "bad_request" });
          const submission = parseWebOrderSubmission(await body(req));
          if (
            submission.deliveryFeeMinor !== 0 ||
            submission.paymentMethod !== "OTHER" ||
            submission.requestedFor ||
            submission.items.some((item) => item.options || item.notes)
          )
            return json(res, 400, { error: "unsupported_checkout" });
          const result = await client.submit(submission, key, {
            requirePublishedCatalog: true,
            expectedStoreId: options.storeId,
            expectedSiteId: options.siteId,
          });
          return json(res, 201, result);
        }
        return json(res, 404, { error: "not_found" });
      } catch (e) {
        const status =
          (e as { status?: number }).status ??
          (e instanceof WebOrderValidationError ? 400 : 502);
        const code = e instanceof WebOrdersHttpError ? e.code : undefined;
        return json(res, status, {
          error:
            code ??
            (status === 413
              ? "too_large"
              : status === 400
                ? "bad_request"
                : status === 404
                  ? "catalog_not_published"
                  : "upstream_unavailable"),
        });
      }
    })();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.maxConnections = 100;
  server.on("connection", (socket) =>
    socket.setTimeout(15_000, () => socket.destroy()),
  );
  return {
    server,
    close: () => {
      clearInterval(rateSweep);
      return new Promise<void>((resolveClose, reject) =>
        server.close((err) => (err ? reject(err) : resolveClose())),
      );
    },
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const {
    WEB_STOREFRONT_ORDERS_URL,
    WEB_STOREFRONT_SUBMIT_TOKEN,
    WEB_STOREFRONT_SITE_ID,
    WEB_STOREFRONT_STORE_ID,
    WEB_STOREFRONT_ORIGIN,
  } = process.env;
  if (
    !WEB_STOREFRONT_ORDERS_URL ||
    !WEB_STOREFRONT_SUBMIT_TOKEN ||
    !WEB_STOREFRONT_SITE_ID ||
    !WEB_STOREFRONT_STORE_ID ||
    !WEB_STOREFRONT_ORIGIN
  )
    throw new Error(
      "Set WEB_STOREFRONT_ORDERS_URL, WEB_STOREFRONT_SUBMIT_TOKEN, WEB_STOREFRONT_SITE_ID, WEB_STOREFRONT_STORE_ID and WEB_STOREFRONT_ORIGIN",
    );
  const service = createStorefrontServer({
    ordersUrl: WEB_STOREFRONT_ORDERS_URL,
    submitToken: WEB_STOREFRONT_SUBMIT_TOKEN,
    siteId: WEB_STOREFRONT_SITE_ID,
    storeId: WEB_STOREFRONT_STORE_ID,
    origin: WEB_STOREFRONT_ORIGIN,
  });
  service.server.listen(
    Number(process.env.WEB_STOREFRONT_PORT ?? 8099),
    process.env.HOST ?? "127.0.0.1",
  );
}
