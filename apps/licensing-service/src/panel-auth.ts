import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const KEY_BYTES = 64;
const SALT_BYTES = 16;
const MAX_PASSWORD_BYTES = 1024;
const SCRYPT_OPTIONS = { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });

/** Encoded value intended for the private PANEL_PASSWORD_HASH_FILE. */
export async function hashPanelPassword(password: string): Promise<string> {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password, "utf8") < 12 ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES
  ) {
    throw new Error("Panel password must be between 12 and 1024 UTF-8 bytes");
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/** Verifies a scrypt hash without leaking a byte-by-byte comparison. */
export async function verifyPanelPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES ||
    typeof encoded !== "string"
  )
    return false;
  const match = /^scrypt\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(
    encoded,
  );
  if (!match) return false;
  try {
    const salt = Buffer.from(match[1]!, "base64url");
    const expected = Buffer.from(match[2]!, "base64url");
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES)
      return false;
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
