import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  readHiddenPassphrase,
  runPilotRelease,
} from "./windows-pilot-release.mjs";

const fixturePassphrase = "ephemeral-test-only";
const scriptPath = fileURLToPath(
  new URL("./windows-pilot-release.mjs", import.meta.url),
);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "windows-pilot-release-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ type: "spki", format: "pem" });
  const fingerprint = createHash("sha256")
    .update(pair.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const publicPath = join(dir, "pilot.pub.pem");
  const privatePath = join(dir, "pilot.encrypted.pem");
  const artifact = join(dir, "DeltaNubePilot-0.1.38.exe");
  const manifest = join(dir, "release.json");
  const privatePem = (privateKey = pair.privateKey) =>
    privateKey.export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: fixturePassphrase,
    });
  const artifactBytes = Buffer.from(
    "Inert bytes for a test; not a Windows executable. ".repeat(8192),
  );
  await Promise.all([
    writeFile(publicPath, spki),
    writeFile(privatePath, privatePem()),
    writeFile(artifact, artifactBytes),
  ]);

  const time = (offset) =>
    new Date(Date.now() + offset).toISOString().replace(/\.\d{3}Z$/, "Z");
  const trusted = ["--public-key", publicPath, "--fingerprint", fingerprint];
  const privateArg = ["--private-key", privatePath];
  const release = [
    ...trusted,
    "--key-id",
    "pilot-test",
    "--installed-version",
    "0.1.37",
    "--artifact",
    artifact,
  ];
  return {
    artifact,
    artifactBytes,
    dir,
    fingerprint,
    manifest,
    pair,
    privatePath,
    privatePem,
    publicPath,
    prompt: async () => Buffer.from(fixturePassphrase),
    recovery: ["recovery-check", ...trusted, ...privateArg],
    sign: [
      "sign",
      ...release,
      ...privateArg,
      "--version",
      "0.1.38",
      "--sequence",
      "42",
      "--issued-at",
      time(-60000),
      "--expires-at",
      time(60 * 60_000),
      "--out",
      manifest,
    ],
    verify: ["verify", ...release, "--manifest", manifest],
  };
}

function change(args, option, value) {
  return args.map((arg, index) =>
    args[index - 1] === `--${option}` ? value : arg,
  );
}

test("prints the Ed25519 SPKI SHA-256 fingerprint and rejects non-public/other key types", async (t) => {
  const f = await fixture(t);
  const cmd = (path) => ["fingerprint", "--public-key", path];
  assert.equal(await runPilotRelease(cmd(f.publicPath)), f.fingerprint);
  const child = spawnSync(
    process.execPath,
    [scriptPath, ...cmd(f.publicPath)],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0);
  assert.equal(child.stdout.trim(), f.fingerprint);
  await assert.rejects(
    runPilotRelease(cmd(f.privatePath)),
    /PUBLIC KEY PEM block/,
  );
  const ec = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  }).publicKey.export({ type: "spki", format: "pem" });
  await writeFile(f.publicPath, ec);
  await assert.rejects(
    runPilotRelease(cmd(f.publicPath)),
    /Expected an Ed25519 public key/,
  );
});

test("challenge recovers the pinned key and wipes the supplied passphrase buffer", async (t) => {
  const f = await fixture(t);
  const passphrase = Buffer.from(fixturePassphrase);
  assert.equal(
    await runPilotRelease(f.recovery, async () => passphrase),
    `Recovery check passed: ${f.fingerprint}`,
  );
  assert.deepEqual(passphrase, Buffer.alloc(passphrase.length));
  const wrong = Buffer.from("wrong-test-value");
  await assert.rejects(
    runPilotRelease(f.recovery, async () => wrong),
    /Unable to decrypt/,
  );
  assert.deepEqual(wrong, Buffer.alloc(wrong.length));
  await writeFile(
    f.privatePath,
    f.privatePem(generateKeyPairSync("ed25519").privateKey),
  );
  await assert.rejects(
    runPilotRelease(f.recovery, f.prompt),
    /does not match the pinned public key/,
  );
});

test("rejects pin mismatch, plaintext and malformed private keys; CLI rejects redirected input", async (t) => {
  const f = await fixture(t);
  const unexpectedPrompt = () => assert.fail("must not prompt");
  await assert.rejects(
    runPilotRelease(
      change(f.recovery, "fingerprint", "0".repeat(64)),
      unexpectedPrompt,
    ),
    /does not match/,
  );
  const child = spawnSync(process.execPath, [scriptPath, ...f.recovery], {
    encoding: "utf8",
    input: `${fixturePassphrase}\n`,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /local interactive terminal is required/);
  assert.ok(!child.stderr.includes(fixturePassphrase));
  assert.equal(child.stdout, "");

  const clearPem = f.pair.privateKey.export({ type: "pkcs8", format: "pem" });
  await writeFile(f.privatePath, clearPem);
  await assert.rejects(
    runPilotRelease(f.recovery, unexpectedPrompt),
    /ENCRYPTED PRIVATE KEY PEM block/,
  );
  await writeFile(
    f.privatePath,
    clearPem.replaceAll("PRIVATE KEY", "ENCRYPTED PRIVATE KEY"),
  );
  await assert.rejects(
    runPilotRelease(f.recovery, unexpectedPrompt),
    /Expected encrypted PKCS#8 DER/,
  );
});

test("passphrase prompt never echoes input and restores the terminal after typing or cancellation", async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const modes = [];
  input.setRawMode = (raw) => {
    modes.push(raw);
    input.isRaw = raw;
  };
  const writes = [];
  const output = { isTTY: true, write: (chunk) => writes.push(chunk) };

  const passphrase = readHiddenPassphrase(input, output);
  input.write(Buffer.from("abcé"));
  input.write(Buffer.from([127]));
  input.write(Buffer.from("d\r"));
  assert.deepEqual(await passphrase, Buffer.from("abcd"));
  assert.deepEqual(modes, [true, false]);
  assert.equal(input.listenerCount("data"), 0);
  const cancelled = readHiddenPassphrase(input, output);
  input.write(Buffer.from([3]));
  await assert.rejects(cancelled, /cancelled/);
  assert.deepEqual(modes, [true, false, true, false]);
  assert.equal(
    writes.join(""),
    "Private-key passphrase (hidden): \n".repeat(2),
  );
});

test("streams inert bytes, signs a pilot release, verifies it, and refuses overwrite", async (t) => {
  const f = await fixture(t);
  assert.match(
    await runPilotRelease(f.sign, f.prompt),
    /Created verified Windows pilot release 0\.1\.38, sequence 42/,
  );
  const bytes = await readFile(f.manifest);
  const envelope = JSON.parse(bytes);
  const payload = JSON.parse(Buffer.from(envelope.payload, "base64"));
  assert.equal(envelope.format, 1);
  assert.equal(envelope.keyId, "pilot-test");
  assert.equal(payload.appId, "com.deltanube.gastronomy");
  assert.equal(payload.platform, "win32");
  assert.equal(payload.arch, "x64");
  assert.equal(payload.channel, "pilot");
  assert.equal(payload.minVerifierVersion, 1);
  assert.equal(
    payload.artifactPath,
    "versions/0.1.38/DeltaNubePilot-0.1.38.exe",
  );
  assert.equal(payload.artifactSize, f.artifactBytes.length);
  assert.equal(
    payload.artifactSha512,
    createHash("sha512").update(f.artifactBytes).digest("hex"),
  );
  assert.match(
    await runPilotRelease(f.verify),
    /Verified Windows pilot release 0\.1\.38, sequence 42/,
  );
  await assert.rejects(runPilotRelease(f.sign, f.prompt), { code: "EEXIST" });
  assert.deepEqual(await readFile(f.manifest), bytes);
});

test("rejects substituted bytes, artifact filename, key id, signature, and incompatible installed version", async (t) => {
  const f = await fixture(t);
  await runPilotRelease(f.sign, f.prompt);
  await assert.rejects(
    runPilotRelease(change(f.verify, "installed-version", "0.1.38")),
    { code: "CURRENT" },
  );
  await assert.rejects(
    runPilotRelease(change(f.verify, "installed-version", "0.1.39")),
    { code: "VERSION" },
  );
  await assert.rejects(
    runPilotRelease(change(f.verify, "key-id", "other-pilot")),
    { code: "KEY" },
  );
  const duplicate = join(f.dir, "another.exe");
  await writeFile(duplicate, f.artifactBytes);
  await assert.rejects(
    runPilotRelease(change(f.verify, "artifact", duplicate)),
    /filename does not match/,
  );
  await writeFile(f.artifact, Buffer.alloc(f.artifactBytes.length + 1, 0x61));
  await assert.rejects(runPilotRelease(f.verify), { code: "ARTIFACT" });
  await writeFile(f.artifact, Buffer.alloc(f.artifactBytes.length, 0x61));
  await assert.rejects(runPilotRelease(f.verify), { code: "ARTIFACT" });
  const envelope = JSON.parse(await readFile(f.manifest, "utf8"));
  envelope.signature = Buffer.alloc(64).toString("base64");
  await writeFile(f.manifest, JSON.stringify(envelope));
  await assert.rejects(runPilotRelease(f.verify), { code: "SIGNATURE" });
});

test("requires valid checkpoint state when supplied and refuses stale sequence or expired writes", async (t) => {
  const f = await fixture(t);
  const checkpoint = join(f.dir, "checkpoint.json");
  const args = [...f.sign, "--last-accepted", checkpoint];
  await writeFile(checkpoint, "null");
  await assert.rejects(runPilotRelease(args, f.prompt), /must not be null/);
  await writeFile(
    checkpoint,
    JSON.stringify({
      sequence: 43,
      version: "0.1.38",
      observedAtMs: Date.now(),
      payloadSha256: "0".repeat(64),
    }),
  );
  await assert.rejects(runPilotRelease(args, f.prompt), { code: "REPLAY" });
  const expired = new Date(Date.now() - 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  await assert.rejects(
    runPilotRelease(change(f.sign, "expires-at", expired), f.prompt),
    { code: "TIME_WINDOW" },
  );
  await assert.rejects(stat(f.manifest), { code: "ENOENT" });
});

test("rejects duplicate, unexpected, and nonlocal file arguments", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    runPilotRelease(
      [...f.recovery, "--passphrase", fixturePassphrase],
      f.prompt,
    ),
    /Unexpected or invalid option/,
  );
  await assert.rejects(
    runPilotRelease([...f.recovery, "--private-key", f.privatePath], f.prompt),
    /Duplicate or empty option/,
  );
  await assert.rejects(
    runPilotRelease(
      change(f.recovery, "public-key", "https://127.0.0.1/key.pem"),
      f.prompt,
    ),
    /local filesystem/,
  );
  await assert.rejects(
    runPilotRelease(
      change(f.recovery, "private-key", "\\\\127.0.0.1\\share\\key.pem"),
      f.prompt,
    ),
    /local filesystem/,
  );
});
