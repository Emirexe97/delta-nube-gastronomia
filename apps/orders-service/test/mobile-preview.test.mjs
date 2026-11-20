import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptMobilePreview,
  mobilePreviewCache,
} from "../dist/mobile-preview.js";

const sample = {
  displayName: "Casa del Río",
  tagline: "Comida de estación",
  accent: "#513727",
  bannerDataUrl: null,
  logoDataUrl: null,
  product: {
    productRef: "ensalada",
    name: "Ensalada de la huerta",
    category: "Entradas",
    priceMinor: 123450,
    photoDataUrl: null,
  },
};
test("a phone preview is tenant-scoped, revocable by replacement and expires on time", () => {
  let now = 10_000;
  const cache = mobilePreviewCache(() => now);
  try {
    const one = acceptMobilePreview(cache, "shop-a", sample);
    assert.equal(Date.parse(one.expiresAt), now + 600_000);
    const markup = cache.read("shop-a", one.token);
    assert.match(markup, /Ensalada de la huerta/);
    assert.match(markup, /<fieldset disabled/);
    assert.doesNotMatch(markup, /<form|<script|api\/checkout/);
    assert.equal(cache.read("shop-b", one.token), null);
    const next = acceptMobilePreview(cache, "shop-a", {
      ...sample,
      product: null,
    });
    assert.equal(cache.read("shop-a", one.token), null);
    assert.doesNotMatch(
      cache.read("shop-a", next.token),
      /Ensalada de la huerta/,
    );
    now += 600_000;
    assert.equal(cache.read("shop-a", next.token), null);
  } finally {
    cache.clear();
  }
});
test("preview creation refuses unknown fields, invalid prices and arbitrary image URLs", () => {
  const cache = mobilePreviewCache();
  for (const edit of [
    { notes: "internas" },
    { accent: "rose" },
    { logoDataUrl: "https://assets.invalid/logo" },
    { product: { ...sample.product, priceMinor: -1 } },
  ]) {
    assert.throws(
      () => acceptMobilePreview(cache, "shop-a", { ...sample, ...edit }),
      { status: 400 },
    );
  }
  cache.clear();
});
