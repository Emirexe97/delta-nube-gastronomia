import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  DAY_MS,
  GRACE_MS,
  parseLease,
  signLease,
  verifyLease,
  leaseAccess,
  licenseAllowsMethod,
} from "../dist/index.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const otherPublicPem = otherPublicKey.export({ type: "spki", format: "pem" });
const installationId = "installation_123456";
const validLease = (overrides = {}) => {
  const paidThrough = "2027-01-21T00:00:00.000Z";
  return {
    schema: 1,
    product: "delta-nube-gastronomia",
    licenseId: "license_123456",
    installationId,
    businessName: "Comercio de prueba",
    issuedAt: "2027-01-01T00:00:00.000Z",
    paidThrough,
    graceUntil: new Date(Date.parse(paidThrough) + GRACE_MS).toISOString(),
    revision: 1,
    status: "ACTIVE",
    ...overrides,
  };
};

test("Ed25519 leases round-trip and are installation-bound", () => {
  const lease = validLease();
  const token = signLease(lease, privatePem);
  assert.deepEqual(verifyLease(token, publicPem, installationId), lease);
  assert.throws(
    () => verifyLease(token, publicPem, "another_installation"),
    /otra instalación/,
  );
});

test("rejects tampering, a different verification key, and oversized tokens", () => {
  const token = signLease(validLease(), privatePem);
  const [payload, signature] = token.split(".");
  const altered = `${Buffer.from(JSON.stringify(validLease({ businessName: "alterado" }))).toString("base64url")}.${signature}`;
  assert.throws(() => verifyLease(altered, publicPem, installationId));
  assert.throws(() => verifyLease(token, otherPublicPem, installationId));
  assert.throws(() =>
    verifyLease(`${"a".repeat(8193)}.AA`, publicPem, installationId),
  );
});

test("validates product, schema, dates, grace arithmetic, and positive safe revision", () => {
  for (const overrides of [
    { schema: 2 },
    { product: "another-product" },
    { paidThrough: "not-a-date" },
    { issuedAt: "2027-01-01" },
    { graceUntil: "2027-01-24T00:00:00.001Z" },
    { revision: 0 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(() => parseLease(validLease(overrides)));
  assert.throws(() => parseLease(null));
  assert.throws(() => signLease(validLease({ product: "bad" }), privatePem));
});

test("active paid term wins while offline; paidThrough and grace end are exclusive", () => {
  const lease = validLease();
  const paid = Date.parse(lease.paidThrough);
  const grace = Date.parse(lease.graceUntil);
  assert.equal(leaseAccess(lease, paid - 20 * DAY_MS), "ACTIVE");
  assert.equal(leaseAccess(lease, paid - 7 * DAY_MS), "ACTIVE");
  assert.equal(leaseAccess(lease, paid - 1), "ACTIVE");
  assert.equal(leaseAccess(lease, paid), "GRACE");
  assert.equal(leaseAccess(lease, grace - 1), "GRACE");
  assert.equal(leaseAccess(lease, grace), "EXPIRED");
  assert.equal(
    leaseAccess(validLease({ status: "SUSPENDED" }), paid - 1),
    "SUSPENDED",
  );
});

test("expired mode allows explicit read-only methods and rejects unknown or money-moving methods", () => {
  assert.equal(licenseAllowsMethod("bootstrap", false), true);
  assert.equal(licenseAllowsMethod("getLicenseStatus", false), true);
  assert.equal(licenseAllowsMethod("createBackup", false), true);
  assert.equal(licenseAllowsMethod("newUnreviewedMethod", false), false);
  assert.equal(licenseAllowsMethod("createOrder", false), false);
  assert.equal(licenseAllowsMethod("addPayment", false), false);
  assert.equal(licenseAllowsMethod("closeCashSession", false), false);
  assert.equal(licenseAllowsMethod("createOrder", true), true);
});
