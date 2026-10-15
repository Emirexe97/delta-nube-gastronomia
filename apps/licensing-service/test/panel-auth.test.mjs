import test from "node:test";
import assert from "node:assert/strict";
import { hashPanelPassword, verifyPanelPassword } from "../dist/panel-auth.js";

test("panel password hash is salted scrypt and verifies without accepting malformed hashes", async () => {
  const first = await hashPanelPassword("a-long-owner-password-123");
  const second = await hashPanelPassword("a-long-owner-password-123");
  assert.match(first, /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
  assert.notEqual(first, second);
  assert.equal(
    await verifyPanelPassword("a-long-owner-password-123", first),
    true,
  );
  assert.equal(await verifyPanelPassword("wrong-owner-password", first), false);
  assert.equal(
    await verifyPanelPassword("a-long-owner-password-123", "bad"),
    false,
  );
  await assert.rejects(hashPanelPassword("short"), /12 and 1024/);
});
