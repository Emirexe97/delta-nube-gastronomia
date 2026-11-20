#!/usr/bin/env node
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  verifyWindowsUpdateArtifact,
  verifyWindowsUpdateEnvelope,
  WindowsUpdateVerificationError,
} from "../src/windows-signed-update.ts";

const RELEASE_DOMAIN = Buffer.from("DeltaNubeGastronomia-Update-v1\0", "ascii");
const RECOVERY_DOMAIN = Buffer.from(
  "DeltaNubeGastronomia-Pilot-Key-Recovery-v1\0",
  "ascii",
);
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 1024 ** 3;
const TRUST = ["public-key", "fingerprint"];
const RELEASE = [...TRUST, "key-id", "installed-version", "artifact"];
const REQUIRED = new Map([
  ["fingerprint", ["public-key"]],
  ["recovery-check", [...TRUST, "private-key"]],
  [
    "sign",
    [
      ...RELEASE,
      "private-key",
      "version",
      "sequence",
      "issued-at",
      "expires-at",
      "out",
    ],
  ],
  ["verify", [...RELEASE, "manifest"]],
]);

const USAGE = `Windows pilot release helper (Node.js 24; use on an offline host)
  fingerprint --public-key <SPKI.pem>
  recovery-check --public-key <SPKI.pem> --fingerprint <sha256-hex> --private-key <encrypted-pkcs8.pem>
  sign --public-key <SPKI.pem> --fingerprint <sha256-hex> --key-id <id> --installed-version <x.y.z>
       --private-key <encrypted-pkcs8.pem> --artifact <file.exe> --version <x.y.z> --sequence <n>
       --issued-at <YYYY-MM-DDTHH:MM:SSZ> --expires-at <YYYY-MM-DDTHH:MM:SSZ> --out <release.json>
       [--last-accepted <checkpoint.json>]
  verify --public-key <SPKI.pem> --fingerprint <sha256-hex> --key-id <id> --installed-version <x.y.z>
         --artifact <file.exe> --manifest <release.json> [--last-accepted <checkpoint.json>]

Pin the fingerprint separately from the manifest and key files. Omit --last-accepted only for a known fresh client.
Use an interactive terminal for private-key commands. This tool never installs or publishes updates.`;

class PilotReleaseError extends Error {}

function parseCommand([command, ...args]) {
  const required = REQUIRED.get(command);
  if (!required) throw new PilotReleaseError("Unknown command; see --help.");
  const allowed = ["sign", "verify"].includes(command)
    ? [...required, "last-accepted"]
    : required;
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: Object.fromEntries(
        allowed.map((option) => [option, { type: "string" }]),
      ),
      tokens: true,
    });
  } catch {
    throw new PilotReleaseError("Unexpected or invalid option; see --help.");
  }
  const seen = new Set();
  for (const { name } of parsed.tokens) {
    if (seen.has(name) || !parsed.values[name]) {
      throw new PilotReleaseError("Duplicate or empty option; see --help.");
    }
    seen.add(name);
  }
  for (const option of required) {
    if (!seen.has(option)) throw new PilotReleaseError(`Missing --${option}.`);
  }
  return { command, values: parsed.values };
}

function localPath(path) {
  // Explicitly reject UNC/device paths and URI schemes. Operators must use an
  // offline machine and local volumes (a mapped drive can look like a local path).
  if (/^[\\/]{2}/.test(path) || /:/.test(path.replace(/^[A-Za-z]:[\\/]/, ""))) {
    throw new PilotReleaseError("Use local filesystem paths only.");
  }
  return path;
}

async function withLocalFile(path, operation) {
  const file = await open(localPath(path), "r");
  try {
    const stats = await file.stat();
    if (!stats.isFile())
      throw new PilotReleaseError("Expected a regular file.");
    return await operation(file, stats);
  } finally {
    await file.close();
  }
}

async function readMetadata(path) {
  return withLocalFile(path, async (file, stats) => {
    if (!stats.size || stats.size > MAX_METADATA_BYTES) {
      throw new PilotReleaseError("Metadata file empty or too large.");
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      length += chunk.length;
      if (length > MAX_METADATA_BYTES)
        throw new PilotReleaseError("Metadata file too large.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  });
}

async function readPem(path, label) {
  const bytes = await readMetadata(path);
  const format = new RegExp(
    `^-----BEGIN ${label}-----\\r?\\n(?:[A-Za-z0-9+/=]+\\r?\\n)+-----END ${label}-----(?:\\r?\\n)?$`,
  );
  if (!format.test(bytes.toString("latin1")))
    throw new PilotReleaseError(`Expected one ${label} PEM block.`);
  return bytes;
}

async function loadPublicKey(path) {
  const pem = await readPem(path, "PUBLIC KEY");
  let key;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new PilotReleaseError("Cannot read the SPKI public key.");
  }
  if (key.asymmetricKeyType !== "ed25519")
    throw new PilotReleaseError("Expected an Ed25519 public key.");
  return key;
}

function fingerprint(key) {
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

export async function readHiddenPassphrase(
  input = process.stdin,
  output = process.stderr,
) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new PilotReleaseError(
      "A local interactive terminal is required for passphrase entry.",
    );
  }
  const bytes = Buffer.alloc(1024);
  const wasRaw = input.isRaw;
  let length = 0;
  let onData, onStop;
  input.setRawMode(true);
  try {
    output.write("Private-key passphrase (hidden): ");
    return await new Promise((done, fail) => {
      onStop = () => fail(new PilotReleaseError("Passphrase entry cancelled."));
      onData = (chunk) => {
        for (const byte of chunk) {
          if (byte === 3 || byte === 4 || byte === 26) return onStop(); // Ctrl+C/D/Z
          if (byte === 13 || byte === 10) {
            if (length === 0)
              return fail(new PilotReleaseError("Empty passphrase."));
            return done(Buffer.from(bytes.subarray(0, length)));
          }
          if (byte === 8 || byte === 127) {
            if (length > 0) {
              // Remove one UTF-8 code point, including any continuation bytes.
              let start = length - 1;
              while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
              bytes.fill(0, start, length);
              length = start;
            }
          } else if (byte < 32 || length === bytes.length) {
            return fail(
              new PilotReleaseError(
                "Unsupported or too long passphrase input.",
              ),
            );
          } else bytes[length++] = byte;
        }
      };
      input.on("data", onData);
      input.once("end", onStop);
      input.once("error", onStop);
      input.resume();
    });
  } finally {
    bytes.fill(0);
    if (onData) input.off("data", onData);
    if (onStop) {
      input.off("end", onStop);
      input.off("error", onStop);
    }
    input.pause();
    input.setRawMode(Boolean(wasRaw));
    output.write("\n");
  }
}

function assertEncryptedPkcs8(der) {
  // OpenSSL may accept plaintext PKCS#8 bytes mislabeled as ENCRYPTED PRIVATE KEY.
  // Require the DER shape of EncryptedPrivateKeyInfo before handing it to OpenSSL.
  function readElement(offset, tag) {
    const invalid = () => {
      throw new PilotReleaseError(
        "Expected encrypted PKCS#8 DER inside the PEM block.",
      );
    };
    if (offset + 2 > der.length || der[offset++] !== tag) invalid();
    let length = der[offset++];
    if (length & 0x80) {
      const lengthBytes = length & 0x7f;
      if (
        !lengthBytes ||
        lengthBytes > 2 ||
        offset + lengthBytes > der.length ||
        !der[offset]
      )
        invalid();
      length = 0;
      for (let i = 0; i < lengthBytes; i++)
        length = (length << 8) + der[offset++];
      if (length < 128) invalid();
    }
    if (!length || offset + length > der.length) invalid();
    return { start: offset, end: offset + length };
  }
  const outer = readElement(0, 0x30); // SEQUENCE
  const algorithm = readElement(outer.start, 0x30); // AlgorithmIdentifier
  const algorithmId = readElement(algorithm.start, 0x06); // OBJECT IDENTIFIER
  const ciphertext = readElement(algorithm.end, 0x04); // OCTET STRING
  if (
    outer.end !== der.length ||
    algorithmId.end > algorithm.end ||
    ciphertext.end !== outer.end
  ) {
    throw new PilotReleaseError(
      "Expected encrypted PKCS#8 DER inside the PEM block.",
    );
  }
}

async function loadPrivateKey(path, prompt) {
  const pem = await readPem(path, "ENCRYPTED PRIVATE KEY");
  const der = Buffer.from(
    pem
      .toString("latin1")
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("-----"))
      .join(""),
    "base64",
  );
  pem.fill(0);
  let passphrase;
  try {
    assertEncryptedPkcs8(der);
    passphrase = await prompt();
    let key;
    try {
      key = createPrivateKey({
        key: der,
        format: "der",
        type: "pkcs8",
        passphrase,
      });
    } catch {
      throw new PilotReleaseError("Unable to decrypt the PKCS#8 private key.");
    }
    if (key.asymmetricKeyType !== "ed25519")
      throw new PilotReleaseError("Expected an Ed25519 private key.");
    return key;
  } finally {
    passphrase?.fill(0);
    der.fill(0);
  }
}

async function artifactDigest(path) {
  return withLocalFile(path, async (file, stats) => {
    if (!stats.size || stats.size > MAX_ARTIFACT_BYTES)
      throw new PilotReleaseError("Artifact size out of range.");
    const hash = createHash("sha512");
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > stats.size)
        throw new PilotReleaseError("Artifact changed while hashing.");
      hash.update(chunk);
    }
    if (size !== stats.size)
      throw new PilotReleaseError("Artifact changed while hashing.");
    return { size, sha512: hash.digest("hex") };
  });
}

async function verifiedRelease(bytes, context, artifact) {
  const result = verifyWindowsUpdateEnvelope(bytes, {
    ...context,
    nowMs: Date.now(),
  });
  if (basename(artifact) !== result.artifactPath.split("/").at(-1)) {
    throw new PilotReleaseError(
      "Local artifact filename does not match the signed path.",
    );
  }
  await withLocalFile(artifact, (file) =>
    verifyWindowsUpdateArtifact(
      result,
      file.createReadStream({ autoClose: false }),
    ),
  );
  return result;
}

export async function runPilotRelease(args, prompt = readHiddenPassphrase) {
  if (!args.length || (args.length === 1 && args[0] === "--help")) return USAGE;
  const { command, values } = parseCommand(args);
  const publicKey = await loadPublicKey(values["public-key"]);
  const actualFingerprint = fingerprint(publicKey);
  if (command === "fingerprint") return actualFingerprint;
  if (actualFingerprint !== values.fingerprint)
    throw new PilotReleaseError(
      "Public-key fingerprint does not match the expected pin.",
    );

  if (command === "recovery-check") {
    const privateKey = await loadPrivateKey(values["private-key"], prompt);
    const challenge = Buffer.concat([RECOVERY_DOMAIN, randomBytes(32)]);
    if (
      !verify(null, challenge, publicKey, sign(null, challenge, privateKey))
    ) {
      throw new PilotReleaseError(
        "Recovered private key does not match the pinned public key.",
      );
    }
    return `Recovery check passed: ${actualFingerprint}`;
  }

  let checkpoint = null;
  if (values["last-accepted"] !== undefined) {
    const bytes = await readMetadata(values["last-accepted"]);
    try {
      checkpoint = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new PilotReleaseError("Invalid last accepted checkpoint JSON.");
    }
    if (checkpoint === null)
      throw new PilotReleaseError("A supplied checkpoint must not be null.");
  }
  const context = {
    channel: "pilot",
    trustedKeys: new Map([[values["key-id"], publicKey]]),
    installedVersion: values["installed-version"],
    lastAccepted: checkpoint,
  };
  if (command === "verify") {
    const result = await verifiedRelease(
      await readMetadata(values.manifest),
      context,
      values.artifact,
    );
    return `Verified Windows pilot release ${result.checkpoint.version}, sequence ${result.checkpoint.sequence}.`;
  }

  if (
    !/^[1-9][0-9]*$/.test(values.sequence) ||
    !Number.isSafeInteger(Number(values.sequence))
  ) {
    throw new PilotReleaseError("Expected a positive integer --sequence.");
  }
  const out = localPath(values.out);
  const artifact = await artifactDigest(values.artifact);
  const payload = Buffer.from(
    JSON.stringify({
      appId: "com.deltanube.gastronomy",
      platform: "win32",
      arch: "x64",
      channel: "pilot",
      version: values.version,
      sequence: Number(values.sequence),
      issuedAt: values["issued-at"],
      expiresAt: values["expires-at"],
      minVerifierVersion: 1,
      artifactPath: `versions/${values.version}/${basename(values.artifact)}`,
      artifactSize: artifact.size,
      artifactSha512: artifact.sha512,
    }),
    "utf8",
  );
  const privateKey = await loadPrivateKey(values["private-key"], prompt);
  const signature = sign(
    null,
    Buffer.concat([RELEASE_DOMAIN, payload]),
    privateKey,
  );
  const envelope = Buffer.from(
    `${JSON.stringify(
      {
        format: 1,
        keyId: values["key-id"],
        payload: payload.toString("base64"),
        signature: signature.toString("base64"),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const result = await verifiedRelease(envelope, context, values.artifact);
  const output = await open(out, "wx");
  try {
    await output.writeFile(envelope);
  } finally {
    await output.close();
  }
  return `Created verified Windows pilot release ${result.checkpoint.version}, sequence ${result.checkpoint.sequence}.`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(await runPilotRelease(process.argv.slice(2)));
  } catch (error) {
    // Do not dump raw exceptions: they can contain user-supplied arguments or paths.
    const message =
      error instanceof PilotReleaseError ||
      error instanceof WindowsUpdateVerificationError
        ? error.message
        : error.code === "EEXIST"
          ? "Output already exists; refusing to overwrite."
          : error.code === "ENOENT"
            ? "A file or directory does not exist."
            : "Cannot complete the operation.";
    console.error(message);
    process.exitCode = 1;
  }
}
