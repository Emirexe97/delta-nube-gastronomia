import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

export type DeviceProofPurpose = "request" | "lease";
export interface DeviceProof {
  purpose: DeviceProofPurpose;
  challengeId: string;
  nonce: string;
  installationId: string;
  keyFingerprint: string;
  businessName?: string;
}

/** A public identifier, not a credential or authorization to operate. */
export function devicePublicKeyFingerprint(publicKey: string): string {
  if (typeof publicKey !== "string" || Buffer.byteLength(publicKey) > 4096)
    throw new Error("Clave del equipo inválida.");
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("La identidad del equipo debe ser Ed25519.");
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

/** Purpose, identity, public key and business name are covered by the proof. */
export function deviceProofMessage(proof: DeviceProof): Buffer {
  const id = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
  if (
    !proof ||
    !["request", "lease"].includes(proof.purpose) ||
    !id(proof.challengeId) ||
    !id(proof.installationId) ||
    typeof proof.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(proof.nonce) ||
    typeof proof.keyFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(proof.keyFingerprint)
  )
    throw new Error("Solicitud del equipo inválida.");
  if (
    proof.purpose === "request" &&
    (typeof proof.businessName !== "string" ||
      !proof.businessName.trim() ||
      proof.businessName.length > 160)
  )
    throw new Error("Ingresá el nombre del negocio.");
  if (proof.purpose === "lease" && proof.businessName !== undefined)
    throw new Error("La prueba de verificación no admite otro negocio.");
  return Buffer.from(
    JSON.stringify([
      "delta-nube-gastronomia/device-proof/v1",
      proof.purpose,
      proof.challengeId,
      proof.nonce,
      proof.installationId,
      proof.keyFingerprint,
      proof.purpose === "request" ? proof.businessName!.trim() : "",
    ]),
    "utf8",
  );
}

export function signDeviceProof(
  proof: DeviceProof,
  privateKey: string,
): string {
  const key = createPrivateKey(privateKey);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    devicePublicKeyFingerprint(
      createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
    ) !== proof.keyFingerprint
  )
    throw new Error("La identidad del equipo no coincide.");
  return sign(null, deviceProofMessage(proof), key).toString("base64url");
}

export function verifyDeviceProof(
  proof: DeviceProof,
  signature: string,
  publicKey: string,
): boolean {
  try {
    if (
      typeof signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(signature) ||
      devicePublicKeyFingerprint(publicKey) !== proof.keyFingerprint
    )
      return false;
    return verify(
      null,
      deviceProofMessage(proof),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
