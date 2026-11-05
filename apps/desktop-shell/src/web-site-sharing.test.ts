import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import QRCode from "qrcode";
// @ts-expect-error Node test helper is intentionally plain JavaScript for e2e reuse.
import { decodeWebSiteQr } from "../test/verify-website-qr.mjs";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { canonicalStorefrontUrl, shareWebSite } from "./web-site-sharing.ts";

const active = {
  state: "ACTIVE",
  slug: "pizzeria-sur",
  url: "https://pizzeria-sur.deltanubeweb.com",
};
const deps = (overrides: Record<string, unknown> = {}) => ({
  getStatus: async () => active,
  openExternal: async () => {},
  writeClipboard: () => {},
  showSaveDialog: async () => ({ canceled: true }),
  toBuffer: (url: string) =>
    QRCode.toBuffer(url, {
      type: "png",
      errorCorrectionLevel: "H",
      margin: 4,
      scale: 12,
    }),
  ...overrides,
});

test("accepts only the canonical HTTPS storefront root", () => {
  assert.equal(canonicalStorefrontUrl(active), active.url);
  for (const url of [
    "http://pizzeria-sur.deltanubeweb.com",
    "https://pizzeria-sur.deltanubeweb.com.evil.test",
    "https://pizzeria-sur.deltanubeweb.com@evil.test",
    "https://user@pizzeria-sur.deltanubeweb.com",
    "https://pizzeria-sur.deltanubeweb.com:443",
    "https://pizzeria-sur.deltanubeweb.com/menu",
    "https://pizzeria-sur.deltanubeweb.com/?x=1",
    "https://PIZZERIA-SUR.deltanubeweb.com",
  ]) {
    assert.throws(() => canonicalStorefrontUrl({ ...active, url }));
  }
  assert.throws(() => canonicalStorefrontUrl({ ...active, state: "ERROR" }));
});

test("opens and copies only locally read ACTIVE URL", async () => {
  const seen: string[] = [];
  await shareWebSite(
    "open",
    deps({
      openExternal: async (url: string) => {
        seen.push(url);
      },
    }),
  );
  await shareWebSite(
    "copy",
    deps({
      writeClipboard: (url: string) => {
        seen.push(url);
      },
    }),
  );
  assert.deepEqual(seen, [active.url, active.url]);
  await assert.rejects(
    shareWebSite(
      "copy",
      deps({ getStatus: async () => ({ ...active, state: "UNCONFIGURED" }) }),
    ),
  );
});

test("canceling QR save writes nothing; chosen path gets a real PNG", async () => {
  let writes = 0;
  await shareWebSite(
    "qr",
    deps({
      writeFile: async () => {
        writes++;
      },
    }),
  );
  assert.equal(writes, 0);
  const dir = await mkdtemp(join(tmpdir(), "website-qr-"));
  try {
    const path = join(dir, "menu.png");
    const result = await shareWebSite(
      "qr",
      deps({
        showSaveDialog: async () => ({ canceled: false, filePath: path }),
      }),
    );
    const png = await readFile(path);
    assert.equal(result.completed, true);
    assert.deepEqual(
      png.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.equal(decodeWebSiteQr(png), active.url);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
