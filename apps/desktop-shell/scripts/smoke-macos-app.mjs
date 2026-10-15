import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { _electron as electron } from "@playwright/test";
import { printRecentMacCrashes } from "./macos-crash-diagnostics.mjs";
import { spawnSync } from "node:child_process";

const [executablePath] = process.argv.slice(2);
assert.ok(
  executablePath,
  "Usage: node smoke-macos-app.mjs <packaged-electron-executable>",
);
const tempRoot = process.env.GASTRONOMY_SMOKE_PROFILE_ROOT || tmpdir();
assert.equal(
  resolve(tempRoot),
  resolve(tmpdir()),
  "Smoke profile root must be the system temp directory",
);
const profile = await mkdtemp(join(tempRoot, "gastronomy-dmg-smoke-"));
let app;
const startedAt = Date.now();
try {
  app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, "--enable-logging=stderr"],
    timeout: 30000,
  });
  const page = await app.firstWindow({ timeout: 30000 });
  await page
    .getByText("Delta Nube", { exact: true })
    .waitFor({ state: "visible", timeout: 30000 });
  assert.equal(
    await app.evaluate(({ app }) => app.isPackaged),
    true,
    "Smoke must exercise the packaged app",
  );
  assert.equal(
    await realpath(await app.evaluate(({ app }) => app.getPath("userData"))),
    await realpath(profile),
  );
  const status = await page.evaluate(() =>
    window.gastronomy.getLicenseStatus(),
  );
  assert.equal(
    status.state,
    "UNACTIVATED",
    "Fresh isolated profile should read as unactivated",
  );
  assert.equal(status.canOperate, false);
  console.log(
    "Packaged app opened; SQLite-backed startup and licensing preload/IPC returned UNACTIVATED without activation.",
  );
} catch (error) {
  if (process.platform === "darwin") {
    // Diagnostic control only, not an alternative passing smoke: does this
    // exact executable also crash without Playwright's inspector flags?
    const controlProfile = await mkdtemp(
      join(tempRoot, "gastronomy-dmg-smoke-"),
    );
    try {
      const control = spawnSync(
        executablePath,
        [`--user-data-dir=${controlProfile}`, "--enable-logging=stderr"],
        { encoding: "utf8", timeout: 10000, killSignal: "SIGKILL" },
      );
      console.error(
        "Direct launch diagnostic:",
        JSON.stringify({
          status: control.status,
          signal: control.signal,
          error: control.error?.code,
          stderr: control.stderr?.slice(-12000),
          stdout: control.stdout?.slice(-4000),
        }),
      );
    } finally {
      await rm(controlProfile, { recursive: true, force: true });
    }
  }
  await printRecentMacCrashes(startedAt);
  throw error;
} finally {
  if (app) {
    let closeTimer;
    try {
      await Promise.race([
        app.close(),
        new Promise((_, reject) => {
          closeTimer = setTimeout(
            () =>
              reject(new Error("Packaged app did not close within 15 seconds")),
            15000,
          );
        }),
      ]);
    } catch (error) {
      app.process().kill("SIGKILL");
      throw error;
    } finally {
      clearTimeout(closeTimer);
    }
  }
  if (
    !resolve(profile).startsWith(
      resolve(tempRoot) + sep + "gastronomy-dmg-smoke-",
    )
  ) {
    throw new Error(`Unsafe temporary smoke profile: ${profile}`);
  }
  await rm(profile, { recursive: true, force: true });
}
