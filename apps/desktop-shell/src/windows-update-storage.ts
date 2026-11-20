import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error Node runs TypeScript test sources directly.
import { isAcceptedWindowsRelease } from "./windows-signed-update.ts";
import type {
  AcceptedWindowsRelease,
  WindowsUpdateChannel,
} from "./windows-signed-update.ts";

function hasCode(error: unknown, code: string) {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

export type WindowsUpdateStage = Readonly<{
  dir: string;
  installerPath: string;
}>;

/** Dedicated subtree of the profile. The desktop owns the profile's single-instance lock. */
export class WindowsUpdateStorage {
  private readonly root: string;
  private readonly checkpointPath: string;

  constructor(userDataPath: string, channel: WindowsUpdateChannel = "stable") {
    this.root = join(
      userDataPath,
      channel === "pilot"
        ? "windows-signed-updates-pilot-v1"
        : "windows-signed-updates-v1",
    );
    this.checkpointPath = join(this.root, "checkpoint.json");
  }

  async loadCheckpoint(): Promise<AcceptedWindowsRelease | null> {
    // A missing root is fresh; a missing checkpoint in an existing root is NOT.
    // Initialize once with a marker if this check succeeds; crash before it is fail-closed.
    let fresh = false;
    try {
      await mkdir(this.root, { mode: 0o700 });
      fresh = true;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    await this.assertDirectory();
    if (fresh) {
      await this.writeCheckpoint(null);
      return null;
    }
    const info = await lstat(this.checkpointPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 4096
    )
      throw new Error("Invalid update checkpoint file");
    const file = await open(this.checkpointPath, "r");
    try {
      const bytes = Buffer.alloc(4097);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (!bytesRead || bytesRead > 4096 || bytesRead !== info.size)
        throw new Error("Invalid update checkpoint size");
      const value: unknown = JSON.parse(
        bytes.subarray(0, bytesRead).toString("utf8"),
      );
      if (value !== null && !isAcceptedWindowsRelease(value))
        throw new Error("Invalid update checkpoint");
      return value;
    } finally {
      await file.close();
    }
  }

  async writeCheckpoint(
    checkpoint: AcceptedWindowsRelease | null,
  ): Promise<void> {
    await this.assertDirectory();
    const temp = join(this.root, `.checkpoint-${randomUUID()}.tmp`);
    const file = await open(temp, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(checkpoint), "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.checkpointPath);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  async makeStage(): Promise<WindowsUpdateStage> {
    await this.assertDirectory();
    const dir = await mkdtemp(join(this.root, "stage-"));
    return { dir, installerPath: join(dir, "installer.exe") };
  }

  async discardStage(stage: WindowsUpdateStage): Promise<void> {
    // Only known files of the current attempt, never a recursive deletion.
    try {
      const info = await lstat(stage.dir);
      if (!info.isDirectory() || info.isSymbolicLink()) return;
      await unlink(stage.installerPath).catch((error) => {
        if (!hasCode(error, "ENOENT")) throw error;
      });
      await rmdir(stage.dir);
    } catch {
      // A busy or missing stage cannot affect operation of the POS.
    }
  }

  private async assertDirectory() {
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid Windows update directory");
  }
}
