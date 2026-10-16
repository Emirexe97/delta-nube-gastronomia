import { readFile } from "node:fs/promises";
import { load as parseYaml } from "js-yaml";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { AppUpdateStatusDto } from "@gastronomy/contracts";
// @ts-expect-error Node 24 direct TS test runner resolves explicit source extensions.
import { DesktopUpdater, validateUpdaterConfig } from "./app-updater.ts";
import type { UpdateAdapter } from "./app-updater.ts";

const execFile = promisify(execFileCallback);

export interface DesktopUpdaterRuntimeOptions {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  currentVersion: string;
  configPath: string;
  resourcesPath: string;
  appPath: string;
  onStatusChange?: (status: AppUpdateStatusDto) => void;
}

export interface RuntimeDependencies {
  readText(path: string): Promise<string>;
  verifyMacSignature(
    path: string,
  ): Promise<{
    authority: string | null;
    teamId: string | null;
    valid: boolean;
  }>;
  createAdapter(
    platform: "win32" | "darwin",
    feedUrl: string,
  ): Promise<UpdateAdapter>;
  protectMacInstall?(adapter: UpdateAdapter): UpdateAdapter;
}

function disabled(
  reason: string,
  currentVersion: string,
  onStatusChange?: (status: AppUpdateStatusDto) => void,
): DesktopUpdater {
  return new DesktopUpdater({
    currentVersion,
    adapter: null,
    disabledReason: reason,
    onStatusChange,
  });
}

function configFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parsePublisherNames(text: string): string[] {
  try {
    const parsed = parseYaml(text) as { publisherName?: unknown } | null;
    if (typeof parsed?.publisherName === "string")
      return [parsed.publisherName];
    if (
      Array.isArray(parsed?.publisherName) &&
      parsed.publisherName.every((value) => typeof value === "string")
    )
      return parsed.publisherName;
  } catch {
    /* malformed or ambiguous YAML disables verification */
  }
  return [];
}

async function defaultVerifyMacSignature(path: string) {
  try {
    await execFile("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      path,
    ]);
    const { stdout, stderr } = await execFile("/usr/bin/codesign", [
      "-dv",
      "--verbose=4",
      path,
    ]);
    const details = `${stdout}\n${stderr}`;
    const authority = details.match(/^Authority=(.+)$/m)?.[1]?.trim() ?? null;
    const teamId = details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null;
    return {
      valid: Boolean(
        authority?.startsWith("Developer ID Application:") &&
        teamId &&
        teamId !== "not set",
      ),
      authority,
      teamId,
    };
  } catch {
    return { valid: false, authority: null, teamId: null };
  }
}

async function defaultCreateAdapter(
  platform: "win32" | "darwin",
  feedUrl: string,
): Promise<UpdateAdapter> {
  // Avoid importing electron-updater in development/test contexts; packaged gating is done first.
  const updater = await import("electron-updater");
  const electron = platform === "darwin" ? await import("electron") : null;
  const options = createGenericProviderOptions(feedUrl);
  const adapter =
    platform === "win32"
      ? new updater.NsisUpdater(options)
      : new updater.MacUpdater(options);
  configureSafeUpdaterOptions(adapter);
  const typedAdapter = adapter as unknown as UpdateAdapter;
  return platform === "darwin"
    ? protectMacInstall(typedAdapter, electron!.autoUpdater)
    : typedAdapter;
}

export function createGenericProviderOptions(feedUrl: string) {
  return { provider: "generic", url: feedUrl } as const;
}

export function configureSafeUpdaterOptions<T extends object>(adapter: T): T {
  Object.assign(adapter, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: false,
    allowPrerelease: false,
    disableWebInstaller: true,
    logger: null,
  });
  return adapter;
}

/**
 * MacUpdater registers a native `update-downloaded` callback on every explicit
 * quitAndInstall call. If native installation errors, remove only the listener
 * added by that call so a later update event cannot unexpectedly quit the POS.
 */
export function protectMacInstall<T extends UpdateAdapter>(
  adapter: T,
  nativeUpdater: NodeJS.EventEmitter,
): T {
  let pendingInstallListeners: Function[] = [];
  let errorCleanupInstalled = false;
  let failedDuringCall = false;
  const cleanup = () => {
    for (const listener of pendingInstallListeners)
      nativeUpdater.removeListener(
        "update-downloaded",
        listener as (...args: any[]) => void,
      );
    pendingInstallListeners = [];
  };
  const originalQuitAndInstall = adapter.quitAndInstall.bind(adapter);
  adapter.quitAndInstall = () => {
    cleanup();
    failedDuringCall = false;
    const before = new Set(nativeUpdater.listeners("update-downloaded"));
    if (!errorCleanupInstalled) {
      const prepend = (
        adapter as unknown as {
          prependListener?: (
            event: string,
            listener: (...args: any[]) => void,
          ) => unknown;
        }
      ).prependListener;
      const onError = () => {
        failedDuringCall = true;
        cleanup();
      };
      if (prepend) prepend.call(adapter, "error", onError);
      else adapter.on("error", onError);
      errorCleanupInstalled = true;
    }
    try {
      originalQuitAndInstall();
      pendingInstallListeners = nativeUpdater
        .listeners("update-downloaded")
        .filter((listener) => !before.has(listener));
      if (failedDuringCall) cleanup();
    } catch (error) {
      const added = nativeUpdater
        .listeners("update-downloaded")
        .filter((listener) => !before.has(listener));
      for (const listener of added)
        nativeUpdater.removeListener(
          "update-downloaded",
          listener as (...args: any[]) => void,
        );
      pendingInstallListeners = [];
      throw error;
    }
  };
  return adapter;
}

const defaultDependencies: RuntimeDependencies = {
  readText: (path) => readFile(path, "utf8"),
  verifyMacSignature: defaultVerifyMacSignature,
  createAdapter: defaultCreateAdapter,
};

export async function createUpdateRuntime(
  options: DesktopUpdaterRuntimeOptions,
  dependencies: RuntimeDependencies = defaultDependencies,
): Promise<DesktopUpdater> {
  if (!options.isPackaged)
    return disabled(
      "Las actualizaciones automáticas están disponibles solo en la aplicación instalada.",
      options.currentVersion,
      options.onStatusChange,
    );
  if (
    (options.platform === "darwin" &&
      options.arch !== "x64" &&
      options.arch !== "arm64") ||
    (options.platform === "win32" &&
      options.arch !== "x64" &&
      options.arch !== "arm64")
  ) {
    return disabled(
      "Actualizaciones no disponibles para esta arquitectura.",
      options.currentVersion,
      options.onStatusChange,
    );
  }

  let config: unknown;
  try {
    config = configFromText(await dependencies.readText(options.configPath));
  } catch {
    return disabled(
      "La configuración de actualizaciones no está disponible.",
      options.currentVersion,
      options.onStatusChange,
    );
  }
  const validation = validateUpdaterConfig(
    config,
    options.platform,
    options.arch,
  );
  if (!validation.enabled)
    return disabled(
      validation.reason,
      options.currentVersion,
      options.onStatusChange,
    );
  const record = config as Record<string, unknown>;

  if (options.platform === "darwin") {
    if (
      typeof record.macTeamId !== "string" ||
      !/^[A-Z0-9]{10}$/.test(record.macTeamId)
    ) {
      return disabled(
        "Las actualizaciones requieren firma Developer ID verificada.",
        options.currentVersion,
        options.onStatusChange,
      );
    }
    let signature: Awaited<
      ReturnType<RuntimeDependencies["verifyMacSignature"]>
    >;
    try {
      signature = await dependencies.verifyMacSignature(options.appPath);
    } catch {
      return disabled(
        "No se pudo verificar la firma de esta aplicación.",
        options.currentVersion,
        options.onStatusChange,
      );
    }
    if (
      !signature.valid ||
      !signature.authority?.startsWith("Developer ID Application:") ||
      signature.teamId !== record.macTeamId
    ) {
      return disabled(
        "La aplicación no tiene una firma Developer ID válida para este equipo.",
        options.currentVersion,
        options.onStatusChange,
      );
    }
  }

  if (options.platform === "win32") {
    const expected = record.windowsPublisherNames;
    if (
      !Array.isArray(expected) ||
      expected.length === 0 ||
      expected.some((item) => typeof item !== "string" || !item.trim())
    ) {
      return disabled(
        "Falta configurar el editor esperado para verificar actualizaciones.",
        options.currentVersion,
        options.onStatusChange,
      );
    }
    let metadata: string;
    try {
      metadata = await dependencies.readText(
        join(options.resourcesPath, "app-update.yml"),
      );
    } catch {
      return disabled(
        "No se encontró la configuración de firma de actualizaciones.",
        options.currentVersion,
        options.onStatusChange,
      );
    }
    const publisherNames = parsePublisherNames(metadata);
    if (
      !publisherNames.length ||
      publisherNames.length !== expected.length ||
      publisherNames.some((name) => !expected.includes(name)) ||
      expected.some((name) => !publisherNames.includes(name))
    ) {
      return disabled(
        "El editor configurado no coincide con la firma de esta aplicación.",
        options.currentVersion,
        options.onStatusChange,
      );
    }
  }

  try {
    let adapter = await dependencies.createAdapter(
      options.platform as "win32" | "darwin",
      validation.feedUrl,
    );
    if (options.platform === "darwin" && dependencies.protectMacInstall)
      adapter = dependencies.protectMacInstall(adapter);
    return new DesktopUpdater({
      currentVersion: options.currentVersion,
      adapter,
      onStatusChange: options.onStatusChange,
    });
  } catch {
    return disabled(
      "No se pudo inicializar el servicio de actualizaciones.",
      options.currentVersion,
      options.onStatusChange,
    );
  }
}
