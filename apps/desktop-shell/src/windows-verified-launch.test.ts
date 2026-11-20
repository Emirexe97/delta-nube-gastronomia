import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
// @ts-expect-error Explicit TS source extension for the Node test runner.
import { launchVerifiedWindowsInstaller } from "./windows-verified-launch.ts";

const windowsX64 = process.platform === "win32" && process.arch === "x64";
const bytes = Buffer.from("Inert test bytes, not a Windows executable.");
const sha512 = createHash("sha512").update(bytes).digest("hex");
const zeroDigest = "0".repeat(128);

async function inertFixture(t: TestContext) {
  const base = await realpath(tmpdir());
  const root = await mkdtemp(join(base, "deltanube-launch-test-"));
  t.after(async () => {
    const resolved = await realpath(root);
    assert.equal(dirname(resolved), base);
    assert.match(basename(resolved), /^deltanube-launch-test-/);
    await rm(resolved, { recursive: true, force: true });
  });
  const dir = join(root, "caché [local] & 'literal'$");
  await mkdir(dir);
  const installerPath = join(dir, "installer.exe");
  await writeFile(installerPath, bytes);
  return {
    root,
    dir,
    input: {
      installerPath,
      size: bytes.length,
      sha512,
      expiresAtMs: Date.now() - 1,
    },
  };
}

test(
  "rejects the launch on unsupported process targets",
  { skip: windowsX64 },
  async () => {
    await assert.rejects(
      launchVerifiedWindowsInstaller({
        installerPath: "C:\\cache\\installer.exe",
        size: bytes.length,
        sha512,
        expiresAtMs: 1,
      }),
      /PLATFORM$/,
    );
  },
);

test(
  "rejects nonordinary Windows paths and invalid identity values",
  { skip: !windowsX64 },
  async () => {
    const input = {
      installerPath: "C:\\cache\\installer.exe",
      size: bytes.length,
      sha512,
      expiresAtMs: 1,
    };
    for (const installerPath of [
      "\\\\server\\share\\installer.exe",
      "\\\\?\\C:\\cache\\installer.exe",
      "C:installer.exe",
      "C:\\cache\\..\\installer.exe",
      "C:\\cache\\NUL.exe",
      "C:\\cache\\installer.exe:stream.exe",
      "C:\\cache\\installer.exe.exe ",
      "C:\\cache.\\installer.exe",
      "C:\\cache\\installer.cmd",
    ]) {
      await assert.rejects(
        launchVerifiedWindowsInstaller({ ...input, installerPath }),
        /PATH$/,
      );
    }
    for (const invalid of [
      { size: 0 },
      { size: 2 ** 30 + 1 },
      { sha512: "A".repeat(128) },
      { expiresAtMs: Number.POSITIVE_INFINITY },
    ]) {
      await assert.rejects(
        launchVerifiedWindowsInstaller({ ...input, ...invalid }),
        /INPUT$/,
      );
    }
  },
);

test(
  "real Windows helper checks held bytes and expiry and releases all handles",
  {
    skip: !windowsX64,
  },
  async (t) => {
    const { root, dir, input } = await inertFixture(t);
    await assert.rejects(
      launchVerifiedWindowsInstaller({ ...input, size: input.size + 1 }),
      /SIZE$/,
    );
    await assert.rejects(
      launchVerifiedWindowsInstaller({
        ...input,
        sha512: zeroDigest,
      }),
      /HASH$/,
    );
    // The matching digest and literal Unicode/metacharacter path reach the final expiry gate.
    await assert.rejects(launchVerifiedWindowsInstaller(input), /EXPIRED$/);
    await rename(input.installerPath, join(dir, "renamed.exe"));
    await rename(dir, join(root, "renamed-dir"));
  },
);

test(
  "real Windows helper rejects an ancestor junction and a final reparse point",
  {
    skip: !windowsX64,
  },
  async (t) => {
    const { root, dir, input } = await inertFixture(t);
    // Directory junctions do not require the Windows developer-mode symlink privilege.
    const alias = join(root, "alias");
    await symlink(dir, alias, "junction");
    await assert.rejects(
      launchVerifiedWindowsInstaller({
        ...input,
        installerPath: join(alias, "installer.exe"),
      }),
      /PATH$/,
    );
    const final = join(root, "alias.exe");
    await symlink(dir, final, "junction");
    await assert.rejects(
      launchVerifiedWindowsInstaller({
        ...input,
        installerPath: final,
      }),
      /PATH$/,
    );
  },
);

test(
  "real Windows helper cannot acquire its read-only lock while a writer is open",
  {
    skip: !windowsX64,
  },
  async (t) => {
    const { input } = await inertFixture(t);
    const writer = await open(input.installerPath, "r+");
    try {
      await assert.rejects(launchVerifiedWindowsInstaller(input), /PATH$/);
    } finally {
      await writer.close();
    }
    await assert.rejects(launchVerifiedWindowsInstaller(input), /EXPIRED$/);
  },
);

test(
  "real Windows helper requires a share-enforcing directory handle for each ancestor",
  {
    skip: !windowsX64,
  },
  async (t) => {
    const { root, input } = await inertFixture(t);
    // A preexisting DELETE handle conflicts with a real no-share-delete open, but
    // not with a metadata-only open (which Windows excludes from share checks).
    const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DirectoryDeleteHandle {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
    IntPtr security, uint disposition, uint flags, IntPtr template);
}
'@
$handle = [DirectoryDeleteHandle]::CreateFileW(
  $env:DN_TEST_ROOT, 0x10000, 7, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
try {
  if ($handle.IsInvalid) { exit 1 }
  [Console]::WriteLine('READY')
  [void][Console]::ReadLine()
} finally { $handle.Dispose() }
`;
    const systemRoot = process.env.SystemRoot!;
    const locker = spawn(
      join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          SystemRoot: systemRoot,
          DN_TEST_ROOT: root,
          TEMP: tmpdir(),
          TMP: tmpdir(),
        },
      },
    );
    const finished = once(locker, "exit");
    try {
      const state = await Promise.race([
        once(locker.stdout, "data").then(([bytes]) => String(bytes).trim()),
        finished.then(([code]) => `exit ${code}`),
      ]);
      assert.equal(state, "READY");
      await assert.rejects(launchVerifiedWindowsInstaller(input), /PATH$/);
    } finally {
      locker.stdin.end();
      await finished;
    }
    await assert.rejects(launchVerifiedWindowsInstaller(input), /EXPIRED$/);
  },
);
