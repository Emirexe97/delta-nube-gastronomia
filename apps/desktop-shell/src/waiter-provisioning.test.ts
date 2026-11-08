import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Node test runner loads TypeScript directly.
import { WaiterProvisioning } from "./waiter-provisioning.ts";

const ticket = `dn-waiter-v1.${"p".repeat(30)}.${"s".repeat(43)}`;
const secret = "w".repeat(52);
const credential = { storeId: "store_1", waiterToken: secret };
const vault = { isAvailable: () => true, encryptString: (s: string) => Buffer.from(`encrypted:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^encrypted:/, "") };
const options = (userDataPath: string, fetch: typeof globalThis.fetch, overrides: Partial<ConstructorParameters<typeof WaiterProvisioning>[0]> = {}) => ({ userDataPath, baseUrl: "https://pedidos.example", safeStorage: vault, installationId: () => "install_1", licenseId: () => "license_1", fetch, ...overrides });

test("provisions once with only the transient ticket, persists encrypted secret and reloads only for matching authority", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".waiter-provision-"));
  try {
    let calls = 0;
    const provisioner = new WaiterProvisioning(options(dir, async (input, init) => {
      calls++;
      assert.equal(String(input), "https://pedidos.example/v1/waiter-connections");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${ticket}`);
      assert.equal(init?.body, "{}");
      return Response.json(credential);
    }));
    await provisioner.initialize();
    assert.equal(await provisioner.provision(ticket), true);
    assert.deepEqual(provisioner.credential(), credential);
    assert.equal(await provisioner.provision(ticket), true);
    assert.equal(calls, 1, "credential cache makes provisioning idempotent");
    const disk = await readFile(join(dir, "waiter-connection-state.json"), "utf8");
    assert.doesNotMatch(disk, new RegExp(secret));
    const restored = new WaiterProvisioning(options(dir, async () => { throw new Error("must not call network"); }));
    await restored.initialize();
    assert.deepEqual(restored.credential(), credential);
    const otherLicense = new WaiterProvisioning(options(dir, async () => { throw new Error("must not call network"); }, { licenseId: () => "license_2" }));
    await otherLicense.initialize();
    assert.equal(otherLicense.credential(), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("backs off transient failures without blocking and refuses malformed credentials", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".waiter-provision-"));
  try {
    let now = 10_000, calls = 0;
    const provisioner = new WaiterProvisioning(options(dir, async () => { calls++; return new Response("{}", { status: 503 }); }, { now: () => now }));
    await provisioner.initialize();
    assert.equal(await provisioner.provision(ticket), false);
    assert.equal(await provisioner.provision(ticket), false);
    assert.equal(calls, 1);
    now += 1_000;
    assert.equal(await provisioner.provision(ticket), false);
    assert.equal(calls, 2);
    assert.equal(await provisioner.provision("not-a-ticket"), false);
    assert.equal(calls, 2);
    assert.equal(provisioner.credential(), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("does not expose or retain a live credential across license switches; a fresh ticket replaces old binding", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".waiter-provision-"));
  try {
    let licenseId = "license_1", now = 5_000_000, calls = 0;
    const provisioner = new WaiterProvisioning(options(dir, async (_input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${ticket}`);
      return Response.json({ storeId: `store_${calls}`, waiterToken: String(calls).repeat(52) });
    }, { licenseId: () => licenseId, now: () => now }));
    await provisioner.initialize();
    assert.equal(await provisioner.provision(ticket), true);
    assert.equal(provisioner.credential()?.storeId, "store_1");
    licenseId = "license_2";
    assert.equal(provisioner.credential(), null);
    assert.equal(await provisioner.provision(ticket), true);
    assert.equal(provisioner.credential()?.storeId, "store_2");
    now += 13 * 60 * 60_000;
    assert.equal(await provisioner.provision(ticket), true);
    assert.equal(calls, 3, "a cached enrollment is periodically revalidated with a fresh ticket");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects corrupted cache and secure-storage outage without exposing or overwriting credentials", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".waiter-provision-"));
  try {
    const path = join(dir, "waiter-connection-state.json");
    const corrupted = "{not-json";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, corrupted);
    const provisioner = new WaiterProvisioning(options(dir, async () => { throw new Error("unexpected"); }));
    await provisioner.initialize();
    assert.equal(provisioner.credential(), null);
    assert.equal(await provisioner.provision(ticket), false);
    assert.equal(await readFile(path, "utf8"), corrupted);

    const unavailable = new WaiterProvisioning(options(dir, async () => { throw new Error("unexpected"); }, { safeStorage: { ...vault, isAvailable: () => false } }));
    assert.equal(await unavailable.provision(ticket), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
