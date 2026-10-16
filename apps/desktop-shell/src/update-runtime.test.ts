import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import * as runtime from "./update-runtime.ts";
import type { RuntimeDependencies } from "./update-runtime.ts";
import type { UpdateAdapter } from "./app-updater.ts";
const { configureSafeUpdaterOptions, createGenericProviderOptions, createUpdateRuntime, protectMacInstall } = runtime;

const options = (overrides: Record<string, unknown> = {}) => ({
  isPackaged: true,
  platform: "win32" as NodeJS.Platform,
  arch: "x64",
  currentVersion: "0.1.24",
  configPath: "/test/updater-config.json",
  resourcesPath: "/test/resources",
  appPath: "/test/app",
  ...overrides,
});

function deps({
  config = {
    enabled: true,
    target: "win32-x64",
    feedUrl: "https://updates.example.com/feed",
    windowsPublisherNames: ["Delta Nube LLC"],
  },
  updateYml = "provider: generic\nurl: https://updates.example.com/feed\npublisherName: Delta Nube LLC\n",
  signature = {
    valid: true,
    authority: "Developer ID Application: Delta Nube LLC (ABCDEFGHIJ)",
    teamId: "ABCDEFGHIJ",
  },
  createAdapter,
}: {
  config?: unknown;
  updateYml?: string;
  signature?: {
    valid: boolean;
    authority: string | null;
    teamId: string | null;
  };
  createAdapter?: RuntimeDependencies["createAdapter"];
} = {}) {
  const adapter = {
    on() {},
    checkForUpdates: async () => undefined,
    downloadUpdate: async () => undefined,
    quitAndInstall() {},
  };
  const calls: string[] = [];
  return {
    calls,
    deps: {
      readText: async (path: string) => {
        calls.push(path);
        if (path.endsWith("updater-config.json")) return JSON.stringify(config);
        if (path.endsWith("app-update.yml")) return updateYml;
        throw new Error("unexpected file");
      },
      verifyMacSignature: async () => signature,
      createAdapter: async (
        ...args: Parameters<RuntimeDependencies["createAdapter"]>
      ) => {
        calls.push("createAdapter");
        return createAdapter ? createAdapter(...args) : adapter;
      },
    } satisfies RuntimeDependencies,
  };
}

test("unpackaged build stays disabled and does not read config or initialize updater", async () => {
  const fixture = deps();
  const updater = await createUpdateRuntime(
    options({ isPackaged: false }),
    fixture.deps,
  );
  assert.equal(updater.getStatus().state, "DISABLED");
  assert.deepEqual(fixture.calls, []);
});

test("Windows updater requires publisherName metadata matching explicit expected publishers", async () => {
  for (const updateYml of [
    "provider: generic\n",
    "provider: generic\npublisherName: Other Inc\n",
    "not: [valid",
  ]) {
    const fixture = deps({ updateYml });
    const updater = await createUpdateRuntime(options(), fixture.deps);
    assert.equal(updater.getStatus().state, "DISABLED");
    assert.ok(!fixture.calls.includes("createAdapter"));
  }
});

test("valid Windows config and publisher metadata enable adapter", async () => {
  const fixture = deps();
  const updater = await createUpdateRuntime(options(), fixture.deps);
  assert.equal(updater.getStatus().state, "IDLE");
  assert.ok(fixture.calls.includes("createAdapter"));
});

test("macOS updater requires allowed architecture, Developer ID authority, and exact team id", async () => {
  const config = {
    enabled: true,
    target: "darwin-arm64",
    feedUrl: "https://updates.example.com/feed",
    macTeamId: "ABCDEFGHIJ",
  };
  for (const signature of [
    { valid: true, authority: "adhoc", teamId: null },
    {
      valid: true,
      authority: "Developer ID Application: Someone Else",
      teamId: "ZZZZZZZZZZ",
    },
    {
      valid: false,
      authority: "Developer ID Application: Delta Nube",
      teamId: "ABCDEFGHIJ",
    },
  ]) {
    const fixture = deps({ config, signature });
    const updater = await createUpdateRuntime(
      options({ platform: "darwin", arch: "arm64" }),
      fixture.deps,
    );
    assert.equal(updater.getStatus().state, "DISABLED");
    assert.ok(!fixture.calls.includes("createAdapter"));
  }
  const unsupported = deps({ config });
  assert.equal(
    (
      await createUpdateRuntime(
        options({ platform: "darwin", arch: "ia32" }),
        unsupported.deps,
      )
    ).getStatus().state,
    "DISABLED",
  );
  assert.ok(!unsupported.calls.includes("createAdapter"));
});

test("bad HTTPS feed and absent macOS team config fail closed", async () => {
  const unsafe = deps({
    config: {
      enabled: true,
      target: "win32-x64",
      feedUrl: "https://user:pass@updates.example.com/feed",
      windowsPublisherNames: ["Delta Nube LLC"],
    },
  });
  assert.equal(
    (await createUpdateRuntime(options(), unsafe.deps)).getStatus().state,
    "DISABLED",
  );
  const noTeam = deps({
    config: { enabled: true, target: "darwin-arm64", feedUrl: "https://updates.example.com/feed" },
  });
  assert.equal(
    (
      await createUpdateRuntime(
        options({ platform: "darwin", arch: "arm64" }),
        noTeam.deps,
      )
    ).getStatus().state,
    "DISABLED",
  );
});

test("a feed explicitly bound to macOS arm64 is never reused by Windows x64", async () => {
  const fixture = deps({
    config: {
      enabled: true,
      target: "darwin-arm64",
      feedUrl: "https://updates.example.com/stable/darwin/arm64",
      windowsPublisherNames: ["Delta Nube LLC"],
    },
  });
  const updater = await createUpdateRuntime(options(), fixture.deps);
  assert.equal(updater.getStatus().state, "DISABLED");
  assert.match(updater.getStatus().message, /plataforma y arquitectura/i);
  assert.ok(!fixture.calls.includes("createAdapter"));
});

test("adapter initialization failure returns a recoverable disabled updater", async () => {
  const fixture = deps({
    createAdapter: async () => {
      throw new Error("network or runtime issue");
    },
  });
  const updater = await createUpdateRuntime(options(), fixture.deps);
  assert.equal(updater.getStatus().state, "DISABLED");
  assert.match(updater.getStatus().message, /inicializar/i);
});

test("generic updater uses HTTPS feed options with background install and downgrade disabled", () => {
  assert.deepEqual(
    createGenericProviderOptions("https://updates.example.com/feed"),
    {
      provider: "generic",
      url: "https://updates.example.com/feed",
    },
  );
  const options = configureSafeUpdaterOptions({});
  assert.deepEqual(options, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    allowPrerelease: false,
    disableWebInstaller: true,
    logger: null,
  });
});

test("macOS synchronous install error removes only its new native quit listener", () => {
  const native = new EventEmitter();
  const preexisting = () => undefined;
  native.on("update-downloaded", preexisting);
  const adapter = new EventEmitter() as EventEmitter & {
    quitAndInstall(): void;
  };
  adapter.quitAndInstall = () => {
    native.on("update-downloaded", () => {
      throw new Error("must not quit after failed install");
    });
    adapter.emit("error", new Error("synchronous install failure"));
  };
  const safe = protectMacInstall(adapter as unknown as UpdateAdapter, native);
  safe.quitAndInstall();
  assert.deepEqual(native.listeners("update-downloaded"), [preexisting]);
  assert.doesNotThrow(() => native.emit("update-downloaded"));
});

test("macOS asynchronous install error removes pending listener and preserves baseline listeners", () => {
  const native = new EventEmitter();
  const preexisting = () => undefined;
  native.on("update-downloaded", preexisting);
  const adapter = new EventEmitter() as EventEmitter & {
    quitAndInstall(): void;
  };
  adapter.quitAndInstall = () =>
    native.on("update-downloaded", () => {
      throw new Error("must not quit after failed install");
    });
  const safe = protectMacInstall(adapter as unknown as UpdateAdapter, native);
  safe.quitAndInstall();
  assert.equal(native.listenerCount("update-downloaded"), 2);
  adapter.emit("error", new Error("asynchronous install failure"));
  assert.deepEqual(native.listeners("update-downloaded"), [preexisting]);
  assert.doesNotThrow(() => native.emit("update-downloaded"));
});

test("macOS synchronous throw removes listeners added by failed install call", () => {
  const native = new EventEmitter();
  const preexisting = () => undefined;
  native.on("update-downloaded", preexisting);
  const adapter = new EventEmitter() as EventEmitter & {
    quitAndInstall(): void;
  };
  adapter.quitAndInstall = () => {
    native.on("update-downloaded", () => {
      throw new Error("must not quit after failed install");
    });
    throw new Error("synchronous throw");
  };
  const safe = protectMacInstall(adapter as unknown as UpdateAdapter, native);
  assert.throws(() => safe.quitAndInstall(), /synchronous throw/);
  assert.deepEqual(native.listeners("update-downloaded"), [preexisting]);
});
