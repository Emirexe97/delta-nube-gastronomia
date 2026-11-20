import { createHash, createPublicKey, type KeyObject } from "node:crypto";

type PilotPin = Readonly<{ keyId: string; spkiPem: string; sha256: string }>;

// Populate only in an isolated, reviewed pilot build. Do not put private
// material here or load a public key from config, the network or an env var.
const compiledPilotPins: readonly PilotPin[] = [];

export function readWindowsPilotKeys(
  pins: readonly PilotPin[] = compiledPilotPins,
): ReadonlyMap<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  for (const { keyId, spkiPem, sha256 } of pins) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,47}$/.test(keyId) ||
      keys.has(keyId) ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n/.test(spkiPem) ||
      !/^[0-9a-f]{64}$/.test(sha256)
    ) {
      throw new Error("Invalid Windows pilot trust pin");
    }
    const key = createPublicKey(spkiPem);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      createHash("sha256")
        .update(key.export({ type: "spki", format: "der" }))
        .digest("hex") !== sha256
    ) {
      throw new Error("Windows pilot key does not match its pin");
    }
    keys.set(keyId, key);
  }
  return keys;
}
