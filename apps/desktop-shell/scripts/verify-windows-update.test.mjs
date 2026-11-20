import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyArtifacts, validateMetadata, signatureMatches, verifyAuthenticode } from "./verify-windows-update.mjs";

const publisher = "CN=Delta Nube SA";
const config = { enabled: true, target: "win32-x64", feedUrl: "https://updates.example.com/win/", windowsPublisherNames: [publisher] };
const hash = (b) => createHash("sha512").update(b).digest("base64");
const appUpdate = `provider: generic\nurl: '${config.feedUrl}'\npublisherName:\n  - '${publisher}'\n`;
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "win-update-preflight-")); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "win-unpacked", "resources"), { recursive: true });
  const exe = Buffer.from("signed installer fixture"), block = Buffer.from("blockmap bytes");
  const manifest = { version: "1.2.3", files: [{ url: "app.exe", sha512: hash(exe), size: exe.length }] };
  await writeFile(path.join(dir, "config.json"), JSON.stringify(config));
  await writeFile(path.join(dir, "latest.yml"), `version: ${manifest.version}\nfiles:\n  - url: app.exe\n    sha512: ${hash(exe)}\n    size: ${exe.length}\n`);
  await writeFile(path.join(dir, "win-unpacked", "resources", "app-update.yml"), appUpdate);
  await writeFile(path.join(dir, "app.exe"), exe); await writeFile(path.join(dir, "app.exe.blockmap"), block);
  return { dir, manifest, exe, block };
}
test("aprueba latest.yml habitual con sidecar blockmap y compara firma", async (t) => {
  const f = await fixture(t);
  const result = await verifyArtifacts(path.join(f.dir, "config.json"), f.dir, { verifySignature: async () => ({ valid: true, subject: publisher }) });
  assert.deepEqual(result, { version: "1.2.3", files: 1 });
});
test("rechaza config deshabilitada, target/URL inseguros y SemVer inválido", async (t) => {
  const f = await fixture(t);
  for (const changed of [{ enabled: false }, { target: "darwin-arm64" }, { feedUrl: "https://user:pass@host/path" }, { feedUrl: "https://host/path?token=x" }]) assert.throws(() => validateMetadata({ ...config, ...changed }, JSON.stringify(f.manifest), appUpdate, f.dir));
  for (const version of ["1.2.3-beta.1", "01.2.3", "1.2.3+build", "1.2.3+.", "1.2.3+build..1"]) assert.throws(() => validateMetadata(config, JSON.stringify({ ...f.manifest, version }), appUpdate, f.dir), /SemVer estable/);
});
test("rechaza traversal/ADS, duplicados, hash malo, URL discordante y firma/editor desalineados", async (t) => {
  const f = await fixture(t);
  for (const url of ["../app.exe", "C:evil.exe"]) assert.throws(() => validateMetadata(config, JSON.stringify({ ...f.manifest, files: [{ url, size: 1, sha512: hash(Buffer.from("x")) }] }), appUpdate, f.dir), /no seguro/);
  assert.throws(() => validateMetadata(config, JSON.stringify({ ...f.manifest, files: [f.manifest.files[0], f.manifest.files[0]] }), appUpdate, f.dir), /duplicado/);
  assert.throws(() => validateMetadata(config, JSON.stringify({ ...f.manifest, files: [{ ...f.manifest.files[0], sha512: "abcd" }] }), appUpdate, f.dir), /sha512/);
  assert.throws(() => validateMetadata(config, JSON.stringify(f.manifest), `provider: generic\nurl: https://other.example/\npublisherName: '${publisher}'`, f.dir), /proveedor\/URL/);
  await assert.rejects(verifyArtifacts(path.join(f.dir, "config.json"), f.dir, { verifySignature: async () => ({ valid: true, subject: "CN=Otro" }) }), /editor no esperado/);
  await assert.rejects(verifyArtifacts(path.join(f.dir, "config.json"), f.dir, { readFile: async (p, enc) => { if (p.endsWith("app.exe")) return Buffer.from("tampered"); return (await import("node:fs/promises")).readFile(p, enc); }, verifySignature: async () => ({ valid: true, subject: publisher }) }), /Tamaño incorrecto|SHA-512 incorrecto/);
  assert.throws(() => validateMetadata(config, JSON.stringify(f.manifest), appUpdate.replace(publisher, "CN=Otro"), f.dir), /no coincide/);
});
test("rechaza firma inválida y replica regla CN/full-DN del updater", async (t) => {
  const f = await fixture(t);
  await assert.rejects(verifyArtifacts(path.join(f.dir, "config.json"), f.dir, { verifySignature: async () => ({ valid: false, subject: publisher }) }), /Firma Authenticode inválida/);
  assert.equal(signatureMatches(["Delta Nube SA"], "CN=Delta Nube SA, O=Delta Nube"), true);
  assert.equal(signatureMatches(["CN=Delta Nube SA, O=Delta Nube"], "CN=Delta Nube SA, O=Delta Nube, C=AR"), true);
  assert.equal(signatureMatches(["CN=Otro"], "CN=Delta Nube SA, O=Delta Nube"), false);
});
test("PowerShell recibe el path via env, nunca interpolado en el comando", async () => {
  let captured;
  const pathValue = "C:\\temp\\file.exe; harmless";
  const result = await verifyAuthenticode(pathValue, async (...args) => { captured = args; return { stdout: JSON.stringify({ Status: "Valid", Subject: publisher, Path: pathValue }) }; });
  assert.equal(result.valid, true);
  assert.equal(captured[1].includes(pathValue), false);
  assert.equal(captured[2].env.UPDATE_PREFLIGHT_FILE, pathValue);
});
test("el blockmap vacío falla closed", async (t) => {
  const f = await fixture(t); await writeFile(path.join(f.dir, "app.exe.blockmap"), Buffer.alloc(0));
  await assert.rejects(verifyArtifacts(path.join(f.dir, "config.json"), f.dir, { verifySignature: async () => ({ valid: true, subject: publisher }) }), /blockmap está vacío/);
});
test("smoke real de Authenticode en Windows", { skip: process.platform !== "win32" }, async () => {
  const systemRoot = process.env.SystemRoot;
  assert.ok(systemRoot);
  const file = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = await verifyAuthenticode(file);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.match(result.subject, /CN=Microsoft Windows/);
});
