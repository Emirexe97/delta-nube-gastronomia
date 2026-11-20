import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  renderStorefrontCover,
  storefrontCoverCss,
  renderStorefrontProductSample,
  type StorefrontProductPreview,
  storefrontProductCss,
  storefrontAccentForeground,
} from "@gastronomy/ui/storefront-cover";
import {
  parseBannerDataUrl,
  LOGO_JPEG_LIMITS,
  PRODUCT_PHOTO_JPEG_LIMITS,
  type JpegImageLimits,
} from "./banner-image.js";

const TTL = 10 * 60_000;
const digest = (text: string) => createHash("sha256").update(text).digest();
const fail = (status: number, code: string): never => {
  throw Object.assign(new Error(code), { status, code });
};
const invalid = () => fail(400, "invalid_preview");
const keys = (val: unknown, names: string[]): val is Record<string, unknown> =>
  !!val &&
  typeof val === "object" &&
  !Array.isArray(val) &&
  Object.keys(val).length === names.length &&
  names.every((k) => Object.hasOwn(val, k));
function string(value: unknown, max: number, empty = false): string {
  return typeof value === "string" &&
    value.length <= max &&
    (empty || value.trim())
    ? value.trim()
    : invalid();
}
function image(value: unknown, limits?: JpegImageLimits): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid();
  try {
    parseBannerDataUrl(value, limits);
  } catch {
    return invalid();
  }
  return value;
}

/** Ephemeral capabilities are scoped to a single tenant. Never persist a token,
 * contact, order, catalog, or draft, and never put the capability in an HTTP URL. */
export function mobilePreviewCache(now: () => number = Date.now) {
  type Entry = {
    hash: Buffer;
    html: string;
    bytes: number;
    until: number;
    timer: NodeJS.Timeout;
  };
  const entries = new Map<string, Entry>();
  let totalBytes = 0;
  function drop(id: string) {
    const entry = entries.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      totalBytes -= entry.bytes;
      entries.delete(id);
    }
  }
  return {
    put(store: string, html: string) {
      const time = now(),
        bytes = Buffer.byteLength(html);
      for (const [id, e] of entries) if (e.until <= time) drop(id);
      const prior = entries.get(store);
      if (
        (!prior && entries.size >= 256) ||
        totalBytes - (prior?.bytes ?? 0) + bytes > 32 * 1024 * 1024
      )
        return fail(429, "preview_capacity");
      const token = randomBytes(32).toString("base64url"),
        until = time + TTL;
      drop(store);
      const timer = setTimeout(() => drop(store), TTL);
      timer.unref();
      entries.set(store, { hash: digest(token), html, bytes, until, timer });
      totalBytes += bytes;
      return { token, expiresAt: new Date(until).toISOString() };
    },
    read(store: string, token: string) {
      const entry = entries.get(store);
      if (!entry) return null;
      if (entry.until <= now()) {
        drop(store);
        return null;
      }
      if (
        !/^[a-zA-Z0-9_-]{43}$/.test(token) ||
        !timingSafeEqual(digest(token), entry.hash)
      )
        return null;
      return entry.html;
    },
    clear() {
      for (const id of entries.keys()) drop(id);
    },
  };
}
type Cache = ReturnType<typeof mobilePreviewCache>;

export function acceptMobilePreview(
  cache: Cache,
  storeId: string,
  draft: unknown,
  publishedSample: (
    selectedRef: string | null,
  ) => StorefrontProductPreview[] = () => [],
) {
  if (
    !keys(draft, [
      "displayName",
      "tagline",
      "accent",
      "bannerDataUrl",
      "logoDataUrl",
      "product",
    ])
  )
    return invalid();
  const displayName = string(draft.displayName, 80),
    tagline = string(draft.tagline, 160, true),
    accent = string(draft.accent, 7);
  if (!/^#[a-f0-9]{6}$/i.test(accent)) return invalid();
  const bannerSrc = image(draft.bannerDataUrl),
    logoSrc = image(draft.logoDataUrl, LOGO_JPEG_LIMITS);
  let selectedRef: string | null = null;
  const sample: StorefrontProductPreview[] = [];
  if (draft.product !== null) {
    const p = draft.product;
    if (
      !keys(p, [
        "productRef",
        "name",
        "category",
        "priceMinor",
        "photoDataUrl",
      ]) ||
      typeof p.productRef !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(p.productRef) ||
      typeof p.priceMinor !== "number" ||
      !Number.isSafeInteger(p.priceMinor) ||
      p.priceMinor < 0 ||
      p.priceMinor > 999_999_999_999
    )
      return invalid();
    selectedRef = p.productRef;
    sample.push({
      name: string(p.name, 120),
      category: string(p.category, 80),
      priceMinor: p.priceMinor,
      photoSrc: image(p.photoDataUrl, PRODUCT_PHOTO_JPEG_LIMITS),
    });
  }
  // Preview the draft beside real dishes, or show published dishes when only the logo changes.
  // Context comes from this tenant's public snapshot, never the POS's unpublished inventory.
  sample.push(...publishedSample(selectedRef));
  const card = sample.length ? renderStorefrontProductSample(sample) : "";
  const cover = renderStorefrontCover({
    displayName,
    tagline,
    accent,
    bannerSrc,
    logoSrc,
  });
  const style = `
    *{box-sizing:border-box}body{--ink:#222520;--muted:#5b6159;--line:#dadbd2;--card:#fffefa;margin:0;background:#faf9f5;color:var(--ink);font:16px/1.45 system-ui,sans-serif}
    .private{margin:0;padding:8px 14px;background:#e6eddf;color:#25362c;text-align:center;font:650 .8rem/1.5 system-ui,sans-serif}
    .sample{--accent:${accent};--accent-foreground:${storefrontAccentForeground(accent)};max-width:740px;margin:0 auto;padding:22px 16px 44px}
    .sample-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 20px}
    .sample h2{font:normal clamp(2.4rem,4.2vw,3.65rem)/1 Georgia,serif;letter-spacing:-.055em;margin:0}
    .sample-head small{font:500 .71rem/1.2 ui-monospace,Consolas,monospace;color:var(--muted)}
    .sample .dn-product-preview+.dn-product-preview{margin-top:24px}
    .sample fieldset{container:storefront-products / inline-size;margin:0;padding:0;border:0;min-width:0}
    ${storefrontCoverCss}\n${storefrontProductCss}`;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista privada de la carta</title><style>${style}</style><body><p class="private">Vista privada · Sin publicar · No recibe pedidos</p>${cover}${card ? '<main class="sample"><div class="sample-head"><h2>La carta</h2><small>Muestra · Para retirar</small></div><fieldset disabled>' + card + "</fieldset></main>" : ""}</body></html>`;
  return cache.put(storeId, html);
}

const openScript = `(()=>{const key=location.hash.slice(1);history.replaceState(null,"",location.pathname);if(!/^[A-Za-z0-9_-]{43}$/.test(key)){document.querySelector("p").textContent="Este enlace no es válido. Generá otro desde el POS.";return;}document.querySelector("input").value=key;document.querySelector("form").submit();})();`;
const openHash = digest(openScript).toString("base64");
const startHtml = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista privada</title><p>Abriendo vista privada…</p><form method="post" action="/vista-previa"><input type="hidden" name="token"></form><script>${openScript}</script></html>`;
export async function serveMobilePreview(
  cache: Cache,
  store: string,
  unavailable: boolean,
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
): Promise<true> {
  const landing = req.method === "GET" && !unavailable;
  const send = (status: number, html: string) => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
      "referrer-policy": landing ? "same-origin" : "no-referrer",
      "content-security-policy": landing
        ? `default-src 'none'; script-src 'sha256-${openHash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
        : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.end(html);
    return true as const;
  };
  const denied = () =>
    send(
      404,
      '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista no disponible</title><h1>Vista no disponible</h1><p>El enlace venció o fue reemplazado. Generá uno nuevo desde el POS.</p></html>',
    );
  if (unavailable) return denied();
  if (landing) return send(200, startHtml);
  if (
    req.method !== "POST" ||
    req.headers.origin !== origin ||
    !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(
      req.headers["content-type"] ?? "",
    ) ||
    Number(req.headers["content-length"]) > 128
  )
    return denied();
  const parts: Buffer[] = [];
  let size = 0;
  for await (const piece of req) {
    const chunk = Buffer.from(piece);
    size += chunk.length;
    if (size > 128) return denied();
    parts.push(chunk);
  }
  const form = new URLSearchParams(Buffer.concat(parts).toString("utf8"));
  const html = form.size === 1 && cache.read(store, form.get("token") ?? "");
  return html ? send(200, html) : denied();
}
