import { createHash, verify, type KeyObject } from "node:crypto";
import { TextDecoder } from "node:util";

const DOMAIN = Buffer.from("DeltaNubeGastronomia-Update-v1\0", "ascii");
const APP_ID = "com.deltanube.gastronomy";
const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_ARTIFACT_BYTES = 1024 ** 3;
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_VALIDITY_MS = 30 * 24 * 60 * 60_000;
const VERSION =
  /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const KEY_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const UTC_SECONDS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const ENVELOPE_FIELDS = ["format", "keyId", "payload", "signature"];
const PAYLOAD_FIELDS = [
  "appId",
  "platform",
  "arch",
  "channel",
  "version",
  "sequence",
  "issuedAt",
  "expiresAt",
  "minVerifierVersion",
  "artifactPath",
  "artifactSize",
  "artifactSha512",
];

export type AcceptedWindowsRelease = Readonly<{
  sequence: number;
  version: string;
  payloadSha256: string;
  observedAtMs: number;
}>;

export type WindowsUpdateChannel = "stable" | "pilot";

export type VerifiedWindowsRelease = Readonly<{
  checkpoint: AcceptedWindowsRelease;
  artifactPath: string;
  artifactSize: number;
  artifactSha512: string;
  expiresAtMs: number;
}>;

export function isAcceptedWindowsRelease(
  value: unknown,
): value is AcceptedWindowsRelease {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).length === 4 &&
    positiveSafeInteger(r.sequence) &&
    positiveSafeInteger(r.observedAtMs) &&
    typeof r.version === "string" &&
    VERSION.test(r.version) &&
    typeof r.payloadSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(r.payloadSha256)
  );
}

export interface WindowsVerificationContext {
  /** Trusted, locally provisioned Ed25519 public keys. Never populate from the feed. */
  trustedKeys: ReadonlyMap<string, KeyObject>;
  installedVersion: string;
  /** From the compiled runtime mode, never selected by the incoming manifest. */
  channel?: WindowsUpdateChannel;
  nowMs: number;
  /** Only null for a known fresh client; a failed checkpoint read is not a fresh client. */
  lastAccepted: AcceptedWindowsRelease | null;
}

const verifiedSnapshots = new WeakSet<VerifiedWindowsRelease>();
type ErrorCode =
  | "FORMAT"
  | "KEY"
  | "SIGNATURE"
  | "TARGET"
  | "VERSION"
  | "CURRENT"
  | "CLOCK"
  | "TIME_WINDOW"
  | "REPLAY"
  | "ARTIFACT";

export class WindowsUpdateVerificationError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(`Windows update verification failed: ${code}`);
    this.name = "WindowsUpdateVerificationError";
    this.code = code;
  }
}

function reject(code: ErrorCode): never {
  throw new WindowsUpdateVerificationError(code);
}

/** v1 has flat records only. Tokenize before assigning so escaped duplicate keys
 * cannot be silently overwritten by JSON.parse. The cursor consumes all input. */
function readFlatRecord(
  bytes: Uint8Array,
  limit: number,
  fields: readonly string[],
) {
  if (!bytes.byteLength || bytes.byteLength > limit) reject("FORMAT");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    reject("FORMAT");
  }

  const stringToken =
    /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const integerToken = /(?:0|[1-9][0-9]*)/y;
  const spaces = /[ \t\r\n]*/y;
  let cursor = 0;
  const read = (token: RegExp) => {
    token.lastIndex = cursor;
    const value = token.exec(text)?.[0];
    if (value !== undefined) cursor = token.lastIndex;
    return value;
  };
  const expect = (char: string) => {
    read(spaces);
    if (text[cursor++] !== char) reject("FORMAT");
  };
  const record: Record<string, unknown> = Object.create(null);
  expect("{");
  for (let i = 0; i < fields.length; i++) {
    if (i) expect(",");
    read(spaces);
    const rawKey = read(stringToken);
    if (rawKey === undefined) reject("FORMAT");
    const key: string = JSON.parse(rawKey);
    if (!fields.includes(key) || Object.hasOwn(record, key)) reject("FORMAT");
    expect(":");
    read(spaces);
    const rawString = read(stringToken);
    if (rawString !== undefined) record[key] = JSON.parse(rawString);
    else {
      const rawInteger = read(integerToken);
      if (rawInteger === undefined) reject("FORMAT");
      record[key] = Number(rawInteger);
    }
  }
  expect("}");
  read(spaces);
  if (cursor !== text.length) reject("FORMAT");
  return record;
}

function decodeBase64(value: unknown, max: number): Buffer {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(max / 3))
    reject("FORMAT");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > max || bytes.toString("base64") !== value)
    reject("FORMAT");
  return bytes;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function compareVersion(left: string, right: string): number {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    !VERSION.test(left) ||
    !VERSION.test(right)
  )
    reject("VERSION");
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

function utcMillis(value: unknown): number {
  if (typeof value !== "string" || !UTC_SECONDS.test(value))
    reject("TIME_WINDOW");
  const ms = Date.parse(value);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().replace(".000Z", "Z") !== value
  ) {
    reject("TIME_WINDOW");
  }
  return ms;
}

/**
 * No network, filesystem, state persistence or installation. The caller must
 * atomically persist the returned checkpoint before using the release in a live updater.
 */
export function verifyWindowsUpdateEnvelope(
  bytes: Uint8Array,
  context: WindowsVerificationContext,
): VerifiedWindowsRelease {
  const envelope = readFlatRecord(bytes, MAX_ENVELOPE_BYTES, ENVELOPE_FIELDS);
  if (
    envelope.format !== 1 ||
    typeof envelope.keyId !== "string" ||
    !KEY_ID.test(envelope.keyId)
  ) {
    reject("FORMAT");
  }
  const key = context.trustedKeys.get(envelope.keyId);
  if (key?.type !== "public" || key.asymmetricKeyType !== "ed25519")
    reject("KEY");
  const payload = decodeBase64(envelope.payload, MAX_PAYLOAD_BYTES);
  const signature = decodeBase64(envelope.signature, 64);
  if (
    signature.length !== 64 ||
    !verify(null, Buffer.concat([DOMAIN, payload]), key, signature)
  ) {
    reject("SIGNATURE");
  }

  const record = readFlatRecord(payload, MAX_PAYLOAD_BYTES, PAYLOAD_FIELDS);
  if (
    record.appId !== APP_ID ||
    record.platform !== "win32" ||
    record.arch !== "x64" ||
    record.channel !== (context.channel ?? "stable")
  )
    reject("TARGET");
  const { version, sequence, artifactPath, artifactSize, artifactSha512 } =
    record;
  if (
    !positiveSafeInteger(record.minVerifierVersion) ||
    record.minVerifierVersion > 1 ||
    typeof version !== "string"
  ) {
    reject("VERSION");
  }
  const comparison = compareVersion(version, context.installedVersion);
  if (comparison < 0) reject("VERSION");
  if (!positiveSafeInteger(sequence)) reject("FORMAT");
  if (
    typeof artifactPath !== "string" ||
    !artifactPath.startsWith(`versions/${version}/`)
  ) {
    reject("ARTIFACT");
  }
  const filename = artifactPath.slice(`versions/${version}/`.length);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,123}\.exe$/.test(filename) ||
    /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])\./i.test(filename) ||
    !positiveSafeInteger(artifactSize) ||
    artifactSize > MAX_ARTIFACT_BYTES ||
    typeof artifactSha512 !== "string" ||
    !/^[0-9a-f]{128}$/.test(artifactSha512)
  ) {
    reject("ARTIFACT");
  }

  const { nowMs, lastAccepted } = context;
  if (!positiveSafeInteger(nowMs)) reject("CLOCK");
  const payloadSha256 = createHash("sha256").update(payload).digest("hex");
  if (lastAccepted !== null) {
    if (!isAcceptedWindowsRelease(lastAccepted)) reject("REPLAY");
    if (nowMs + CLOCK_SKEW_MS < lastAccepted.observedAtMs) reject("CLOCK");
    if (
      sequence < lastAccepted.sequence ||
      compareVersion(version, lastAccepted.version) < 0 ||
      (sequence === lastAccepted.sequence &&
        payloadSha256 !== lastAccepted.payloadSha256)
    ) {
      reject("REPLAY");
    }
  }

  const observedAtMs = Math.max(nowMs, lastAccepted?.observedAtMs ?? 0);
  const issuedAtMs = utcMillis(record.issuedAt);
  const expiresAtMs = utcMillis(record.expiresAt);
  if (
    issuedAtMs > nowMs + CLOCK_SKEW_MS ||
    expiresAtMs <= observedAtMs ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > MAX_VALIDITY_MS
  )
    reject("TIME_WINDOW");
  if (comparison === 0) reject("CURRENT");

  const checkpoint = Object.freeze({
    version,
    sequence,
    payloadSha256,
    observedAtMs,
  });
  const release = Object.freeze({
    checkpoint,
    artifactPath,
    artifactSize,
    artifactSha512,
    expiresAtMs,
  });
  verifiedSnapshots.add(release);
  return release;
}

/** Verify exactly the bytes consumed from a local/download stream. This does not
 * make the original file path safe to execute later or protect it from replacement. */
export async function verifyWindowsUpdateArtifact(
  release: VerifiedWindowsRelease,
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<void> {
  if (!verifiedSnapshots.has(release)) reject("ARTIFACT");
  const hash = createHash("sha512");
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > release.artifactSize) reject("ARTIFACT");
    hash.update(chunk);
  }
  if (
    size !== release.artifactSize ||
    hash.digest("hex") !== release.artifactSha512
  )
    reject("ARTIFACT");
}
