import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { DesktopUpdater, validateUpdaterConfig } from "./app-updater.ts";

class FakeAdapter extends EventEmitter {
  checkCalls = 0;
  downloadCalls = 0;
  installCalls = 0;
  checkFailure: Error | null = null;
  downloadFailure: Error | null = null;
  checkForUpdates(): Promise<unknown> {
    this.checkCalls++;
    return this.checkFailure
      ? Promise.reject(this.checkFailure)
      : Promise.resolve(undefined);
  }
  downloadUpdate(): Promise<unknown> {
    this.downloadCalls++;
    return this.downloadFailure
      ? Promise.reject(this.downloadFailure)
      : Promise.resolve(undefined);
  }
  quitAndInstall() {
    this.installCalls++;
  }
}

test("disabled updater reports a safe disabled status", () => {
  const updater = new DesktopUpdater({
    currentVersion: "1.2.3",
    adapter: null,
    disabledReason: "No compatible build.",
  });
  assert.deepEqual(updater.getStatus(), {
    state: "DISABLED",
    currentVersion: "1.2.3",
    availableVersion: null,
    progress: null,
    message: "No compatible build.",
  });
  assert.equal(updater.install().state, "DISABLED");
});

test("config accepts a clean HTTPS feed and rejects insecure or decorated URLs and unsupported targets", () => {
  assert.deepEqual(
    validateUpdaterConfig(
      { enabled: true, target: "win32-x64", feedUrl: "https://updates.example.com/releases" },
      "win32",
      "x64",
    ),
    { enabled: true, feedUrl: "https://updates.example.com/releases" },
  );
  for (const feedUrl of [
    "http://updates.example.com",
    "https://user:pass@updates.example.com",
    "https://updates.example.com/path?token=x",
    "https://updates.example.com/#frag",
    "not a url",
  ]) {
    assert.equal(
      validateUpdaterConfig({ enabled: true, target: "darwin-arm64", feedUrl }, "darwin", "arm64")
        .enabled,
      false,
      feedUrl,
    );
  }
  assert.equal(
    validateUpdaterConfig(
      { enabled: true, target: "win32-x64", feedUrl: "https://updates.example.com" },
      "linux",
      "x64",
    ).enabled,
    false,
  );
  assert.equal(
    validateUpdaterConfig(
      { enabled: true, target: "win32-x64", feedUrl: "https://updates.example.com" },
      "win32",
      "ia32",
    ).enabled,
    false,
  );
  assert.equal(
    validateUpdaterConfig(
      { enabled: true, target: "darwin-arm64", feedUrl: "https://updates.example.com/stable/darwin/arm64" },
      "win32",
      "x64",
    ).enabled,
    false,
    "a macOS arm64 feed must not be reused by Windows x64",
  );
  assert.equal(
    validateUpdaterConfig(
      { enabled: true, feedUrl: "https://updates.example.com" },
      "win32",
      "x64",
    ).enabled,
    false,
    "target must be explicit",
  );
});

test("only a newer stable version is approved and downloaded; progress is clamped", async () => {
  const adapter = new FakeAdapter();
  const updater = new DesktopUpdater({ currentVersion: "1.2.3", adapter });
  const check = updater.check();
  adapter.emit("update-available", { version: "2.0.0-beta.1" });
  adapter.emit("update-available", { version: "9007199254740992.0.0" });
  adapter.emit("update-available", { version: "1.2.2" });
  adapter.emit("update-available", { version: "1.2.3" });
  assert.equal(adapter.downloadCalls, 0);
  adapter.emit("update-available", { version: "1.2.4" });
  assert.equal(adapter.downloadCalls, 1);
  adapter.emit("download-progress", { percent: 130 });
  assert.equal(updater.getStatus().progress, 100);
  adapter.emit("download-progress", { percent: -4 });
  assert.equal(updater.getStatus().progress, 0);
  adapter.emit("update-downloaded", { version: "9.9.9" });
  assert.equal(updater.getStatus().state, "DOWNLOADING");
  adapter.emit("update-downloaded", { version: "1.2.4" });
  assert.equal(updater.getStatus().state, "READY");
  await check;
  assert.equal(updater.getStatus().state, "READY");
});

test("check errors are sanitized and a later retry works", async () => {
  const adapter = new FakeAdapter();
  const updater = new DesktopUpdater({ currentVersion: "1.0.0", adapter });
  adapter.checkFailure = new Error("https://private.example/token?secret=1");
  await updater.check();
  assert.equal(updater.getStatus().state, "ERROR");
  assert.doesNotMatch(updater.getStatus().message, /https|private|secret/);
  adapter.checkFailure = null;
  await updater.check();
  assert.equal(updater.getStatus().state, "CURRENT");
  assert.equal(adapter.checkCalls, 2);
});

test("download failures are sanitized and do not poison retry; unexpected events cannot regress state", async () => {
  const adapter = new FakeAdapter();
  const updater = new DesktopUpdater({ currentVersion: "1.0.0", adapter });
  const checking = updater.check();
  adapter.downloadFailure = new Error(
    "remote stack trace at https://host/path",
  );
  adapter.emit("update-available", { version: "1.1.0" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.getStatus().state, "ERROR");
  assert.doesNotMatch(updater.getStatus().message, /https|stack/);
  adapter.emit("update-downloaded", { version: "1.1.0" });
  assert.equal(updater.getStatus().state, "ERROR");
  adapter.downloadFailure = null;
  const retry = updater.check();
  adapter.emit("update-available", { version: "1.2.0" });
  assert.equal(adapter.downloadCalls, 2);
  adapter.emit("update-downloaded", { version: "1.2.0" });
  assert.equal(updater.getStatus().state, "READY");
  await retry;
  await checking;
});

test("install is only permitted from READY and install errors surface as ERROR", async () => {
  const adapter = new FakeAdapter();
  const updater = new DesktopUpdater({ currentVersion: "1.0.0", adapter });
  assert.equal(updater.install().state, "IDLE");
  assert.equal(adapter.installCalls, 0);
  const checking = updater.check();
  adapter.emit("update-available", { version: "1.1.0" });
  adapter.emit("update-downloaded", { version: "1.1.0" });
  await checking;
  assert.equal(updater.install().state, "INSTALLING");
  assert.equal(adapter.installCalls, 1);
  const throwing = new FakeAdapter();
  throwing.quitAndInstall = () => {
    throw new Error("sensitive details");
  };
  const failed = new DesktopUpdater({
    currentVersion: "1.0.0",
    adapter: throwing,
  });
  const check = failed.check();
  throwing.emit("update-available", { version: "1.1.0" });
  throwing.emit("update-downloaded", { version: "1.1.0" });
  await check;
  assert.equal(failed.install().state, "ERROR");
  assert.doesNotMatch(failed.getStatus().message, /sensitive/);
});

test("duplicate checks are bounded and dispose ignores later events", async () => {
  const adapter = new FakeAdapter();
  let resolveCheck!: () => void;
  adapter.checkForUpdates = () =>
    new Promise<void>((resolve) => {
      adapter.checkCalls++;
      resolveCheck = resolve;
    });
  const updater = new DesktopUpdater({ currentVersion: "1.0.0", adapter });
  const first = updater.check();
  await updater.check();
  assert.equal(adapter.checkCalls, 1);
  updater.dispose();
  adapter.emit("update-available", { version: "2.0.0" });
  resolveCheck();
  await first;
  assert.equal(updater.getStatus().state, "CHECKING");
});

test("a download error event blocks retry until its download promise settles and stale events stay ignored", async () => {
  const adapter = new FakeAdapter();
  let rejectDownload!: (error: Error) => void;
  adapter.downloadUpdate = () => {
    adapter.downloadCalls++;
    return new Promise((_, reject) => {
      rejectDownload = reject;
    });
  };
  const updater = new DesktopUpdater({ currentVersion: "1.0.0", adapter });
  const firstCheck = updater.check();
  adapter.emit("update-available", { version: "1.1.0" });
  adapter.emit("error", new Error("network failure"));
  assert.equal(updater.getStatus().state, "ERROR");
  await updater.check();
  assert.equal(adapter.checkCalls, 1);
  adapter.emit("update-downloaded", { version: "1.1.0" });
  assert.equal(updater.getStatus().state, "ERROR");
  rejectDownload(new Error("late rejection"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.getStatus().state, "ERROR");
  const retry = updater.check();
  adapter.emit("update-available", { version: "1.2.0" });
  assert.equal(adapter.downloadCalls, 2);
  adapter.emit("update-downloaded", { version: "1.2.0" });
  await retry;
  await firstCheck;
  assert.equal(updater.getStatus().state, "READY");
});

test("a late download rejection cannot overwrite READY after a downloaded event", async () => {
  const adapter = new FakeAdapter();
  let rejectDownload!: (error: Error) => void;
  adapter.downloadUpdate = () => {
    adapter.downloadCalls++;
    return new Promise((_, reject) => {
      rejectDownload = reject;
    });
  };
  const updater = new DesktopUpdater({ currentVersion: "1.0.0", adapter });
  const check = updater.check();
  adapter.emit("update-available", { version: "1.1.0" });
  adapter.emit("update-downloaded", { version: "1.1.0" });
  await check;
  assert.equal(updater.getStatus().state, "READY");
  rejectDownload(new Error("late failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.getStatus().state, "READY");
});
