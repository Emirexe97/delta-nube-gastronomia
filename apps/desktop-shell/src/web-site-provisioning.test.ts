import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript tests directly.
import { WebSiteProvisioning } from "./web-site-provisioning.ts";

const vault = { isAvailable: () => true, encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, "") };
const metadata = { displayName: "Cafe Norte", tagline: "Rico", accent: "#123456", designMode: "CUSTOM" };
const registration = { storeId: "store_123", slug: "cafe-norte", url: "https://cafe-norte.pedidos.example", receiveToken: "t".repeat(43), ...metadata };
const make = async (dir: string, fetch: typeof globalThis.fetch, env: NodeJS.ProcessEnv = {}, now?: () => number) => { const value = new WebSiteProvisioning({ userDataPath: dir, baseUrl: "https://pedidos.example", safeStorage: vault, env, installationId: () => "install_1", fetch, now }); await value.initialize(); return value; };

test("encrypted signup survives restart and provisions with a fresh, transient ticket after transient failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-site-"));
  try {
    let calls = 0; const env: NodeJS.ProcessEnv = {};
    const inheritedToken = process.env.GASTRONOMY_WEB_ORDERS_TOKEN;
    const first = await make(dir, async (_url, init) => { calls++; assert.equal(init?.method, "POST"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"k".repeat(40)}`); if (init?.body) assert.deepEqual(JSON.parse(String(init.body)), { slug: "cafe-norte", whatsappNumber: "541112345678" }); if (calls === 1) return new Response("", { status: 503 }); return new Response(JSON.stringify(registration)); }, env);
    assert.equal((await first.select({ slug: "Cafe-Norte", whatsappNumber: "+54 (11) 1234-5678" })).state, "PENDING");
    assert.equal((await first.provision("k".repeat(40), { slug: "cafe-norte", whatsappNumber: "541112345678" })).state, "ERROR");
    const disk = await readFile(join(dir, "web-site-state.json"), "utf8");
    assert.doesNotMatch(disk, /"k{20}|"t{20}|541112345678/); assert.match(disk, /encryptedSignup/);
    let secondCalls = 0;
    const restarted = await make(dir, async (_url, init) => { secondCalls++; assert.equal(init?.method, "POST"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${"n".repeat(40)}`); return new Response(JSON.stringify(registration)); }, env);
    assert.deepEqual(restarted.selectedSignup(), { slug: "cafe-norte", whatsappNumber: "541112345678" });
    assert.equal((await restarted.provision("n".repeat(40), restarted.selectedSignup()!)).state, "ACTIVE");
    assert.equal(secondCalls, 1); assert.equal(env.GASTRONOMY_WEB_ORDERS_TOKEN, "t".repeat(43));
    assert.equal(process.env.GASTRONOMY_WEB_ORDERS_TOKEN, inheritedToken, "generated receiver secrets remain in the private sync env");
    assert.equal(await restarted.provision("n".repeat(40), { slug: "cafe-norte", whatsappNumber: "541112345678" }).then(x => x.state), "ACTIVE");
    assert.equal(secondCalls, 1, "active site must not be provisioned again");
    await assert.rejects(() => restarted.select({ slug: "another-site", whatsappNumber: "541112345678" }), /Ya hay una tienda registrada/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("idempotent retry trusts only the canonical server slug and matching HTTPS URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-site-"));
  try {
    const canonical = { ...registration, slug: "original-site", url: "https://original-site.deltanubeweb.com" };
    const value = await make(dir, async () => new Response(JSON.stringify(canonical)));
    await value.select({ slug: "new-attempt", whatsappNumber: "541112345678" });
    const status = await value.provision("n".repeat(40), { slug: "new-attempt", whatsappNumber: "541112345678" });
    assert.equal(status.state, "ACTIVE"); assert.equal(status.slug, "original-site"); assert.equal(status.url, canonical.url);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("refreshes access for an ACTIVE site without provisioning it again or persisting its ticket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-site-refresh-"));
  try {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const value = await make(dir, async (url, init) => { calls.push({ url: String(url), init }); return calls.length === 1 ? new Response(JSON.stringify(registration)) : new Response("{}", { status: 200 }); });
    await value.select({ slug: "cafe-norte", whatsappNumber: "1112345678" });
    await value.provision("n".repeat(40), { slug: "cafe-norte", whatsappNumber: "1112345678" });
    await value.refreshAccess("r".repeat(40));
    assert.equal(new URL(calls[1]!.url).pathname, "/v1/web-sites/access");
    assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { ticket: "r".repeat(40) });
    assert.equal(calls.length, 2);
    assert.doesNotMatch(await readFile(join(dir, "web-site-state.json"), "utf8"), /r{20}/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("manual sync env prevents accidental second storefront registration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-site-"));
  try {
    const env: NodeJS.ProcessEnv = { GASTRONOMY_WEB_ORDERS_URL: "https://manual.example", GASTRONOMY_WEB_ORDERS_TOKEN: "m".repeat(43), GASTRONOMY_WEB_ORDERS_STORE_ID: "manual" };
    let calls = 0; const value = await make(dir, async () => { calls++; return new Response(JSON.stringify(registration)); }, env);
    const status = await value.select({ slug: "cafe-norte", whatsappNumber: "1112345678" });
    assert.equal(status.state, "ERROR"); assert.equal(calls, 0);
    assert.equal((await value.provision("n".repeat(40), { slug: "cafe-norte", whatsappNumber: "1112345678" })).state, "ERROR");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("branding GET and PATCH reconcile canonical metadata and pin installation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-site-"));
  try {
    let calls = 0; const requests: RequestInit[] = []; let now = 1_000_000;
    const value = await make(dir, async (_url, init) => { requests.push(init ?? {}); calls++; return calls === 1 ? new Response(JSON.stringify(registration)) : new Response(JSON.stringify({ ...metadata, designMode: calls === 4 ? "CUSTOM" : "STANDARD", displayName: calls === 2 ? "Owner-edited name" : calls === 4 ? "Custom name" : "Cafe" })); }, {}, () => now);
    await value.select({ slug: "cafe-norte", whatsappNumber: "1112345678" });
    assert.equal((await value.provision("n".repeat(40), { slug: "cafe-norte", whatsappNumber: "1112345678" })).state, "ACTIVE");
    // Force initial reconcile by advancing beyond the bounded cache window.
    now += 30_001;
    assert.equal((await value.getStatus()).displayName, "Owner-edited name");
    assert.equal(value.status().designMode, "STANDARD");
    assert.equal((await value.updateBranding({ displayName: "Cafe", tagline: "Simple", accent: "#ffffff" })).designMode, "STANDARD");
    now += 30_001;
    assert.equal((await value.getStatus()).designMode, "CUSTOM");
    for (const init of requests.slice(1)) { assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${"t".repeat(43)}`); assert.equal(new Headers(init.headers).get("x-pos-installation"), "install_1"); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unreadable persisted credential never reports a stale active status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-site-"));
  try {
    const first = await make(dir, async () => new Response(JSON.stringify(registration)));
    await first.select({ slug: "cafe-norte", whatsappNumber: "1112345678" });
    await first.provision("n".repeat(40), { slug: "cafe-norte", whatsappNumber: "1112345678" });
    const brokenVault = { isAvailable: () => true, encryptString: vault.encryptString, decryptString: (_b: Buffer) => { throw new Error("unavailable"); } };
    const broken = new WebSiteProvisioning({ userDataPath: dir, baseUrl: "https://pedidos.example", safeStorage: brokenVault, installationId: () => "install_1" });
    await broken.initialize(); assert.equal(broken.status().state, "ERROR"); assert.equal(broken.status().url, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
