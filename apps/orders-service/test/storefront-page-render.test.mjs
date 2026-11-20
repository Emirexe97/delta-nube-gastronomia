import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  renderTenantStorefront,
  storefrontHtml,
  storefrontScriptCspHash,
} from "../dist/storefront-page.js";
import { renderStorefrontCover, renderStorefrontProductPreview, renderStorefrontProductSample, storefrontAccentForeground, storefrontProductCss } from "@gastronomy/ui/storefront-cover";

const site = (overrides = {}) => ({
  display_name: "Casa del Río",
  tagline: "Cocina de estación",
  accent: "#8b2635",
  design_mode: "STANDARD",
  template_key: null,
  has_banner: false,
  has_logo: false,
  ...overrides,
});

test("rendered menu uses the shared cover and keeps fulfillment controls and confirmation separate", () => {
  const html = renderTenantStorefront(site(), true);
  assert.match(html, /data-storefront-cover/);
  assert.match(html, /Casa del Río/);
  assert.match(html, /Cocina de estación/);
  assert.match(html, /Cocina de estación/);
  assert.match(html, /<section class="order-controls">[\s\S]*id="channel"/);
  assert.match(html, /El costo y la zona de envío se confirman/);
  assert.match(html, /El comercio debe confirmar disponibilidad e importe/);
  assert.match(html, /<main>[\s\S]*<h2>La carta<\/h2>/);
  assert.match(html, /--accent: #8b2635/);
});

test("banner and unpublished state are passed to cover without allowing merchant markup", () => {
  const html = renderTenantStorefront(
    site({
      display_name: `<img src=x onerror="alert(1)">`,
      tagline: `<script>alert(2)</script>`,
      has_banner: true,
    }),
    false,
  );
  assert.match(html, /src="\/media\/banner\.jpg"/);
  assert.match(html, /Tienda en preparación/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  assert.match(html, /La carta todavía no está publicada/);
});

test("cover redesign leaves the bundled script CSP digest stable and CUSTOM remains allowlisted", () => {
  const html = renderTenantStorefront(
    site({ design_mode: "CUSTOM", template_key: "midnight-market-v1" }),
    true,
  );
  const [script] = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  assert.equal(
    createHash("sha256").update(script).digest("base64"),
    storefrontScriptCspHash,
  );
  assert.match(html, /--dn-field:#172321/);
  const unknown = renderTenantStorefront(
    site({ design_mode: "CUSTOM", template_key: "unknown" }),
    true,
  );
  assert.doesNotMatch(unknown, /--dn-field:#172321/);
});

test("pilot and tenant renderers both provide one valid shared hero without nested headers", () => {
  // The fixed pilot serves storefrontHtml directly instead of calling the tenant renderer.
  const pilot = storefrontHtml;
  assert.match(pilot, /data-storefront-cover/);
  assert.equal((pilot.match(/<header\b/g) ?? []).length, 1);
  assert.doesNotMatch(pilot, /STOREFRONT_COVER/);
  assert.match(pilot, /<div class="hero"><header data-storefront-cover/);
});

test("catalog navigation, mobile cart access, and accessible accent foreground are rendered", () => {
  const html = renderTenantStorefront(site({ accent: "#fefefe" }), true);
  assert.match(html, /id="categoryJump"/);
  assert.match(html, /id="cartJump"[^>]+href="#cartTitle"[^>]+hidden/);
  assert.match(html, /Volver a la carta/);
  assert.match(html, /--accent-foreground: #000000/);
  assert.match(html, /color: var\(--accent-foreground\)/);
  assert.match(html, /\.dn-product__price\{[^}]*color:var\(--dn-product-ink\)/);
  assert.match(html, /IntersectionObserver/);
  assert.doesNotMatch(html, /animationDelay|@keyframes rise/);
});

test("custom cover keeps its own light text and button foreground contrasts with merchant accent", () => {
  const lightAccent = renderTenantStorefront(
    site({
      accent: "#f0edcc",
      design_mode: "CUSTOM",
      template_key: "midnight-market-v1",
    }),
    true,
  );
  assert.match(lightAccent, /--accent-foreground: #000000/);
  assert.match(lightAccent, /--dn-ivory:#f6f1e8/);
  assert.doesNotMatch(lightAccent, /dn-cover__name\{color:var\(--ink\)\}/);
  assert.match(lightAccent, /\.hero\{background-color:#172321\}/);
});

test("merchant logo is rendered in a white contain-fit frame and remains text-safe", () => {
  const html = renderTenantStorefront(site({ has_banner: true, has_logo: true }), true);
  assert.match(html, /src="\/media\/logo\.jpg"/);
  assert.match(html, /class="dn-cover__logo-frame"/);
  assert.match(html, /<div class="dn-cover__identity dn-cover__identity--with-banner-logo"/);
  assert.match(html, /class="dn-cover__logo"[^>]+object-fit:contain|\.dn-cover__logo\{[^}]*object-fit:contain/);
  const noLogo = renderTenantStorefront(site({ has_banner: true }), true);
  assert.doesNotMatch(noLogo, /<span class="dn-cover__logo-frame"/);
  assert.match(noLogo, /<div class="dn-cover__identity dn-cover__identity--no-logo"/);
  assert.doesNotMatch(noLogo, /<div class="dn-cover__identity dn-cover__identity--with-banner-logo"/);
  const hostile = renderStorefrontCover({ displayName: `</h1><script>`, tagline: "Menu", accent: "#aabbcc", logoSrc: `data:image/jpeg;base64,${"a".repeat(32)}` });
  assert.match(hostile, /alt="&lt;\/h1&gt;&lt;script&gt;"/);
  assert.doesNotMatch(hostile, /<script>/);
});

test("POS product preview and storefront cards share photo composition without fake placeholders", () => {
  const photo = `data:image/jpeg;base64,${"a".repeat(32)}`;
  const preview = renderStorefrontProductPreview({ name: "Empanada", category: "Horno", priceMinor: 245000, photoSrc: photo });
  assert.match(preview, /class="dn-product__photo-wrap"/);
  assert.match(preview, /class="dn-product__photo"/);
  assert.match(preview, /<article class="dn-product">[\s\S]*class="dn-product__name">Empanada/);
  assert.match(preview, /class="dn-product-preview__category">Horno/);
  assert.match(preview, /class="dn-product__price">\$\s*2\.450,00/);
  assert.match(preview, /class="dn-product__add"/);
  assert.match(storefrontProductCss, /aspect-ratio:4\/3/);
  assert.match(storefrontProductCss, /container storefront-products/);
  assert.equal(storefrontAccentForeground("#fefefe"), "#000000");
  assert.equal(storefrontAccentForeground("#101010"), "#ffffff");
  const noPhoto = renderStorefrontProductPreview({ name: `<img src=x>`, category: "Carta", priceMinor: 100 });
  assert.match(noPhoto, /dn-product--text-only/);
  assert.doesNotMatch(noPhoto, /photo-wrap|<img/);
  assert.match(noPhoto, /&lt;img src=x&gt;/);
  const untrustedUrl = renderStorefrontProductPreview({ name: "X", category: "Y", priceMinor: 1, photoSrc: "https://evil.example/image.jpg" });
  assert.doesNotMatch(untrustedUrl, /evil\.example/);
});

test("POS sample groups same-category real dishes under one heading and caps at four cards", () => {
  const html = renderStorefrontProductSample([
    { name: "Ñoquis", category: "Pastas", priceMinor: 80000 },
    { name: "Ravioles", category: "Pastas", priceMinor: 110000 },
  ]);
  assert.equal((html.match(/class="dn-product-preview__category"/g) ?? []).length, 1);
  assert.equal((html.match(/<article class="dn-product/g) ?? []).length, 2);
  assert.equal((html.match(/class="dn-product__add"/g) ?? []).length, 2);
  assert.equal((html.match(/Pastas/g) ?? []).length, 1);
  assert.match(html, /class="dn-product-preview__items"/);
  const capped = renderStorefrontProductSample([
    { name: "1", category: "Pastas", priceMinor: 100 },
    { name: "2", category: "Pastas", priceMinor: 100 },
    { name: "3", category: "Pastas", priceMinor: 100 },
    { name: "4", category: "Pastas", priceMinor: 100 },
    { name: "5", category: "Pastas", priceMinor: 100 },
  ]);
  assert.equal((capped.match(/<article class="dn-product/g) ?? []).length, 4);
});

test("public photo envelope is validated separately from the strict checkout snapshot", () => {
  const html = renderTenantStorefront(site({ has_logo: true }), true);
  assert.match(html, /Array\.isArray\(envelope\.productPhotos\)/);
  assert.match(html, /\^\[a-f0-9\]\{64\}\$/i);
  assert.match(html, /\/media\/products\/" \+ segment \+ "\.jpg\?v=" \+ photoVersion/);
  assert.match(html, /image\.loading = "lazy"/);
  assert.match(html, /frame\.remove\(\)/);
  assert.doesNotMatch(html.slice(html.indexOf("function operationBody"), html.indexOf("function savePending")), /productPhotos|photoVersion|\.jpg/);
});
