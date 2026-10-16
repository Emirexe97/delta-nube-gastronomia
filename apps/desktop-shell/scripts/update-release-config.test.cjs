const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const source = readFileSync(join(__dirname, "../electron-builder.updates.cjs"), "utf8");
const base = require("../package.json").build;
function evaluate(config, platform) {
  const context = { URL, process: { platform, arch: "x64", argv: [] }, module: { exports: {} }, require: (file) => file === "./package.json" ? { build: base } : config };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
test("signed update release config refuses disabled defaults and unsafe URLs", () => {
  assert.throws(() => evaluate({ enabled: false }, "win32"), /Configure/);
  for (const feedUrl of ["http://example.com", "https://a:b@example.com", "https://example.com?token=secret"])
    assert.throws(() => evaluate({ enabled: true, target: "win32-x64", feedUrl }, "win32"), /HTTPS/);
});
test("signed release config requires platform publisher identity", () => {
  const config = { enabled: true, target: "win32-x64", feedUrl: "https://updates.example.com/win32/x64/" };
  assert.throws(() => evaluate(config, "win32"), /Authenticode/);
  assert.throws(() => evaluate({ ...config, target: "darwin-x64" }, "darwin"), /Team ID/);
  assert.throws(() => evaluate({ ...config, target: "darwin-arm64" }, "win32"), /target/);
});
test("opt-in release config preserves app identity/data conventions and requires signing", () => {
  const result = evaluate({ enabled: true, target: "win32-x64", feedUrl: "https://updates.example.com/win32/x64/", windowsPublisherNames: ["Delta Nube LLC"] }, "win32");
  assert.equal(result.forceCodeSigning, true);
  assert.equal(result.appId, base.appId);
  assert.equal(result.productName, base.productName);
  assert.equal(result.publish.provider, "generic");
  assert.equal(result.win.publisherName[0], "Delta Nube LLC");
  assert.equal(result.mac.hardenedRuntime, true);
  assert.equal(result.mac.notarize, true);
  assert.equal(result.mac.target[1].target, "zip");
});
