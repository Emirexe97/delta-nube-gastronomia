import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PNG } from "pngjs";

const read = (path) => readFile(new URL("../" + path, import.meta.url));
const { build } = JSON.parse(await read("package.json"));
const source = "../gastronomy-portal/public/portal-assets/";

test("the renderer uses the portal's exact two original brand assets", async () => {
  for (const part of ["marca.png", "simbolo.png"]) {
    assert.deepEqual(
      await read("../gastronomy-web/src/assets/brand/" + part),
      await read(source + part),
    );
  }
});

test("native window, Windows and macOS resources contain the symbol without a wordmark", async () => {
  const { from, to } = build.extraResources.find(
    (r) => r.to === "icons/app-icon.png",
  );
  assert.equal(to, "icons/app-icon.png");
  const original = PNG.sync.read(await read(source + "simbolo.png"));
  // Compare colors at the same points across the entire tile (dark tile, white
  // cloud and orange cutlery), allowing for antialiasing in each representation.
  function checkTile(bytes, size, inset = 0) {
    const image = PNG.sync.read(bytes);
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    assert.equal(image.data[3], 0, "outside tile should be transparent");
    let error = 0,
      samples = 0;
    for (let y = 0.08; y < 0.93; y += 0.04)
      for (let x = 0.08; x < 0.93; x += 0.04) {
        const i =
          (Math.floor(y * original.height) * original.width +
            Math.floor(x * original.width)) *
          4;
        const pos = (t) => Math.floor((inset + t * (1 - 2 * inset)) * size);
        const j = (pos(y) * size + pos(x)) * 4;
        for (let c = 0; c < 3; c++, samples++)
          error += Math.abs(original.data[i + c] - image.data[j + c]);
      }
    assert.ok(error / samples < 8, "native icon must match the portal symbol");
  }
  checkTile(await read(from), 256);
  assert.equal(build.nsis.installerIcon, build.win.icon);
  assert.equal(build.nsis.uninstallerIcon, build.win.icon);
  const ico = await read(build.win.icon);
  assert.equal(ico.readUInt32LE(0), 0x00010000);
  const sizes = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + i * 16,
      w = ico[entry] || 256,
      start = ico.readUInt32LE(entry + 12);
    sizes.push(w);
    if (w === 256)
      checkTile(ico.subarray(start, start + ico.readUInt32LE(entry + 8)), w);
  }
  for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size));
  const icns = await read(build.mac.icon);
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const chunks = [];
  for (let off = 8; off < icns.length;) {
    const type = icns.toString("ascii", off, off + 4),
      len = icns.readUInt32BE(off + 4);
    assert.ok(len > 8 && off + len <= icns.length);
    chunks.push(type);
    if (type === "ic10")
      checkTile(icns.subarray(off + 8, off + len), 1024, 25 / 298);
    off += len;
  }
  for (const type of ["icp4", "ic07", "ic08", "ic09", "ic10"])
    assert.ok(chunks.includes(type));
});
