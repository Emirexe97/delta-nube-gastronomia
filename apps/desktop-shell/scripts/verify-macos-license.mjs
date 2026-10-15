import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(
  require.resolve("electron-builder/package.json"),
);
const appBuilderRequire = createRequire(
  builderRequire.resolve("app-builder-lib/package.json"),
);
const asar = appBuilderRequire("@electron/asar");
const path = process.argv[2];
assert.ok(path, "Provide the packaged app.asar path");
const source = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../licensing-config.json", import.meta.url)),
    "utf8",
  ),
);
const bundled = JSON.parse(
  asar.extractFile(path, "licensing-config.json").toString("utf8"),
);
assert.deepEqual(
  bundled,
  source,
  "Packaged licensing config must match the approved public configuration",
);
assert.equal(bundled.serverUrl, "https://gastronomia.deltanubeweb.com");
assert.equal(createPublicKey(bundled.publicKey).asymmetricKeyType, "ed25519");
assert.ok(!JSON.stringify(bundled).includes("PRIVATE KEY"));
const main = asar.extractFile(path, "dist/main.js").toString("utf8");
const preload = asar.extractFile(path, "dist/preload.js").toString("utf8");
assert.ok(
  main.includes("gastronomy:getLicenseStatus"),
  "Packaged main must include real licensing IPC",
);
assert.ok(
  main.includes("license-state.json"),
  "Packaged main must include the licensing client",
);
assert.ok(
  main.includes("gastronomy:requestLicenseAccess") &&
    main.includes("requestLicenseAccess"),
  "Packaged main must include the license access request IPC handler",
);
assert.ok(
  preload.includes("activateLicense") && preload.includes("refreshLicense"),
  "Packaged preload must expose activation and verification",
);
assert.ok(
  preload.includes("requestLicenseAccess") &&
    preload.includes('invoke("requestLicenseAccess"'),
  "Packaged preload must expose the license access request API",
);
assert.ok(
  main.includes("safeStorage.isEncryptionAvailable()") &&
    main.includes("safeStorage.encryptString(value)") &&
    main.includes("safeStorage.decryptString(value)"),
  "Packaged main must wire Electron safeStorage availability, encryption, and decryption",
);
console.log(
  "Verified packaged public licensing configuration and main/preload handlers (not a physical Mac runtime test).",
);
