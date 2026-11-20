import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Explicit TS source extensions for the Node test runner.
import * as update from "./windows-signed-update.ts";
import type { WindowsVerificationContext } from "./windows-signed-update.ts";

const {
  verifyWindowsUpdateEnvelope,
  verifyWindowsUpdateArtifact,
  WindowsUpdateVerificationError,
} = update;
const trusted = generateKeyPairSync("ed25519");
const unrelated = generateKeyPairSync("ed25519");
const fixture = Buffer.from("Inert bytes for local verification only");
const nowMs = Date.parse("2026-11-17T12:00:00Z");
const context: WindowsVerificationContext = {
  trustedKeys: new Map([["test-only", trusted.publicKey]]),
  installedVersion: "0.1.37",
  nowMs,
  lastAccepted: null,
};
const payload = {
  appId: "com.deltanube.gastronomy",
  platform: "win32",
  arch: "x64",
  channel: "stable",
  version: "0.1.38",
  sequence: 12,
  issuedAt: "2026-11-17T11:58:00Z",
  expiresAt: "2026-11-24T12:00:00Z",
  minVerifierVersion: 1,
  artifactPath: "versions/0.1.38/Delta-Nube-Gastronomia-x64.exe",
  artifactSize: fixture.length,
  artifactSha512: createHash("sha512").update(fixture).digest("hex"),
};

function envelope(
  bytes = Buffer.from(JSON.stringify(payload)),
  privateKey: KeyObject = trusted.privateKey,
  domain = "DeltaNubeGastronomia-Update-v1\0",
) {
  return {
    format: 1,
    keyId: "test-only",
    payload: bytes.toString("base64"),
    signature: sign(
      null,
      Buffer.concat([Buffer.from(domain), bytes]),
      privateKey,
    ).toString("base64"),
  };
}

const encode = (record: unknown) => Buffer.from(JSON.stringify(record));
const signed = (overrides: Record<string, unknown> = {}) =>
  encode(envelope(encode({ ...payload, ...overrides })));
const errorCode = (code: string) => (error: unknown) =>
  error instanceof WindowsUpdateVerificationError && error.code === code;

test("pilot and stable manifests cannot cross channels even with the same verification key", () => {
  const pilot = { ...context, channel: "pilot" as const };
  const offered = signed({ channel: "pilot" });
  assert.equal(
    verifyWindowsUpdateEnvelope(offered, pilot).checkpoint.sequence,
    12,
  );
  assert.throws(
    () => verifyWindowsUpdateEnvelope(offered, context),
    errorCode("TARGET"),
  );
  assert.throws(
    () => verifyWindowsUpdateEnvelope(signed(), pilot),
    errorCode("TARGET"),
  );
});

test("verifies exact signed bytes and streamed, inert artifact with an ephemeral key", async () => {
  const bytes = Buffer.from(JSON.stringify(payload, null, 2) + "\n");
  const release = verifyWindowsUpdateEnvelope(encode(envelope(bytes)), context);
  assert.equal(release.artifactPath, payload.artifactPath);
  assert.equal(
    release.checkpoint.payloadSha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(release.checkpoint.sequence, payload.sequence);
  assert.ok(Object.isFrozen(release) && Object.isFrozen(release.checkpoint));
  await verifyWindowsUpdateArtifact(
    release,
    (async function* () {
      yield fixture.subarray(0, 9);
      yield fixture.subarray(9);
    })(),
  );
});

test("rejects identical JSON reserialized with different bytes, a wrong key, or another domain", () => {
  const original = envelope();
  for (const record of [
    {
      ...original,
      payload: Buffer.from(JSON.stringify(payload, null, 2)).toString("base64"),
    },
    envelope(undefined, unrelated.privateKey),
    envelope(undefined, trusted.privateKey, "Another-Protocol\0"),
  ])
    assert.throws(
      () => verifyWindowsUpdateEnvelope(encode(record), context),
      errorCode("SIGNATURE"),
    );
});

test("rejects an untrusted key ID, a private key or another algorithm in the trust map", () => {
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(
        encode({ ...envelope(), keyId: "untrusted" }),
        context,
      ),
    errorCode("KEY"),
  );
  for (const key of [
    trusted.privateKey,
    generateKeyPairSync("ed448").publicKey,
  ]) {
    const trustedKeys = new Map([["test-only", key]]);
    assert.throws(
      () => verifyWindowsUpdateEnvelope(signed(), { ...context, trustedKeys }),
      errorCode("KEY"),
    );
  }
});

test("rejects malformed envelope encodings, duplicates, extra fields and oversized input", () => {
  const record = envelope();
  const correct = JSON.stringify(record);
  const badInputs = [
    encode({ ...record, payload: record.payload + "=" }),
    encode({ ...record, signature: record.signature.replace(/=+$/, "") }),
    encode({ ...record, signature: Buffer.alloc(63).toString("base64") }),
    encode({ ...record, extra: "unrecognized" }),
    Buffer.from(correct.replace('"format":1', '"format":1,"f\\u006frmat":1')),
    Buffer.from(correct.replace('"format":1', '"format":1.0')),
    Buffer.from(correct + "[]"),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), signed()]),
    Buffer.from([0xc0, 0x80]),
    Buffer.alloc(64 * 1024 + 1, 32),
  ];
  for (const input of badInputs) {
    assert.throws(
      () => verifyWindowsUpdateEnvelope(input, context),
      (e: unknown) => errorCode("FORMAT")(e) || errorCode("SIGNATURE")(e),
    );
  }
});

test("rejects a properly signed payload with duplicate decoded keys, malformed UTF-8 or extra values", () => {
  const correct = JSON.stringify(payload);
  const badPayloads = [
    Buffer.from(
      correct.replace('"sequence":12', '"sequence":12,"sequen\\u0063e":12'),
    ),
    Buffer.from(
      correct.replace('"sequence":12', '"sequence":12.000000000000001'),
    ),
    Buffer.from(
      correct.replace('"sequence":12', '"sequence":9007199254740993'),
    ),
    Buffer.from(correct.replace('"sequence":12', '"sequence":{}')),
    Buffer.concat([
      Buffer.from(correct.slice(0, -1)),
      Buffer.from([0xff]),
      Buffer.from("}"),
    ]),
    Buffer.from(correct + " ".repeat(16 * 1024)),
    encode({ ...payload, extra: "not part of v1" }),
  ];
  for (const bytes of badPayloads) {
    assert.throws(
      () => verifyWindowsUpdateEnvelope(encode(envelope(bytes)), context),
      errorCode("FORMAT"),
    );
  }
});

for (const [field, value] of [
  ["appId", "com.another.app"],
  ["platform", "darwin"],
  ["arch", "arm64"],
  ["channel", "beta"],
]) {
  test(`rejects a signed manifest with the wrong ${field}`, () => {
    assert.throws(
      () => verifyWindowsUpdateEnvelope(signed({ [field!]: value }), context),
      errorCode("TARGET"),
    );
  });
}

test("rejects older releases, noncanonical versions and an unsupported verifier", () => {
  for (const version of ["0.1.36", "0.01.38", "0.1.39-beta"]) {
    assert.throws(
      () => verifyWindowsUpdateEnvelope(signed({ version }), context),
      errorCode("VERSION"),
    );
  }
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(signed({ minVerifierVersion: 2 }), context),
    errorCode("VERSION"),
  );
});

test("only a fully verified installed-version manifest reports CURRENT", () => {
  const alreadyInstalled = { ...context, installedVersion: payload.version };
  assert.throws(
    () => verifyWindowsUpdateEnvelope(signed(), alreadyInstalled),
    errorCode("CURRENT"),
  );
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(
        signed({ minVerifierVersion: 2 }),
        alreadyInstalled,
      ),
    errorCode("VERSION"),
  );
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(
        signed({ expiresAt: "2026-11-17T12:00:00Z" }),
        alreadyInstalled,
      ),
    errorCode("TIME_WINDOW"),
  );
});

test("restricts signed artifact paths to safe versioned Windows filenames and validates metadata", () => {
  for (const artifactPath of [
    "https://example.invalid/setup.exe",
    "../setup.exe",
    "versions/0.1.39/setup.exe",
    "versions/0.1.38/%2e%2e/setup.exe",
    "versions/0.1.38/setup.exe?download",
    "versions/0.1.38/setup.exe#fragment",
    "versions/0.1.38\\setup.exe",
    "versions/0.1.38/setup.exe:stream",
    "versions/0.1.38/CON.exe",
    "versions/0.1.38/aux.copy.exe",
    "versions/0.1.38/setup.exe ",
  ])
    assert.throws(
      () => verifyWindowsUpdateEnvelope(signed({ artifactPath }), context),
      errorCode("ARTIFACT"),
    );
  for (const bad of [
    { artifactSize: 0 },
    { artifactSize: 1024 ** 3 + 1 },
    { artifactSha512: "0".repeat(127) },
  ]) {
    assert.throws(
      () => verifyWindowsUpdateEnvelope(signed(bad), context),
      errorCode("ARTIFACT"),
    );
  }
});

test("rejects expiry at current time, future issue, nonexistent date and excessive validity", () => {
  for (const bad of [
    { expiresAt: "2026-11-17T12:00:00Z" },
    { issuedAt: "2026-11-17T12:05:01Z" },
    { issuedAt: "2026-02-30T12:00:00Z" },
    { expiresAt: "2027-01-17T12:00:00Z" },
  ])
    assert.throws(
      () => verifyWindowsUpdateEnvelope(signed(bad), context),
      errorCode("TIME_WINDOW"),
    );
});

test("allows an identical retry but rejects a lower sequence or different bytes at the same sequence", () => {
  const first = verifyWindowsUpdateEnvelope(signed(), context);
  const previous = { ...context, lastAccepted: first.checkpoint };
  assert.deepEqual(
    verifyWindowsUpdateEnvelope(signed(), previous).checkpoint,
    first.checkpoint,
  );
  assert.throws(
    () => verifyWindowsUpdateEnvelope(signed({ sequence: 11 }), previous),
    errorCode("REPLAY"),
  );
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(
        signed({ expiresAt: "2026-11-25T12:00:00Z" }),
        previous,
      ),
    errorCode("REPLAY"),
  );
  assert.equal(
    verifyWindowsUpdateEnvelope(signed({ sequence: 13 }), previous).checkpoint
      .sequence,
    13,
  );
});

test("rejects damaged checkpoint, version rollback at a higher sequence and clock rollback", () => {
  const first = verifyWindowsUpdateEnvelope(signed(), context);
  const lastAccepted = first.checkpoint;
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(signed(), {
        ...context,
        lastAccepted: { ...lastAccepted, payloadSha256: "damaged" },
      }),
    errorCode("REPLAY"),
  );
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(
        signed({
          version: "0.1.37",
          artifactPath: "versions/0.1.37/setup.exe",
          sequence: 13,
        }),
        { ...context, installedVersion: "0.1.36", lastAccepted },
      ),
    errorCode("REPLAY"),
  );
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(signed(), {
        ...context,
        nowMs: nowMs - 6 * 60_000,
        lastAccepted,
      }),
    errorCode("CLOCK"),
  );
});

test("a small clock rollback cannot resurrect a manifest past its last observed expiry", () => {
  const first = verifyWindowsUpdateEnvelope(signed(), context);
  const expiresAt = "2026-11-17T12:03:00Z";
  assert.throws(
    () =>
      verifyWindowsUpdateEnvelope(signed({ expiresAt, sequence: 13 }), {
        ...context,
        lastAccepted: {
          ...first.checkpoint,
          observedAtMs: Date.parse(expiresAt),
        },
      }),
    errorCode("TIME_WINDOW"),
  );
});

test("rejects truncation, extra bytes, same-size modification and reconstructed snapshots", async () => {
  const release = verifyWindowsUpdateEnvelope(signed(), context);
  const changed = Buffer.from(fixture);
  changed[0] = 0;
  for (const chunks of [
    [fixture.subarray(1)],
    [fixture, Buffer.from("x")],
    [changed],
  ]) {
    await assert.rejects(
      verifyWindowsUpdateArtifact(release, chunks),
      errorCode("ARTIFACT"),
    );
  }
  await assert.rejects(
    verifyWindowsUpdateArtifact({ ...release }, [fixture]),
    errorCode("ARTIFACT"),
  );
});

test("offline preflight verifies a local inert file and rejects the changed file on re-read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-ed25519-test-"));
  const path = join(dir, "inert-fixture.bin");
  try {
    await writeFile(path, fixture, { flag: "wx" });
    const release = verifyWindowsUpdateEnvelope(signed(), context);
    await verifyWindowsUpdateArtifact(release, createReadStream(path));
    const changed = Buffer.from(fixture);
    changed[0] = 0;
    await writeFile(path, changed);
    await assert.rejects(
      verifyWindowsUpdateArtifact(release, createReadStream(path)),
      errorCode("ARTIFACT"),
    );
  } finally {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(dir);
  }
});
