import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { issueWebSiteTicket, verifyWebSiteTicket } from "../dist/provision.js";

test("website ticket preserves signed canonical accessUntil and rejects invalid dates", () => {
  const secret = randomBytes(32).toString("hex"), now = 123456;
  const claims = { licenseId: "lic", installationId: "pos", businessName: "Cafe", accessUntil: "2027-01-02T03:04:05.000Z" };
  const ticket = issueWebSiteTicket(claims, secret, now);
  assert.deepEqual(verifyWebSiteTicket(ticket, secret, now), claims);
  for (const accessUntil of ["not-a-date", "2027-02-30T03:04:05.000Z", "2027-01-02T03:04:05Z"]) {
    assert.throws(() => issueWebSiteTicket({ ...claims, accessUntil }, secret, now));
  }
  const [v, p, mac] = ticket.split("."), payload = JSON.parse(Buffer.from(p, "base64url"));
  payload.accessUntil = "2028-01-01T00:00:00.000Z";
  assert.throws(() => verifyWebSiteTicket([v, Buffer.from(JSON.stringify(payload)).toString("base64url"), mac].join("."), secret, now));
  const legacy = issueWebSiteTicket({ licenseId: "lic", installationId: "pos", businessName: "Cafe" }, secret, now);
  assert.equal(verifyWebSiteTicket(legacy, secret, now).accessUntil, undefined);
});
