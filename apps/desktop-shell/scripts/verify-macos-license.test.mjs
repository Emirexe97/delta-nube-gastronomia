import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve("electron-builder/package.json"));
const library = createRequire(builder.resolve("app-builder-lib/package.json"));
const asar = library("@electron/asar");
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const verifier = fileURLToPath(
  new URL("./verify-macos-license.mjs", import.meta.url),
);

async function fixture(
  check,
  { omitConfig = false, alterConfig = false } = {},
) {
  const temp = await mkdtemp(join(tmpdir(), "gastronomy-license-asar-"));
  try {
    const source = join(temp, "source");
    await mkdir(join(source, "dist"), { recursive: true });
    for (const file of ["main.js", "preload.js"]) {
      await copyFile(join(appRoot, "dist", file), join(source, "dist", file));
    }
    if (!omitConfig) {
      const config = JSON.parse(
        await readFile(join(appRoot, "licensing-config.json"), "utf8"),
      );
      if (alterConfig) config.serverUrl = "https://unapproved.invalid";
      await writeFile(
        join(source, "licensing-config.json"),
        JSON.stringify(config),
      );
    }
    const archive = join(temp, "app.asar");
    await asar.createPackage(source, archive);
    const result = spawnSync(process.execPath, [verifier, archive], {
      encoding: "utf8",
      timeout: 10000,
    });
    await check(result);
  } finally {
    assert.ok(
      resolve(temp).startsWith(
        resolve(tmpdir()) + sep + "gastronomy-license-asar-",
      ),
    );
    await rm(temp, { recursive: true, force: true });
  }
}

test("packaged ASAR has the approved public config and real main/preload licensing handlers", async () => {
  await fixture(({ status, stdout }) => {
    assert.equal(status, 0);
    assert.match(stdout, /Verified packaged public licensing configuration/);
  });
});

test("packaged licensing check rejects a missing config instead of approving a broken installation", async () => {
  await fixture(
    ({ status, stderr }) => {
      assert.notEqual(status, 0);
      assert.match(stderr, /licensing-config.json/);
    },
    { omitConfig: true },
  );
});

test("packaged licensing check rejects a substituted endpoint", async () => {
  await fixture(
    ({ status, stderr }) => {
      assert.notEqual(status, 0);
      assert.match(stderr, /Packaged licensing config must match/);
    },
    { alterConfig: true },
  );
});
