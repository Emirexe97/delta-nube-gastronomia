import type { AppUpdateStatusDto } from "@gastronomy/contracts";

export interface UpdateAdapter {
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface DesktopUpdaterOptions {
  currentVersion: string;
  adapter: UpdateAdapter | null;
  disabledReason?: string;
  onStatusChange?: (status: AppUpdateStatusDto) => void;
}

export interface UpdaterConfig {
  enabled: boolean;
  target: `${UpdaterPlatform}-${UpdaterArchitecture}`;
  feedUrl: string;
}

export type UpdaterPlatform = "win32" | "darwin";
export type UpdaterArchitecture = "x64" | "arm64";

export function validateUpdaterConfig(
  config: unknown,
  platform: string,
  architecture: string,
): { enabled: true; feedUrl: string } | { enabled: false; reason: string } {
  if (platform !== "win32" && platform !== "darwin") {
    return {
      enabled: false,
      reason: "Actualizaciones no disponibles para esta plataforma.",
    };
  }
  if (architecture !== "x64" && architecture !== "arm64") {
    return {
      enabled: false,
      reason: "Actualizaciones no disponibles para esta arquitectura.",
    };
  }
  if (
    !config ||
    typeof config !== "object" ||
    (config as any).enabled !== true
  ) {
    return {
      enabled: false,
      reason: "Las actualizaciones automáticas están deshabilitadas.",
    };
  }
  const target = (config as any).target;
  if (target !== `${platform}-${architecture}`) {
    return {
      enabled: false,
      reason: "La configuración de actualizaciones no corresponde a esta plataforma y arquitectura.",
    };
  }
  const feedUrl = (config as any).feedUrl;
  if (typeof feedUrl !== "string") {
    return {
      enabled: false,
      reason: "La configuración de actualizaciones no es válida.",
    };
  }
  try {
    const url = new URL(feedUrl);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("unsafe feed url");
    }
  } catch {
    return {
      enabled: false,
      reason: "La configuración de actualizaciones no es válida.",
    };
  }
  return { enabled: true, feedUrl };
}

// Deliberately narrow: only stable SemVer releases may be offered to stable clients.
function stableVersion(value: unknown): number[] | null {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewer(candidate: unknown, current: string): candidate is string {
  const a = stableVersion(candidate);
  const b = stableVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export class DesktopUpdater {
  private readonly options: DesktopUpdaterOptions;
  private status: AppUpdateStatusDto;
  private approvedVersion: string | null = null;
  private checkInFlight = false;
  private downloadInFlight = false;
  private disposed = false;

  constructor(options: DesktopUpdaterOptions) {
    this.options = options;
    this.status = {
      state: options.adapter ? "IDLE" : "DISABLED",
      currentVersion: options.currentVersion,
      availableVersion: null,
      progress: null,
      message: options.adapter
        ? "Listo para buscar actualizaciones."
        : (options.disabledReason ??
          "Las actualizaciones automáticas están deshabilitadas."),
    };
    if (options.adapter) this.bindEvents(options.adapter);
  }

  getStatus(): AppUpdateStatusDto {
    return { ...this.status };
  }

  async check(): Promise<AppUpdateStatusDto> {
    const adapter = this.options.adapter;
    if (
      !adapter ||
      this.disposed ||
      this.checkInFlight ||
      this.downloadInFlight ||
      !["IDLE", "CURRENT", "ERROR"].includes(this.status.state)
    ) {
      return this.getStatus();
    }
    this.checkInFlight = true;
    this.approvedVersion = null;
    this.setStatus({
      state: "CHECKING",
      availableVersion: null,
      progress: null,
      message: "Buscando actualizaciones…",
    });
    try {
      await adapter.checkForUpdates();
      if (this.disposed) return this.getStatus();
      // Event-driven completion is authoritative; a bare resolved promise means no event payload yet.
      if (this.status.state === "CHECKING")
        this.setStatus({
          state: "CURRENT",
          message: "La aplicación está actualizada.",
        });
    } catch {
      if (!this.disposed && this.status.state === "CHECKING")
        this.setError(
          "No se pudo buscar actualizaciones. Podés volver a intentarlo.",
        );
    } finally {
      this.checkInFlight = false;
    }
    return this.getStatus();
  }

  install(): AppUpdateStatusDto {
    if (this.disposed || !this.options.adapter || this.status.state !== "READY")
      return this.getStatus();
    try {
      this.setStatus({
        state: "INSTALLING",
        message: "Instalando actualización…",
      });
      this.options.adapter.quitAndInstall();
    } catch {
      this.setError(
        "No se pudo iniciar la instalación. Podés volver a intentarlo.",
      );
    }
    return this.getStatus();
  }

  dispose(): void {
    this.disposed = true;
  }

  private bindEvents(adapter: UpdateAdapter): void {
    adapter.on("update-available", (info: { version?: unknown }) => {
      if (
        this.disposed ||
        this.status.state !== "CHECKING" ||
        !isNewer(info?.version, this.status.currentVersion) ||
        this.downloadInFlight
      )
        return;
      const version = info.version;
      this.approvedVersion = version;
      this.downloadInFlight = true;
      this.setStatus({
        state: "DOWNLOADING",
        availableVersion: version,
        progress: 0,
        message: "Descargando actualización…",
      });
      void adapter
        .downloadUpdate()
        .catch(() => {
          if (!this.disposed && this.status.state === "DOWNLOADING")
            this.setError(
              "No se pudo descargar la actualización. Podés volver a intentarlo.",
            );
        })
        .finally(() => {
          this.downloadInFlight = false;
        });
    });
    adapter.on("update-not-available", () => {
      if (!this.disposed && this.status.state === "CHECKING")
        this.setStatus({
          state: "CURRENT",
          message: "La aplicación está actualizada.",
        });
    });
    adapter.on("download-progress", (progress: { percent?: unknown }) => {
      if (
        this.disposed ||
        this.status.state !== "DOWNLOADING" ||
        !this.approvedVersion
      )
        return;
      const percent =
        typeof progress?.percent === "number" &&
        Number.isFinite(progress.percent)
          ? Math.max(0, Math.min(100, progress.percent))
          : null;
      this.setStatus({
        progress: percent,
        message: "Descargando actualización…",
      });
    });
    adapter.on("update-downloaded", (info: { version?: unknown }) => {
      if (
        this.disposed ||
        this.status.state !== "DOWNLOADING" ||
        !this.approvedVersion ||
        info?.version !== this.approvedVersion
      )
        return;
      this.setStatus({
        state: "READY",
        availableVersion: this.approvedVersion,
        progress: 100,
        message: "Actualización lista para instalar.",
      });
    });
    adapter.on("error", () => {
      if (
        !this.disposed &&
        ["CHECKING", "DOWNLOADING", "INSTALLING"].includes(this.status.state)
      ) {
        this.setError(
          "Ocurrió un error con la actualización. Podés volver a intentarlo.",
        );
      }
    });
  }

  private setError(message: string): void {
    this.approvedVersion = null;
    this.setStatus({ state: "ERROR", progress: null, message });
  }

  private setStatus(changes: Partial<AppUpdateStatusDto>): void {
    this.status = { ...this.status, ...changes };
    this.options.onStatusChange?.(this.getStatus());
  }
}
