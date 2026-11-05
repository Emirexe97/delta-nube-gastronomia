import { type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { OrdersStore } from "./store.js";
import {
  renderTenantStorefront,
  storefrontScriptCspHash,
} from "./storefront-page.js";
import {
  parseWebOrderSubmission,
  WebOrderValidationError,
} from "@gastronomy/web-orders";

const MAX_CHECKOUT = 16 * 1024;
export type TenantSite = {
  store_id: string;
  slug: string;
  display_name: string;
  tagline: string;
  accent: string;
  design_mode: "STANDARD" | "CUSTOM";
  template_key: string | null;
};
export type TenantStorefrontOptions = {
  dbPath: string;
  store?: OrdersStore;
  hostSuffix: string;
  reservedHosts?: string[];
  rateLimit?: number;
  protocol?: "http" | "https";
};
export function resolveTenantHost(
  hostHeader: string | undefined,
  suffixInput: string,
  reserved: string[] = [],
): string | undefined {
  if (
    !hostHeader ||
    hostHeader.length > 255 ||
    /[,\s/@\\#?%]/.test(hostHeader) ||
    hostHeader.includes("://")
  )
    return;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return;
  }
  const suffix = suffixInput.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (
    !suffix ||
    !/^[a-z0-9.-]+$/.test(suffix) ||
    hostname === suffix ||
    !hostname.endsWith(`.${suffix}`)
  )
    return;
  const slug = hostname.slice(0, -(suffix.length + 1));
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ||
    reserved.map((x) => x.toLowerCase()).includes(slug)
  )
    return;
  return slug;
}
function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}
async function readBody(req: IncomingMessage): Promise<unknown> {
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
export function createTenantStorefront(options: TenantStorefrontOptions) {
  if (!isAbsolute(options.dbPath)) throw new Error("dbPath must be absolute");
  if (!/^[a-z0-9.-]+$/i.test(options.hostSuffix))
    throw new Error("Invalid host suffix");
  const max = options.rateLimit ?? 600;
  if (!Number.isSafeInteger(max) || max < 1 || max > 10000)
    throw new Error("Invalid storefront rate limit");
  // Local DB access is intentional: public requests never select a store/site themselves.
  const db = options.store ?? new OrdersStore(options.dbPath, []);
  const rates = new Map<string, { count: number; reset: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, r] of rates) if (r.reset <= now) rates.delete(ip);
  }, 60_000);
  sweep.unref();
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    trustedHost: string | undefined,
  ): Promise<boolean> {
    const slug = resolveTenantHost(
      trustedHost,
      options.hostSuffix,
      options.reservedHosts,
    );
    if (!slug) return false;
    const site = db.getTenantBySlug(slug) as TenantSite | undefined;
    if (!site) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    const origin =
      options.protocol === "http"
        ? new URL(`http://${trustedHost}`).origin
        : `https://${slug}.${options.hostSuffix.toLowerCase()}`;
    const url = new URL(req.url ?? "/", origin);
    const ip = req.socket.remoteAddress ?? "unknown",
      now = Date.now();
    // A per-tenant bucket avoids unrelated tenants sharing one proxy/NAT bucket.
    const rateKey = `${site.slug}\0${ip}`;
    let rate = rates.get(rateKey);
    if (!rate && rates.size >= 10000) {
      json(res, 429, { error: "rate_limited" });
      return true;
    }
    if (!rate || rate.reset < now) {
      rate = { count: 0, reset: now + 60_000 };
      rates.set(rateKey, rate);
    }
    if (++rate.count > max) {
      json(res, 429, { error: "rate_limited" });
      return true;
    }
    const headers = {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'self'; script-src 'sha256-${storefrontScriptCspHash}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
    };
    if (req.method === "GET" && url.pathname === "/") {
      const catalog = db.getCatalog(site.store_id);
      const html = renderTenantStorefront(site, Boolean(catalog));
      res.writeHead(200, headers);
      res.end(html);
      return true;
    }
    if (req.headers.origin !== undefined && req.headers.origin !== origin) {
      json(res, 403, { error: "forbidden" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/catalog") {
      const catalog = db.getCatalog(site.store_id);
      if (!catalog) {
        json(res, 200, {
          published: false,
          snapshot: { products: [] },
          revision: 0,
        });
        return true;
      }
      json(res, 200, { published: true, ...catalog });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/checkout") {
      if (req.headers.origin !== origin) {
        json(res, 403, { error: "forbidden" });
        return true;
      }
      if (
        !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
      ) {
        json(res, 415, { error: "unsupported_media_type" });
        return true;
      }
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
        json(res, 400, { error: "bad_request" });
        return true;
      }
      try {
        const submission = parseWebOrderSubmission(await readBody(req));
        if (
          submission.deliveryFeeMinor !== 0 ||
          submission.paymentMethod !== "OTHER" ||
          submission.requestedFor ||
          submission.items.some((i) => i.options || i.notes)
        ) {
          json(res, 400, { error: "unsupported_checkout" });
          return true;
        }
        const result = db.submit(site.store_id, "web", key, submission, true);
        json(res, result.status, result.result);
        return true;
      } catch (e) {
        const status =
          (e as { status?: number }).status ??
          (e instanceof WebOrderValidationError ? 400 : 502);
        json(res, status, {
          error:
            status === 400
              ? "bad_request"
              : ((e as { code?: string }).code ?? "upstream_unavailable"),
        });
        return true;
      }
    }
    json(res, 404, { error: "not_found" });
    return true;
  }
  return {
    handle,
    close: () => {
      clearInterval(sweep);
      if (!options.store) db.close();
    },
  };
}
