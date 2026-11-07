import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
// @ts-expect-error Node runs TS directly.
import { localPilotLicenseOptions } from "./local-pilot-config.ts";

test("pilot authority cannot override a packaged app or an ordinary profile", async () => {
  assert.deepEqual(await localPilotLicenseOptions({ enabled: "1", isPackaged: true, userDataPath: "unreadable" }), {});
  assert.deepEqual(await localPilotLicenseOptions({ isPackaged: false, userDataPath: "unreadable" }), {});
  await assert.rejects(localPilotLicenseOptions({ enabled: "1", isPackaged: false, userDataPath: tmpdir() }));
});
test("isolated pilot only accepts loopback authority and an Ed25519 public key", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-local-pilot-config-"));
  const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  const input = { enabled: "1", isPackaged: false, userDataPath: profile };
  try {
    for (const serverUrl of ["https://example.test", "http://192.168.1.2:8097", "http://user:pass@localhost:8097", "http://localhost:8097/?token=secret"]) {
      await writeFile(join(profile, "local-license-config.json"), JSON.stringify({ serverUrl, publicKey }));
      await assert.rejects(localPilotLicenseOptions(input));
    }
    await writeFile(join(profile, "local-license-config.json"), JSON.stringify({ serverUrl: "http://127.0.0.1:8097", publicKey }));
    assert.deepEqual(await localPilotLicenseOptions(input), { config: { serverUrl: "http://127.0.0.1:8097", publicKey }, enforceLicense: true, allowLoopbackHttp: true });
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test("hosted pilot requires exact explicit matching HTTPS origin and is never enabled in packaged builds", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-local-pilot-hosted-"));
  const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
  const input = { enabled: "1", hostedOrigin: "https://pilot.example.test", isPackaged: false, userDataPath: profile };
  try {
    await writeFile(join(profile, "local-license-config.json"), JSON.stringify({ serverUrl: input.hostedOrigin, publicKey }));
    assert.deepEqual(await localPilotLicenseOptions(input), { config: { serverUrl: input.hostedOrigin, publicKey }, enforceLicense: true });
    assert.deepEqual(await localPilotLicenseOptions({ ...input, isPackaged: true }), {});
    for (const [serverUrl, hostedOrigin] of [
      ["https://other.example.test", input.hostedOrigin], ["https://pilot.example.test/path", input.hostedOrigin],
      ["https://user:pass@pilot.example.test", input.hostedOrigin], ["https://pilot.example.test/?x=1", input.hostedOrigin],
      ["https://pilot.example.test", "https://pilot.example.test/path"], ["http://pilot.example.test", "http://pilot.example.test"],
      ["https://localhost", "https://localhost"],
    ]) {
      await writeFile(join(profile, "local-license-config.json"), JSON.stringify({ serverUrl, publicKey }));
      await assert.rejects(localPilotLicenseOptions({ ...input, hostedOrigin }));
    }
  } finally { await rm(profile, { recursive: true, force: true }); }
});
