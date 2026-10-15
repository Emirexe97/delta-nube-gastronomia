import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  devicePublicKeyFingerprint,
  signDeviceProof,
  verifyDeviceProof,
} from "../dist/index.js";

function fixture() {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const privateKey = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  return {
    publicKey,
    privateKey,
    proof: {
      purpose: "request",
      challengeId: "challenge-test-123",
      nonce: randomBytes(32).toString("base64url"),
      installationId: "installation-test-123",
      keyFingerprint: devicePublicKeyFingerprint(publicKey),
      businessName: "Café de prueba",
    },
  };
}

test("device proof binds the nonce, purpose, installation, key and business", () => {
  const { publicKey, privateKey, proof } = fixture();
  const signature = signDeviceProof(proof, privateKey);
  assert.equal(verifyDeviceProof(proof, signature, publicKey), true);
  for (const change of [
    { nonce: randomBytes(32).toString("base64url") },
    { challengeId: "different-challenge" },
    { installationId: "another-installation" },
    { businessName: "Otro negocio" },
    { purpose: "lease", businessName: undefined },
    { keyFingerprint: "a".repeat(64) },
  ])
    assert.equal(
      verifyDeviceProof({ ...proof, ...change }, signature, publicKey),
      false,
    );
  assert.equal(verifyDeviceProof(proof, signature, fixture().publicKey), false);
});

test("lease proofs cannot inject a business and malformed signatures fail closed", () => {
  const { proof, publicKey, privateKey } = fixture();
  const lease = { ...proof, purpose: "lease", businessName: undefined };
  assert.equal(
    verifyDeviceProof(lease, signDeviceProof(lease, privateKey), publicKey),
    true,
  );
  assert.throws(() =>
    signDeviceProof({ ...lease, businessName: "Injected" }, privateKey),
  );
  for (const signature of ["", "_".repeat(87), "not-a-proof"])
    assert.equal(verifyDeviceProof(proof, signature, publicKey), false);
  assert.equal(verifyDeviceProof(proof, "A".repeat(86), "not a key"), false);
  assert.throws(() => signDeviceProof(proof, fixture().privateKey));
});
