import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
export {
  devicePublicKeyFingerprint,
  deviceProofMessage,
  signDeviceProof,
  verifyDeviceProof,
  type DeviceProof,
  type DeviceProofPurpose,
} from "./device-enrollment.js";

export const DAY_MS = 86_400_000;
export const GRACE_MS = 3 * DAY_MS;
export const VERIFICATION_INTERVAL_MS = 7 * DAY_MS;
export interface LicenseLease {
  schema: 1;
  product: "delta-nube-gastronomia";
  licenseId: string;
  installationId: string;
  businessName: string;
  issuedAt: string;
  paidThrough: string;
  graceUntil: string;
  revision: number;
  status: "ACTIVE" | "SUSPENDED";
}
export function parseLease(value: unknown): LicenseLease {
  if (!value || typeof value !== "object")
    throw new Error("Permiso de uso inválido.");
  const x = value as Record<string, unknown>;
  const id = (v: unknown) =>
    typeof v === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(v);
  const iso = (v: unknown) =>
    typeof v === "string" &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v;
  if (
    x.schema !== 1 ||
    x.product !== "delta-nube-gastronomia" ||
    !id(x.licenseId) ||
    !id(x.installationId) ||
    typeof x.businessName !== "string" ||
    !x.businessName.trim() ||
    x.businessName.length > 160 ||
    !iso(x.issuedAt) ||
    !iso(x.paidThrough) ||
    !iso(x.graceUntil) ||
    !Number.isSafeInteger(x.revision) ||
    (x.revision as number) < 1 ||
    !["ACTIVE", "SUSPENDED"].includes(String(x.status))
  )
    throw new Error("Permiso de uso inválido.");
  const lease = x as unknown as LicenseLease;
  if (Date.parse(lease.graceUntil) !== Date.parse(lease.paidThrough) + GRACE_MS)
    throw new Error("Período de gracia inválido.");
  return lease;
}
/** Exact serialized bytes are signed; no secrets or private keys belong in the client. */
export function signLease(lease: LicenseLease, privateKeyPem: string): string {
  parseLease(lease);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("La clave debe ser Ed25519.");
  const payload = Buffer.from(JSON.stringify(lease)).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), key).toString("base64url")}`;
}
export function verifyLease(
  token: string,
  publicKeyPem: string,
  installationId: string,
): LicenseLease {
  if (
    typeof token !== "string" ||
    token.length > 8192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  )
    throw new Error("Permiso de uso inválido.");
  const [payload, signature] = token.split(".") as [string, string];
  const key = createPublicKey(publicKeyPem);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(payload),
      key,
      Buffer.from(signature, "base64url"),
    )
  )
    throw new Error("La firma del permiso no es válida.");
  const lease = parseLease(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
  if (lease.installationId !== installationId)
    throw new Error("Este permiso pertenece a otra instalación.");
  return lease;
}
export function leaseAccess(
  lease: LicenseLease,
  nowMs: number,
): "ACTIVE" | "GRACE" | "EXPIRED" | "SUSPENDED" {
  if (lease.status === "SUSPENDED") return "SUSPENDED";
  if (nowMs < Date.parse(lease.paidThrough)) return "ACTIVE";
  return nowMs < Date.parse(lease.graceUntil) ? "GRACE" : "EXPIRED";
}
/** Read-only allowlist: unknown/new IPC methods fail closed after expiration. */
export function licenseAllowsMethod(
  method: string,
  canOperate: boolean,
): boolean {
  if (canOperate) return true;
  return new Set([
    "bootstrap",
    "getOrder",
    "listCashSessionHistory",
    "getCashSessionReport",
    "searchCustomers",
    "searchCustomersPage",
    "getCustomerProfile",
    "listPurchases",
    "getFinanceReport",
    "getFinanceProductCosts",
    "listFinanceExpenses",
    "listRecurringFinanceExpenses",
    "getUserPermissions",
    "getDetailedReport",
    "getAuditLog",
    "getDashboard",
    "exportSalesCsv",
    "createBackup",
    "restoreBackup",
    "listPrinters",
    "printCashSessionReport",
    "getLicenseStatus",
    "activateLicense",
    "requestLicenseAccess",
    "refreshLicense",
  ]).has(method);
}
