import { EventEmitter } from "node:events";
import { open } from "node:fs/promises";
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import type { UpdateAdapter } from "./app-updater.ts";
import {
  verifyWindowsUpdateEnvelope,
  verifyWindowsUpdateArtifact,
  WindowsUpdateVerificationError,
  // @ts-expect-error Node runs TypeScript test sources directly.
} from "./windows-signed-update.ts";
import type {
  VerifiedWindowsRelease,
  WindowsVerificationContext,
  WindowsUpdateChannel,
} from "./windows-signed-update.ts";
// @ts-expect-error Node runs TypeScript test sources directly.
import { WindowsUpdateStorage } from "./windows-update-storage.ts";
import type { WindowsUpdateStage } from "./windows-update-storage.ts";

type Request = (url: URL, signal: AbortSignal) => Promise<IncomingMessage>;
type Launcher = (input: {
  installerPath: string;
  size: number;
  sha512: string;
  expiresAtMs: number;
}) => Promise<void>;
type Options = {
  feedUrl: string;
  userDataPath: string;
  installedVersion: string;
  channel?: WindowsUpdateChannel;
  trustedKeys: WindowsVerificationContext["trustedKeys"];
  launch: Launcher;
  onLaunched: () => void;
  /** Dependency injection only; the production factory never supplies overrides. */
  request?: Request;
  now?: () => number;
};
type Pending = Readonly<{ envelope: Buffer; release: VerifiedWindowsRelease }>;

const MANIFEST_LIMIT = 64 * 1024;
const MANIFEST_TIMEOUT_MS = 20_000;
const ARTIFACT_TIMEOUT_MS = 15 * 60_000;

/** Direct HTTPS, no ambient cookies/proxy/auth, redirects or TLS exceptions. */
export function requestWindowsUpdate(
  url: URL,
  signal: AbortSignal,
  ca?: Buffer,
): Promise<IncomingMessage> {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return Promise.reject(new Error("Invalid update URL"));
  return new Promise((resolve, reject) => {
    get(
      url,
      {
        signal,
        ca,
        agent: false,
        rejectUnauthorized: true,
        headers: { "Accept-Encoding": "identity" },
      },
      resolve,
    ).once("error", reject);
  });
}

function requireByteResponse(
  response: IncomingMessage,
  max: number,
  exactSize?: number,
) {
  if (
    response.statusCode !== 200 ||
    (response.headers["content-encoding"] &&
      response.headers["content-encoding"] !== "identity") ||
    response.headers["content-range"]
  )
    throw new Error("Invalid update response");
  const length = response.headers["content-length"];
  if (
    length !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(length) ||
      Number(length) > max ||
      (exactSize !== undefined && Number(length) !== exactSize))
  )
    throw new Error("Invalid update content length");
}

export class WindowsSignedUpdateAdapter
  extends EventEmitter
  implements UpdateAdapter
{
  private readonly base: URL;
  private readonly options: Options;
  private readonly storage: WindowsUpdateStorage;
  private readonly cancellation = new AbortController();
  private pending: Pending | null = null;
  private ready: { pending: Pending; stage: WindowsUpdateStage } | null = null;

  constructor(options: Options) {
    super();
    this.options = options;
    this.base = new URL(options.feedUrl);
    if (
      this.base.protocol !== "https:" ||
      this.base.username ||
      this.base.password ||
      this.base.hash ||
      this.base.search ||
      !this.base.pathname.endsWith("/") ||
      !options.trustedKeys.size
    )
      throw new Error("Invalid signed update configuration");
    this.storage = new WindowsUpdateStorage(
      options.userDataPath,
      options.channel,
    );
  }

  async checkForUpdates(): Promise<void> {
    this.cancellation.signal.throwIfAborted();
    this.pending = null;
    const lastAccepted = await this.storage.loadCheckpoint();
    const response = await this.request("release.json", MANIFEST_TIMEOUT_MS);
    try {
      if (response.statusCode === 404) {
        this.emit("update-not-available");
        return;
      }
      requireByteResponse(response, MANIFEST_LIMIT);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MANIFEST_LIMIT) throw new Error("Update manifest too large");
        chunks.push(chunk);
      }
      const envelope = Buffer.concat(chunks, size);
      let release: VerifiedWindowsRelease;
      try {
        release = this.verify(envelope, lastAccepted);
      } catch (error) {
        if (
          error instanceof WindowsUpdateVerificationError &&
          error.code === "CURRENT"
        ) {
          this.emit("update-not-available");
          return;
        }
        throw error;
      }
      await this.storage.writeCheckpoint(release.checkpoint);
      this.cancellation.signal.throwIfAborted();
      this.pending = { envelope, release };
      this.emit("update-available", { version: release.checkpoint.version });
    } finally {
      response.destroy();
    }
  }

  async downloadUpdate(): Promise<void> {
    const pending = this.pending;
    // One immutable snapshot; neither a second manifest fetch nor a cache reuse.
    this.pending = null;
    if (!pending) throw new Error("No authorized Windows release");
    const { release } = pending;
    const stage = await this.storage.makeStage();
    try {
      const response = await this.request(
        release.artifactPath,
        ARTIFACT_TIMEOUT_MS,
      );
      try {
        requireByteResponse(
          response,
          release.artifactSize,
          release.artifactSize,
        );
        const file = await open(stage.installerPath, "wx", 0o600);
        try {
          let size = 0;
          const onProgress = (percent: number) =>
            this.emit("download-progress", { percent });
          async function* writeAndHash() {
            let lastPercent = -1;
            for await (const chunk of response as AsyncIterable<Buffer>) {
              size += chunk.length;
              if (size > release.artifactSize)
                throw new Error("Oversized update artifact");
              await file.writeFile(chunk);
              const percent = Math.min(
                99,
                Math.floor((100 * size) / release.artifactSize),
              );
              if (percent !== lastPercent) onProgress((lastPercent = percent));
              yield chunk;
            }
          }
          await verifyWindowsUpdateArtifact(release, writeAndHash());
          await file.sync();
        } finally {
          await file.close();
        }
      } finally {
        response.destroy();
      }
      this.cancellation.signal.throwIfAborted();
      if ((this.options.now ?? Date.now)() >= release.expiresAtMs)
        throw new Error("Update expired");
      this.ready = { pending, stage };
      this.emit("update-downloaded", { version: release.checkpoint.version });
    } catch (error) {
      await this.storage.discardStage(stage);
      throw error;
    }
  }

  async quitAndInstall(): Promise<void> {
    const ready = this.ready;
    if (!ready) throw new Error("No verified Windows artifact");
    this.ready = null;
    try {
      const lastAccepted = await this.storage.loadCheckpoint();
      if (
        !lastAccepted ||
        lastAccepted.sequence !== ready.pending.release.checkpoint.sequence ||
        lastAccepted.payloadSha256 !==
          ready.pending.release.checkpoint.payloadSha256
      )
        throw new Error("Update checkpoint changed");
      const release = this.verify(ready.pending.envelope, lastAccepted);
      await this.storage.writeCheckpoint(release.checkpoint);
      this.cancellation.signal.throwIfAborted();
      // The Windows launcher verifies the exact file under a lock through process creation.
      await this.options.launch({
        installerPath: ready.stage.installerPath,
        size: release.artifactSize,
        sha512: release.artifactSha512,
        expiresAtMs: release.expiresAtMs,
      });
    } catch (error) {
      await this.storage.discardStage(ready.stage);
      throw error;
    }
    // A successful process may still need its source file. No delete on process launch.
    this.options.onLaunched();
  }

  dispose() {
    this.cancellation.abort();
    const ready = this.ready;
    this.ready = null;
    this.pending = null;
    if (ready) void this.storage.discardStage(ready.stage);
  }

  private verify(
    envelope: Buffer,
    lastAccepted: WindowsVerificationContext["lastAccepted"],
  ) {
    return verifyWindowsUpdateEnvelope(envelope, {
      trustedKeys: this.options.trustedKeys,
      installedVersion: this.options.installedVersion,
      channel: this.options.channel,
      nowMs: (this.options.now ?? Date.now)(),
      lastAccepted,
    });
  }

  private request(path: string, timeout: number) {
    return (this.options.request ?? requestWindowsUpdate)(
      new URL(path, this.base),
      AbortSignal.any([this.cancellation.signal, AbortSignal.timeout(timeout)]),
    );
  }
}
