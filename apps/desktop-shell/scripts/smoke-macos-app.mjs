import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { _electron as electron } from "@playwright/test";
import { printRecentMacCrashes } from "./macos-crash-diagnostics.mjs";

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
    args: [`--user-data-dir=${profile}`],
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
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    resolve(profile),
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
