import test from "node:test";
import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("offline runtime image copies the lockfile-pinned Nodemailer package", async () => {
  const [service, lock, dockerfile, metadata, bundler] = await Promise.all([
    readFile(resolve(repo, "apps/licensing-service/package.json"), "utf8"),
    readFile(resolve(repo, "pnpm-lock.yaml"), "utf8"),
    readFile(resolve(repo, "docker/licensing/Dockerfile.runtime"), "utf8"),
    readFile(
      resolve(repo, "node_modules/.pnpm/nodemailer@10.5.0/node_modules/nodemailer/package.json"),
      "utf8",
    ),
    readFile(resolve(repo, "scripts/licensing/package-runtime.mjs"), "utf8"),
  ]);
  const version = JSON.parse(service).dependencies.nodemailer;
  assert.equal(version, "10.5.0");
  assert.match(lock, /nodemailer:\s*\n\s+specifier: 10\.5\.0\s*\n\s+version: 10\.5\.0/);
  assert.equal(JSON.parse(metadata).version, version);
  const source = resolve(
    repo,
    "node_modules/.pnpm/nodemailer@10.5.0/node_modules/nodemailer",
  );
  assert.equal((await lstat(source)).isSymbolicLink(), false);
  assert.match(
    dockerfile,
    /COPY --chmod=0555 node_modules\/\.pnpm\/nodemailer@10\.5\.0\/node_modules\/nodemailer \.\/apps\/licensing-service\/node_modules\/nodemailer/,
  );
  assert.match(bundler, /node_modules\/\.pnpm\/nodemailer@\$\{version\}\/node_modules\/nodemailer/);
  assert.match(bundler, /spawnSync\("tar"/);
});
