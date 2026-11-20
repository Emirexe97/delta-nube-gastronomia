import type { StorefrontCover, StorefrontProductPreview } from "./storefront-cover-types";

/** Editorial treatment shared by the POS storefront editor and the published menu. */
export const storefrontCoverCss = `
[data-storefront-cover]{--dn-field:#19221e;--dn-ivory:#fff9eb;--dn-display:Georgia,"Times New Roman",serif;container-type:inline-size;color:var(--dn-ivory);background:var(--dn-field);text-align:left;font-family:var(--dn-display)}
[data-storefront-cover] *{box-sizing:border-box}
.dn-cover__inner{position:relative;isolation:isolate;display:grid;grid-template-columns:1fr 1.15fr;max-width:1240px;margin:0 auto}
.dn-cover__frame,.dn-cover__art{position:relative;grid-area:1/2;margin:0;overflow:hidden;min-width:0;isolation:isolate}
.dn-cover__photo{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:55% 52%}
.dn-cover__identity{grid-area:1/1;position:relative;align-self:stretch;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;min-width:0;min-height:clamp(260px,27cqi,360px);padding:clamp(24px,3.5cqi,48px);padding-right:clamp(24px,4cqi,56px)}
.dn-cover__brandline{display:flex;align-items:center;gap:12px;min-width:0;margin-bottom:clamp(16px,2cqi,30px)}
.dn-cover__logo-frame{display:grid;place-items:center;width:48px;height:48px;flex:none;padding:2px;background:#fff;border-radius:12px;overflow:hidden}
.dn-cover__logo{display:block;width:100%;height:100%;object-fit:contain;border-radius:8px}
.dn-cover__label,.dn-cover__index{margin:0;color:var(--dn-ivory);font:600 .66rem/1.5 ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase}
.dn-cover__label{display:flex;align-items:center;gap:9px}.dn-cover__label::before{content:"";width:18px;height:2px;background:#e5ab79;background:color-mix(in srgb,var(--dn-accent,#9c4329) 55%,#ffe5b4)}
.dn-cover__name{color:var(--dn-ivory);font:normal clamp(46px,6.2cqi,84px)/.99 var(--dn-display);letter-spacing:-.055em;margin:0;overflow-wrap:anywhere;text-wrap:balance}
.dn-cover__tagline{font:400 clamp(15px,1.45cqi,18px)/1.45 system-ui,sans-serif;max-width:40ch;margin:14px 0 0;color:#f1ecdf;overflow-wrap:anywhere}
.dn-cover__index{position:absolute;right:15px;top:19px;writing-mode:vertical-rl;font-size:9px;color:#c0c7b8}
.dn-cover__art{display:grid;place-items:center;background:color-mix(in srgb,var(--dn-accent) 22%,var(--dn-field));color:color-mix(in srgb,var(--dn-accent) 35%,#f4d9b2)}
.dn-cover__art svg{width:68%;max-width:370px;height:auto;transform:rotate(-14deg)}
@container (max-width:649px){
 .dn-cover__inner{display:grid;grid-template-columns:minmax(0,1fr);min-height:0}
 .dn-cover__frame,.dn-cover__art,.dn-cover__identity{grid-area:1/1}
 .dn-cover__frame::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,17,13,.84),rgba(10,17,13,.28) 72%,rgba(10,17,13,.13)),linear-gradient(0deg,rgba(10,17,13,.8),transparent 90%)}
 .dn-cover__photo{object-position:center}.dn-cover__identity{justify-content:flex-end;min-height:clamp(225px,66cqi,300px);padding:22px 18px}
 .dn-cover__brandline{margin-bottom:16px;gap:10px}.dn-cover__logo-frame{width:40px;height:40px;border-radius:10px}
 .dn-cover__name{font-size:clamp(43px,11.3cqi,65px);max-width:17ch}.dn-cover__tagline{margin-top:9px;font-size:15px}
 .dn-cover__index{display:none}.dn-cover__art{background:var(--dn-field);justify-items:end}.dn-cover__art svg{max-width:220px;align-self:start;opacity:.23;transform:translate(15%,-2%) rotate(-14deg)}
}
`;

/** These card styles apply equally inside the phone frame, the private sample and live menu. */
export const storefrontProductCss = `
.dn-product{--dn-product-ink:var(--ink,#222520);--dn-product-line:var(--line,#dadbd2);--dn-product-accent:var(--accent,#9c4329);--dn-product-cta-ink:var(--accent-foreground,#fff);position:relative;box-sizing:border-box;min-width:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dn-product-line);border-radius:14px;color:var(--dn-product-ink);background:var(--card,#fffefa);font-family:system-ui,sans-serif}
.dn-product *{box-sizing:border-box}
.dn-product__photo-wrap{display:block;position:relative;flex:none;overflow:hidden;margin:0;aspect-ratio:4/3;background:#e7e4db}
.dn-product__photo{display:block;width:100%;height:100%;object-fit:cover}
.dn-product__content{min-width:0;display:grid;flex:1;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:1fr auto;align-items:center;gap:12px 6px;padding:16px}
.dn-product__name{grid-column:1/-1;align-self:start;color:var(--dn-product-ink);font:500 clamp(1.18rem,2.9cqi,1.6rem)/1.13 Georgia,"Times New Roman",serif;letter-spacing:-.025em;margin:0;overflow-wrap:anywhere}
.dn-product__price{color:var(--dn-product-ink);margin:0;font:650 .94rem/1.3 system-ui,sans-serif;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dn-product__add{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;justify-self:end;min-height:44px;border:0;border-radius:999px;padding:8px 14px;background:var(--dn-product-accent);color:var(--dn-product-cta-ink);font:650 .84rem/1 system-ui,sans-serif;cursor:pointer}
.dn-product__add::before{content:"";width:12px;height:12px;flex:none;background:linear-gradient(currentColor,currentColor) center/10px 2px no-repeat,linear-gradient(currentColor,currentColor) center/2px 10px no-repeat}
.dn-product__add:focus-visible{outline:3px solid #146098;outline-offset:-3px}
.dn-product__add:disabled{cursor:not-allowed;opacity:.55}.dn-product-preview .dn-product__add:disabled{opacity:1;cursor:default}
.dn-product--text-only{align-self:start}.dn-product--text-only .dn-product__content{grid-template-rows:auto auto;gap:5px 10px}.dn-product--text-only .dn-product__name{grid-column:1;grid-row:1}.dn-product--text-only .dn-product__price{grid-area:2/1}.dn-product--text-only .dn-product__add{grid-area:1/2/3/3}
.dn-product-preview{min-width:0;container:storefront-products / inline-size}
.dn-product-preview__category{display:flex;align-items:center;gap:12px;color:var(--ink,#222520);font:650 1.12rem/1.35 system-ui,sans-serif;letter-spacing:-.025em;margin:0 0 12px;overflow-wrap:anywhere}
.dn-product-preview__category::after{content:"";height:1px;flex:1;background:var(--line,#dadbd2)}
.dn-product-preview__items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@container storefront-products (min-width:521px){
 :is(.menu-grid,.dn-product-preview__items):has(>.dn-product--text-only)>.dn-product:not(.dn-product--text-only){display:grid;grid-template-columns:minmax(0,1fr) minmax(80px,32%);padding:12px;gap:10px;align-items:center}
 :is(.menu-grid,.dn-product-preview__items):has(>.dn-product--text-only)>.dn-product:not(.dn-product--text-only) .dn-product__photo-wrap{grid-area:1/2;border-radius:8px}
 :is(.menu-grid,.dn-product-preview__items):has(>.dn-product--text-only)>.dn-product:not(.dn-product--text-only) .dn-product__content{grid-area:1/1;grid-template-columns:1fr;align-items:start;gap:5px;padding:0}
 :is(.menu-grid,.dn-product-preview__items):has(>.dn-product--text-only)>.dn-product:not(.dn-product--text-only) .dn-product__add{width:44px;padding:0;position:absolute;right:6px;bottom:6px;font-size:0;gap:0;border:2px solid var(--card,#fffefa)}
}
@container storefront-products (max-width:520px){
 .dn-product-preview__items{grid-template-columns:1fr;gap:9px}
 .dn-product:not(.dn-product--text-only){display:grid;grid-template-columns:minmax(0,1fr) minmax(88px,35%);align-items:center;gap:10px;padding:10px}
 .dn-product__photo-wrap{grid-area:1/2;margin:0;border-radius:9px;aspect-ratio:4/3}
 .dn-product:not(.dn-product--text-only) .dn-product__content{display:flex;grid-area:1/1;flex-direction:column;align-items:flex-start;justify-content:center;min-width:0;gap:9px;padding:4px}
 .dn-product__name{font-size:1.17rem;line-height:1.16}.dn-product__price{font-size:.89rem}
 .dn-product__add{font-size:0;gap:0;min-height:44px;width:44px;padding:0;border:1px solid var(--dn-product-line)}
 .dn-product:not(.dn-product--text-only) .dn-product__add{position:absolute;right:6px;bottom:6px;border:2px solid var(--card,#fffefa)}
 .dn-product__add::before{width:16px;height:16px;background-size:13px 2px,2px 13px}
 .dn-product--text-only .dn-product__content{padding:12px 14px}.dn-product--text-only .dn-product__add{background:var(--card,#fffefa);color:var(--dn-product-ink)}
}
@media(hover:hover){.dn-product__add:not(:disabled):hover{filter:brightness(.9)}}
`;
export function storefrontAccentForeground(accent: string): string {
  const color = /^#[\da-f]{6}$/i.test(accent) ? accent : "#1f6f50";
  const rgb = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => { const c = ((rgb >> shift) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) => htmlEntities[char]!);
const dataJpeg = (src: string) => src.length <= 436931 && /^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(src);
const validPhotoUrl = (src: string) => /^\/media\/products\/(?:[a-z0-9_.!~*'()-]|%[\da-f]{2})+\.jpg\?v=[\da-f]{64}$/i.test(src);

function safeCoverImage(src: string | null | undefined, kind: "banner" | "logo"): string {
  if (!src) return "";
  const allowed = src === `/media/${kind}.jpg` || dataJpeg(src);
  return allowed ? src : "";
}

export function renderStorefrontCover(input: StorefrontCover): string {
  const accent = /^#[\da-f]{6}$/i.test(input.accent) ? input.accent : "#1f6f50";
  const bannerSrc = safeCoverImage(input.bannerSrc, "banner");
  const logoSrc = safeCoverImage(input.logoSrc, "logo");
  const banner = bannerSrc ? `<figure class="dn-cover__frame"><img class="dn-cover__photo" src="${bannerSrc}" width="1440" height="576" alt="" decoding="async"></figure>` : `<div class="dn-cover__art" aria-hidden="true"><svg viewBox="0 0 320 240" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" focusable="false">
<g transform="rotate(-10 160 120)"><circle cx="164" cy="120" r="97" stroke-width="2"/><circle cx="164" cy="120" r="91"/><circle cx="164" cy="120" r="77" stroke-dasharray="1 5"/><circle cx="164" cy="120" r="71"/>
<path d="M40 38v42m7-42v42m7-42v42M37 38v45q0 11 10 15v95q0 8 5 6l-2-101q9-4 9-16V38" stroke-width="2"/>
<path d="M283 37c-10 12-16 43-13 62l7 5-1 91q1 8 6 3l1-161Z" stroke-width="2"/>
<path d="M116 156q38-8 82-74m-58 62q-19-4-23-22 18 2 23 22Zm15-14q-8-13-2-26 10 14 2 26Zm18-19q-4-16 6-26 5 15-6 26Zm-27 27q17 7 30-7-19-4-30 7Zm24-22q17 2 27-13-18 1-27 13Z" stroke-width="2"/>
</g></svg></div>`;
  const logo = logoSrc ? `<span class="dn-cover__logo-frame"><img class="dn-cover__logo" src="${logoSrc}" width="128" height="108" alt="${escapeText(input.displayName.trim() || "Comercio")}" decoding="async"></span>` : "";
  const identityClass = (banner && logo ? " dn-cover__identity--with-banner-logo" : "") + (logo ? "" : " dn-cover__identity--no-logo");
  return `<header data-storefront-cover style="--dn-accent:${accent}"><div class="dn-cover__inner">${banner}<div class="dn-cover__identity${identityClass}"><div class="dn-cover__brandline">${logo}<p class="dn-cover__label">${input.unpublished ? "Tienda en preparación" : "Carta · pedidos online"}</p></div><h1 class="dn-cover__name">${escapeText(input.displayName.trim() || "Menú online")}</h1><p class="dn-cover__tagline">${escapeText(input.tagline.trim() || "Elegí tus favoritos.")}</p><span class="dn-cover__index" aria-hidden="true">A LA CARTA</span></div></div></header>`;
}

/** A visual-only, text-safe card preview for the POS editor; it shares all product-card classes with the storefront. */
export function renderStorefrontProductPreview(input: StorefrontProductPreview): string {
  return renderProductPreviewGroup(input.category, [input]);
}

function renderProductCard(input: StorefrontProductPreview): string {
  const photo = input.photoSrc && (validPhotoUrl(input.photoSrc) || dataJpeg(input.photoSrc)) ? input.photoSrc : "";
  const currency = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
  const price = Number.isSafeInteger(input.priceMinor) && input.priceMinor >= 0 ? currency.format(input.priceMinor / 100) : "—";
  const name = input.name.trim() || "Producto";
  const photoMarkup = photo ? `<figure class="dn-product__photo-wrap"><img class="dn-product__photo" src="${photo}" width="1200" height="900" alt="" ${photo.startsWith("data:") ? 'loading="eager"' : 'loading="lazy"'} decoding="async"></figure>` : "";
  return `<article class="dn-product${photo ? "" : " dn-product--text-only"}">${photoMarkup}<div class="dn-product__content"><h4 class="dn-product__name">${escapeText(name)}</h4><p class="dn-product__price">${price}</p><button class="dn-product__add" type="button" disabled aria-label="Agregar ${escapeText(name)}">Agregar</button></div></article>`;
}

function renderProductPreviewGroup(category: string, items: StorefrontProductPreview[]): string {
  const cards = items.map(renderProductCard).join("");
  return `<section class="dn-product-preview"><h3 class="dn-product-preview__category">${escapeText(category.trim())}</h3><div class="dn-product-preview__items">${cards}</div></section>`;
}

/** Compact POS context: at most four sample products, grouped under one category heading. */
export function renderStorefrontProductSample(items: StorefrontProductPreview[]): string {
  const groups = new Map<string, StorefrontProductPreview[]>();
  for (const item of items.slice(0, 4)) {
    const category = item.category.trim();
    const group = groups.get(category) ?? [];
    group.push(item);
    groups.set(category, group);
  }
  return [...groups].map(([category, products]) => renderProductPreviewGroup(category, products)).join("");
}
