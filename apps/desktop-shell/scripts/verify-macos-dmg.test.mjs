import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../../..", import.meta.url));
const workflow = await readFile(
  `${project}/.github/workflows/build-macos.yml`,
  "utf8",
);
const verifier = await readFile(
  new URL("./verify-macos-dmg.mjs", import.meta.url),
  "utf8",
);
const smoke = await readFile(
  new URL("./smoke-macos-app.mjs", import.meta.url),
  "utf8",
);

test("macOS workflow creates explicit ad-hoc signatures and verifies the DMG before upload", () => {
  assert.equal((workflow.match(/-c\.mac\.identity=-/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/-c\.mac\.hardenedRuntime=false/g) ?? []).length,
    2,
  );
  assert.match(workflow, /Verify app signature and native addon inside DMG/);
  assert.ok(
    workflow.indexOf("Verify app signature and native addon inside DMG") <
      workflow.indexOf("Upload DMG artifacts"),
  );
  assert.match(workflow, /verify-macos-dmg\.mjs/);
  assert.match(verifier, /--verify", "--deep", "--strict/);
  assert.match(verifier, /Signature=adhoc/);
  assert.match(
    verifier,
    /attach",\s*"-readonly",\s*"-nobrowse",\s*"-mountpoint",\s*mount,\s*dmg/,
  );
  assert.match(verifier, /mounted\.stdout\.includes/);
  assert.match(verifier, /const mount = await realpath\(/);
  assert.match(verifier, /timeout: 30000/);
  assert.match(verifier, /timeout: 120000/);
  assert.match(verifier, /better_sqlite3\.node/);
  assert.match(verifier, /verify-macos-license\.mjs/);
});

test("packaged runtime smoke reads unactivated licensing only in disposable userData", () => {
  assert.match(smoke, /--user-data-dir=/);
  assert.match(smoke, /getLicenseStatus/);
  assert.match(smoke, /UNACTIVATED/);
  assert.doesNotMatch(smoke, /activateLicense|refreshLicense/);
  assert.match(smoke, /rm\(profile, \{ recursive: true, force: true \}\)/);
});
