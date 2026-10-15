import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [dmg, arch] = process.argv.slice(2);
assert.ok(dmg, "Usage: node verify-macos-dmg.mjs <dmg> <arm64|x64>");
assert.ok(["arm64", "x64"].includes(arch), `Unsupported architecture: ${arch}`);
// macOS /var aliases /private/var; use the canonical path printed by mount.
const mount = await realpath(
  await mkdtemp(join(tmpdir(), "gastronomy-dmg-verify-")),
);
let attachAttempted = false;
let failure;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30000,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

try {
  attachAttempted = true;
  run("hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
    dmg,
  ]);
  const found = spawnSync(
    "find",
    [mount, "-maxdepth", "2", "-type", "d", "-name", "*.app", "-print"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(
    found.status,
    0,
    `Could not find application in mounted DMG: ${found.stderr}`,
  );
  const apps = found.stdout.trim().split("\n").filter(Boolean);
  assert.equal(
    apps.length,
    1,
    `Expected one .app in ${dmg}, found ${apps.length}`,
  );
  const app = apps[0];

  // Deep strict verification covers nested frameworks and the unpacked native addon.
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const signature = run("codesign", ["-dvv", app]);
  assert.match(
    signature,
    /Signature=adhoc/i,
    "The app root must carry an ad-hoc signature",
  );
  assert.doesNotMatch(
    signature,
    /Authority=Developer ID Application/i,
    "Unexpected Developer ID signature",
  );

  const addonResult = spawnSync(
    "find",
    [app, "-type", "f", "-name", "better_sqlite3.node", "-print"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(
    addonResult.status,
    0,
    `Could not find native SQLite addon: ${addonResult.stderr}`,
  );
  const addons = addonResult.stdout.trim().split("\n").filter(Boolean);
  assert.equal(
    addons.length,
    1,
    `Expected one unpacked better_sqlite3.node, found ${addons.length}`,
  );
  const addon = addons[0];
  run("codesign", ["--verify", "--strict", "--verbose=2", addon]);
  run("lipo", ["-verify_arch", arch === "arm64" ? "arm64" : "x86_64", addon]);

  const resources = join(app, "Contents", "Resources");
  const asar = join(resources, "app.asar");
  run(process.execPath, [
    fileURLToPath(new URL("./verify-macos-license.mjs", import.meta.url)),
    asar,
  ]);
  // Launch the exact mounted artifact with an isolated profile. Probe the real
  // renderer/preload/IPC and only read license state; never activate/refresh it.
  run(
    process.execPath,
    [
      fileURLToPath(new URL("./smoke-macos-app.mjs", import.meta.url)),
      join(app, "Contents", "MacOS", basename(app, ".app")),
    ],
    {
      env: { ...process.env, GASTRONOMY_SMOKE_PROFILE_ROOT: tmpdir() },
      timeout: 120000,
    },
  );
  console.log(
    `Verified DMG app signature, SQLite addon (${arch}), packaged licensing config, and isolated runtime smoke: ${dmg}`,
  );
} catch (error) {
  failure = error;
} finally {
  if (attachAttempted) {
    const mounted = spawnSync("mount", [], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (mounted.status !== 0) {
      failure ??= new Error(
        `Could not check mounted volumes before cleanup: ${mounted.stderr}`,
      );
    } else if (mounted.stdout.includes(` on ${mount} (`)) {
      const detach = spawnSync("hdiutil", ["detach", mount, "-quiet"], {
        encoding: "utf8",
        timeout: 30000,
      });
      if (detach.status !== 0) {
        // Keep the mount directory intact when detach fails; deleting it could
        // obscure a still-mounted volume and make cleanup less safe.
        failure ??= new Error(
          `Failed to detach verification mount ${mount}: ${detach.stderr}`,
        );
      } else {
        await rm(mount, { recursive: true, force: true });
      }
    } else {
      await rm(mount, { recursive: true, force: true });
    }
  } else {
    await rm(mount, { recursive: true, force: true });
  }
}
if (failure) throw failure;
