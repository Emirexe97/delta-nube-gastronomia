import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { win32 } from "node:path";

const MAX_INSTALLER_BYTES = 1024 ** 3;

type LaunchInput = {
  installerPath: string;
  size: number;
  sha512: string;
  expiresAtMs: number;
};

// Each existing component is opened without following its last reparse point
// and held without write/delete sharing. A lock on the leaf alone would not
// protect the path used by CreateProcess from an ancestor rename.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Microsoft.PowerShell.Utility\Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class DeltaNubeVerifiedLaunch {
  private const uint GenericRead = 0x80000000;
  // Metadata-only opens do not participate in NT sharing and permit a rename.
  private const uint FileListDirectory = 0x01;
  private const uint FileReadAttributes = 0x80;
  private const uint ShareRead = 1;
  private const uint OpenExisting = 3;
  private const uint BackupSemantics = 0x02000000;
  private const uint OpenReparsePoint = 0x00200000;
  private const int FileAttributeTagInfo = 9;

  [StructLayout(LayoutKind.Sequential)]
  private struct AttributeTag {
    public FileAttributes Attributes;
    public uint ReparseTag;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  private static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
    IntPtr security, uint disposition, uint flags, IntPtr template);

  [DllImport("kernel32.dll", ExactSpelling = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle,
    int infoClass, out AttributeTag info, uint size);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
    StringBuilder path, uint capacity, uint flags);

  private static bool IsExpectedHandle(SafeFileHandle handle, string path, bool directory) {
    AttributeTag info;
    if (handle.IsInvalid || !GetFileInformationByHandleEx(handle, FileAttributeTagInfo,
      out info, (uint)Marshal.SizeOf(typeof(AttributeTag)))) return false;
    if ((info.Attributes & FileAttributes.ReparsePoint) != 0 ||
      ((info.Attributes & FileAttributes.Directory) != 0) != directory) return false;
    var finalName = new StringBuilder(32768);
    uint length = GetFinalPathNameByHandleW(handle, finalName, (uint)finalName.Capacity, 0);
    return length > 0 && length < (uint)finalName.Capacity &&
      String.Equals(finalName.ToString(), @"\\?\" + path, StringComparison.OrdinalIgnoreCase);
  }

  public static int Run(string path, string sizeText, string hash, string deadlineText) {
    var handles = new List<SafeFileHandle>();
    bool started = false;
    try {
      long size = Int64.Parse(sizeText, NumberStyles.None, CultureInfo.InvariantCulture);
      long deadline = Int64.Parse(deadlineText, NumberStyles.None, CultureInfo.InvariantCulture);
      string root = Path.GetPathRoot(path);
      if (root == null || root.Length != 3 || root[1] != ':' ||
        new DriveInfo(root).DriveType != DriveType.Fixed) return 10;
      string[] parts = path.Substring(root.Length).Split('\\');
      string current = root;
      for (int index = -1; index < parts.Length; index++) {
        if (index >= 0) current = Path.Combine(current, parts[index]);
        bool directory = index < parts.Length - 1;
        var handle = CreateFileW(current, directory ? FileListDirectory | FileReadAttributes : GenericRead,
          ShareRead, IntPtr.Zero, OpenExisting,
          OpenReparsePoint | (directory ? BackupSemantics : 0u), IntPtr.Zero);
        handles.Add(handle);
        if (!IsExpectedHandle(handle, current, directory)) return 10;
      }

      // Wrap the very same read-only, OPEN_EXISTING, FILE_SHARE_READ handle.
      using (var stream = new FileStream(handles[handles.Count - 1], FileAccess.Read))
      using (var sha = SHA512.Create()) {
        if (stream.Length != size) return 11;
        string digest = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        if (!String.Equals(digest, hash, StringComparison.OrdinalIgnoreCase)) return 12;
        var start = new ProcessStartInfo(path, "--updated --force-run");
        start.UseShellExecute = false;
        start.WorkingDirectory = Environment.SystemDirectory;
        start.EnvironmentVariables.Remove("DN_UPDATE_PATH");
        start.EnvironmentVariables.Remove("DN_UPDATE_SIZE");
        start.EnvironmentVariables.Remove("DN_UPDATE_SHA512");
        start.EnvironmentVariables.Remove("DN_UPDATE_EXPIRES");
        if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= deadline) return 13;
        using (var child = Process.Start(start)) {
          if (child == null) return 14;
          started = true;
        }
      }
      return 0;
    } catch {
      // Do not return a failure that could cause a retry after CreateProcess succeeded.
      return started ? 0 : 14;
    } finally {
      for (int index = handles.Count - 1; index >= 0; index--) handles[index].Dispose();
    }
  }
}
'@
  exit ([DeltaNubeVerifiedLaunch]::Run(
    $env:DN_UPDATE_PATH, $env:DN_UPDATE_SIZE, $env:DN_UPDATE_SHA512, $env:DN_UPDATE_EXPIRES))
} catch {
  exit 15
}
`;

const ENCODED_SCRIPT = Buffer.from(SCRIPT, "utf16le").toString("base64");
const EXIT_REASON: Record<number, string> = {
  10: "PATH",
  11: "SIZE",
  12: "HASH",
  13: "EXPIRED",
  14: "START",
  15: "HELPER",
};

function failure(reason: string): Error {
  return new Error(`Windows verified installer launch failed: ${reason}`);
}

function isOrdinaryDrivePath(path: string): boolean {
  return (
    /^[a-z]:\\[^\\]/i.test(path) &&
    !/[\u0000-\u001f<>:"/|?*]/.test(path.slice(2)) &&
    path
      .slice(3)
      .split("\\")
      .every(
        (part) =>
          part.length > 0 &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(?:\.|$)/i.test(part),
      )
  );
}

/** Accepts an already authenticated Windows installer identity, not feed data. */
export async function launchVerifiedWindowsInstaller(
  input: LaunchInput,
): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw failure("PLATFORM");
  if (
    !isOrdinaryDrivePath(input.installerPath) ||
    !/\.exe$/i.test(input.installerPath) ||
    input.installerPath.length > 259
  )
    throw failure("PATH");
  if (
    !Number.isSafeInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_INSTALLER_BYTES ||
    !/^[0-9a-f]{128}$/.test(input.sha512) ||
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.expiresAtMs <= 0
  )
    throw failure("INPUT");

  const systemRoot = process.env.SystemRoot ?? "";
  const temp = tmpdir();
  if (!isOrdinaryDrivePath(systemRoot) || !isOrdinaryDrivePath(temp))
    throw failure("HELPER");
  const systemDirectory = win32.join(systemRoot, "System32");
  const powershell = win32.join(systemDirectory, "WindowsPowerShell", "v1.0");
  const env: NodeJS.ProcessEnv = {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    TEMP: temp,
    TMP: temp,
    PATH: systemDirectory,
    PSModulePath: win32.join(powershell, "Modules"),
    DN_UPDATE_PATH: input.installerPath,
    DN_UPDATE_SIZE: String(input.size),
    DN_UPDATE_SHA512: input.sha512,
    DN_UPDATE_EXPIRES: String(input.expiresAtMs),
  };

  // Keep ordinary profile folders available to the installer/restarted app,
  // without inheriting arbitrary PowerShell, .NET or DLL-search settings.
  for (const name of [
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "ProgramData",
    "ALLUSERSPROFILE",
  ]) {
    const value = process.env[name];
    if (value !== undefined && isOrdinaryDrivePath(value)) env[name] = value;
  }

  await new Promise<void>((resolve, reject) => {
    const launcher = spawn(
      win32.join(powershell, "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        ENCODED_SCRIPT,
      ],
      {
        cwd: systemDirectory,
        shell: false,
        windowsHide: true,
        stdio: "ignore",
        env,
      },
    );
    launcher.once("error", () => reject(failure("HELPER")));
    launcher.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          failure(code === null ? "HELPER" : (EXIT_REASON[code] ?? "HELPER")),
        );
    });
  });
}
