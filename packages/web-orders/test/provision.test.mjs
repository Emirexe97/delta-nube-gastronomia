import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { issueWebSiteTicket, verifyWebSiteTicket, issueWaiterTicket, verifyWaiterTicket } from "../dist/provision.js";

test("signed, short-lived registration identity cannot be altered or replayed after expiration", () => {
  const secret = randomBytes(32).toString("hex");
  const identity = {
    licenseId: "lic-1",
    installationId: "pos-1",
    businessName: "Pizzería Bonis",
  };
  const now = 123_456_789;
  const ticket = issueWebSiteTicket(identity, secret, now);
  assert.deepEqual(verifyWebSiteTicket(ticket, secret, now), identity);
  const [version, body, mac] = ticket.split(".");
  const forged = JSON.parse(Buffer.from(body, "base64url"));
  forged.installationId = "other-pos";
  assert.throws(() =>
    verifyWebSiteTicket(
      [
        version,
        Buffer.from(JSON.stringify(forged)).toString("base64url"),
        mac,
      ].join("."),
      secret,
      now,
    ),
  );
  for (const bad of ["", ticket + ".", "lease." + body + "." + mac, undefined])
    assert.throws(() => verifyWebSiteTicket(bad, secret, now));
  assert.throws(() => verifyWebSiteTicket(ticket, secret, now + 300_000));
  assert.throws(() => verifyWebSiteTicket(ticket, secret, now - 60_000));
  assert.throws(() =>
    verifyWebSiteTicket(ticket, randomBytes(32).toString("hex"), now),
  );
  assert.throws(() => issueWebSiteTicket(identity, "short", now));
});

test("waiter ticket has an isolated audience and contains only the approved installation claims", () => {
  const secret = randomBytes(32).toString("hex");
  const claims = { licenseId: "license-123456", installationId: "install-123456" };
  const now = 123_456_789;
  const ticket = issueWaiterTicket(claims, secret, now);
  assert.deepEqual(verifyWaiterTicket(ticket, secret, now), claims);
  assert.notEqual(ticket.split(".")[0], issueWebSiteTicket({ ...claims, businessName: "Restaurant" }, secret, now).split(".")[0]);
  assert.throws(() => verifyWaiterTicket(ticket, randomBytes(32).toString("hex"), now));
  assert.throws(() => verifyWaiterTicket(ticket, secret, now + 300_000));
  assert.throws(() => verifyWaiterTicket(issueWebSiteTicket({ ...claims, businessName: "Restaurant" }, secret, now), secret, now));
  assert.throws(() => issueWaiterTicket(claims, "short", now));
});
