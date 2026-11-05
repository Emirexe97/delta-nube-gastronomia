// Node-only export. The shared secret belongs on the two services, never in the POS.
import { createHmac, timingSafeEqual } from "node:crypto";

export type WebSiteIdentity = {
  licenseId: string;
  installationId: string;
  businessName: string;
};
const prefix = "dn-web-site-v1";
const ttl = 5 * 60_000;
function signature(secret: string, payload: string): Buffer {
  if (Buffer.byteLength(secret) < 32)
    throw new Error("WEB_SITE_PROVISION_SECRET requires at least 32 bytes");
  return createHmac("sha256", secret)
    .update(prefix + "." + payload)
    .digest();
}
function validIdentity(data: Partial<WebSiteIdentity> | null): boolean {
  const id = (s: unknown) =>
    typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s);
  return (
    !!data &&
    id(data.licenseId) &&
    id(data.installationId) &&
    typeof data.businessName === "string" &&
    data.businessName.trim().length > 0 &&
    data.businessName.length <= 160
  );
}
export function issueWebSiteTicket(
  identity: WebSiteIdentity,
  secret: string,
  now = Date.now(),
): string {
  if (!validIdentity(identity) || !Number.isSafeInteger(now))
    throw new Error("Invalid web site identity");
  const { licenseId, installationId, businessName } = identity;
  const payload = Buffer.from(
    JSON.stringify({
      licenseId,
      installationId,
      businessName,
      iat: now,
      exp: now + ttl,
    }),
  ).toString("base64url");
  return [
    prefix,
    payload,
    signature(secret, payload).toString("base64url"),
  ].join(".");
}
export function verifyWebSiteTicket(
  ticket: string,
  secret: string,
  now = Date.now(),
): WebSiteIdentity {
  const invalid = () => new Error("Invalid or expired web site ticket");
  if (typeof ticket !== "string" || ticket.length > 4096) throw invalid();
  const [version, payload, mac, ...rest] = ticket.split(".");
  if (
    version !== prefix ||
    !payload ||
    !mac ||
    rest.length ||
    !/^[A-Za-z0-9_-]+$/.test(payload) ||
    !/^[A-Za-z0-9_-]{43}$/.test(mac)
  )
    throw invalid();
  if (
    !timingSafeEqual(
      Buffer.from(signature(secret, payload).toString("base64url")),
      Buffer.from(mac),
    )
  )
    throw invalid();
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (
    !validIdentity(data) ||
    !Number.isSafeInteger(data.iat) ||
    !Number.isSafeInteger(data.exp) ||
    data.exp !== data.iat + ttl ||
    data.iat > now + 15_000 ||
    data.exp <= now
  )
    throw invalid();
  return {
    licenseId: data.licenseId,
    installationId: data.installationId,
    businessName: data.businessName,
  };
}
