import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyPanelPassword } from "../dist/panel-auth.js";

test("password CLI writes only new private external files, rejecting repo aliases", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const cli = fileURLToPath(
    new URL("../scripts/set-panel-password.mjs", import.meta.url),
  );
  const folder = await mkdtemp(
    join(tmpdir(), "gastronomy-panel-password-test-"),
  );
  const password = "Isolated CLI fixture password";
  const run = (destination) =>
    spawnSync(process.execPath, [cli, destination], {
      input: password + "\n",
      encoding: "utf8",
      timeout: 5000,
    });
  try {
    const file = join(folder, "panel.hash");
    const first = run(file);
    assert.equal(first.status, 0);
    assert.equal((first.stdout + first.stderr).includes(password), false);
    const hash = (await readFile(file, "utf8")).trim();
    assert.equal(await verifyPanelPassword(password, hash), true);
    assert.notEqual(
      run(file).status,
      0,
      "must not overwrite existing credential",
    );
    assert.equal((await readFile(file, "utf8")).trim(), hash);
    const repoAlias = process.platform === "win32" ? root.toUpperCase() : root;
    assert.notEqual(
      run(join(repoAlias, "must-not-create-password.hash")).status,
      0,
    );
    const alias = join(folder, "repo-alias");
    await symlink(
      root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.notEqual(
      run(join(alias, "must-not-create-password.hash")).status,
      0,
      "reject physical repo through symlink/junction",
    );
  } finally {
    assert.ok(
      resolve(folder).startsWith(
        resolve(tmpdir()) + sep + "gastronomy-panel-password-test-",
      ),
    );
    await rm(folder, { recursive: true, force: true });
  }
});
