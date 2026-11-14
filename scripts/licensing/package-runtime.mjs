#!/usr/bin/env node
// Bundle already-built licensing runtime artifacts for an offline Docker context.
// Deliberately allowlists runtime files; never archive the repository or secrets.
import { cp, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputArg = process.argv[2];
if (!outputArg || process.argv.length !== 3) {
  console.error("Usage: node scripts/licensing/package-runtime.mjs <output.tar.gz>");
  process.exit(2);
}
const archive = resolve(outputArg);
const manifest = JSON.parse(
  await readFile(join(repo, "apps/licensing-service/package.json"), "utf8"),
);
const version = manifest.dependencies?.nodemailer;
if (version !== "10.5.0") throw new Error("Expected locked Nodemailer 10.5.0");

const files = [
  "apps/licensing-service/package.json",
  "apps/licensing-service/dist",
  "packages/licensing/package.json",
  "packages/licensing/dist",
  "packages/web-orders/package.json",
  "packages/web-orders/dist",
  `node_modules/.pnpm/nodemailer@${version}/node_modules/nodemailer`,
];
const stage = await mkdtemp(join(tmpdir(), "licensing-runtime-"));
try {
  for (const file of files) {
    const source = join(repo, file);
    await lstat(source); // fail early if a required prebuilt artifact is absent
    const destination = join(stage, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: false });
  }
  await mkdir(dirname(archive), { recursive: true });
  const result = spawnSync("tar", ["-czf", archive, "-C", stage, ...files], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tar exited with status ${result.status}`);
  console.log(`Created runtime bundle: ${archive}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
