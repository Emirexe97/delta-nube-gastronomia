import { createPublicKey, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { LicenseStatusDto } from "@gastronomy/contracts";
import {
  leaseAccess,
  verifyLease,
  VERIFICATION_INTERVAL_MS,
} from "@gastronomy/licensing";
import type { LicenseLease } from "@gastronomy/licensing";

const DAY = 86_400_000;
const ROLLBACK_TOLERANCE = 5 * 60_000;
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
type Persisted = {
  schema: 1;
  installationId: string;
  token: string | null;
  lastTrustedTime: number;
  maxSeenWallClock: number;
  lastVerifiedAt: string | null;
  revision: number;
};
type Config = { serverUrl?: string; publicKey?: string };
type Options = {
  userDataPath: string;
  isPackaged: boolean;
  now?: () => number;
  monotonicNow?: () => number;
  fetch?: typeof fetch;
  config?: Config;
  configPath?: string;
  allowLoopbackHttp?: boolean;
};

export class DesktopLicensing {
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly fetcher: typeof fetch;
  private state!: Persisted;
  private config: Config;
  private flight: Promise<LicenseStatusDto> | null = null;
  private invalid = false;
  private configured = false;
  private readonly file: string;
  private anchorMonotonic = 0;
  private anchorTrustedTime = 0;
  private lastPersistedEffective = 0;
  private persistChain: Promise<void> = Promise.resolve();
  private lastFailure: "offline" | "code" | "installation" | "invalid" | null =
    null;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.fetcher = options.fetch ?? fetch;
    this.config = options.config ?? {};
    this.file = join(options.userDataPath, "license-state.json");
  }
  async initialize() {
    if (!this.options.config && this.options.configPath) {
      try {
        this.config = JSON.parse(
          await readFile(this.options.configPath, "utf8"),
        ) as Config;
      } catch {
        this.config = {};
      }
    }
    this.configured = this.validConfig();
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Persisted;
      if (
        parsed.schema !== 1 ||
        typeof parsed.installationId !== "string" ||
        !parsed.installationId ||
        typeof parsed.maxSeenWallClock !== "number" ||
        typeof parsed.lastTrustedTime !== "number" ||
        !Number.isSafeInteger(parsed.revision)
      )
        throw new Error("state");
      this.state = parsed;
    } catch {
      this.state = {
        schema: 1,
        installationId: randomUUID(),
        token: null,
        lastTrustedTime: 0,
        maxSeenWallClock: this.now(),
        lastVerifiedAt: null,
        revision: 0,
      };
      await this.persist();
    }
    this.anchorTrustedTime = Math.max(
      this.state.lastTrustedTime,
      this.state.maxSeenWallClock,
    );
    this.anchorMonotonic = this.monotonicNow();
    this.lastPersistedEffective = this.anchorTrustedTime;
  }
  private validConfig() {
    if (!this.config.publicKey || !this.config.serverUrl) return false;
    try {
      if (
        createPublicKey(this.config.publicKey).asymmetricKeyType !== "ed25519"
      )
        return false;
      const url = new URL(this.config.serverUrl);
      return (
        url.protocol === "https:" ||
        (this.options.allowLoopbackHttp === true &&
          !this.options.isPackaged &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }
  private async persist(snapshot: Persisted = { ...this.state }) {
    const data = JSON.stringify(snapshot);
    this.persistChain = this.persistChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temp, data, { mode: 0o600 });
      await rename(temp, this.file);
    });
    return this.persistChain;
  }
  private effectiveNow() {
    return Math.max(
      this.now(),
      this.anchorTrustedTime +
        Math.max(0, this.monotonicNow() - this.anchorMonotonic),
    );
  }
  private rollback() {
    return (
      this.now() + ROLLBACK_TOLERANCE <
      Math.max(this.state.maxSeenWallClock, this.effectiveNow())
    );
  }
  private async persistClockIfChanged() {
    const wall = this.now();
    const effective = this.effectiveNow();
    let changed = false;
    if (wall > this.state.maxSeenWallClock) {
      this.state.maxSeenWallClock = wall;
      changed = true;
    }
    if (effective - this.lastPersistedEffective >= 60_000) {
      this.state.lastTrustedTime = Math.max(
        this.state.lastTrustedTime,
        effective,
      );
      this.lastPersistedEffective = effective;
      changed = true;
    }
    if (changed) await this.persist();
  }
  async getStatus(): Promise<LicenseStatusDto> {
    await this.persistClockIfChanged();
    if (!this.options.isPackaged)
      return this.dto(
        "DEVELOPMENT",
        true,
        null,
        "Modo desarrollo: licencia no requerida.",
      );
    if (!this.configured)
      return this.dto(
        "NOT_CONFIGURED",
        false,
        null,
        "La licencia aún no está configurada. Conectate con soporte.",
      );
    if (!this.state.token)
      return this.dto(
        "UNACTIVATED",
        false,
        null,
        this.failureMessage("UNACTIVATED"),
      );
    if (this.rollback())
      return this.dto(
        "CLOCK_ROLLBACK",
        false,
        this.safeLease(),
        "Detectamos un retroceso del reloj. Corregí la fecha y hora del equipo para continuar.",
      );
    const lease = this.safeLease();
    if (!lease || this.invalid)
      return this.dto(
        "INVALID",
        false,
        null,
        "No se pudo validar esta licencia. Contactá a soporte.",
      );
    const access = leaseAccess(lease, this.effectiveNow());
    if (access === "SUSPENDED")
      return this.dto(
        "SUSPENDED",
        false,
        lease,
        "Esta licencia está suspendida. Contactá a soporte.",
      );
    if (access === "EXPIRED")
      return this.dto(
        "EXPIRED",
        false,
        lease,
        "El período de licencia y gracia venció. Renovala para continuar operando.",
      );
    const message = this.lastFailure
      ? this.failureMessage("")
      : access === "GRACE"
        ? "Licencia en período de gracia. Conectate para verificar o renovar."
        : "Licencia activa.";
    return this.dto(access, true, lease, message);
  }
  private failureMessage(fallback: string) {
    if (this.lastFailure === "offline")
      return "No se pudo conectar con el servidor. Revisá internet; la licencia guardada se conserva.";
    if (this.lastFailure === "code")
      return "El código no es válido o ya no está disponible. Revisalo e intentá nuevamente.";
    if (this.lastFailure === "installation")
      return "Este código ya está asociado a otra instalación. Contactá a soporte.";
    if (this.lastFailure === "invalid")
      return "El servidor devolvió una licencia inválida. Contactá a soporte.";
    return fallback === "UNACTIVATED"
      ? "Activá Delta Nube con el código de licencia de tu negocio."
      : fallback;
  }
  private safeLease(): LicenseLease | null {
    try {
      return this.state.token
        ? verifyLease(
            this.state.token,
            this.config.publicKey!,
            this.state.installationId,
          )
        : null;
    } catch {
      this.invalid = true;
      return null;
    }
  }
  private dto(
    state: LicenseStatusDto["state"],
    canOperate: boolean,
    lease: LicenseLease | null,
    message: string,
  ): LicenseStatusDto {
    return {
      state,
      canOperate,
      installationId: this.state.installationId,
      businessName: lease?.businessName ?? null,
      paidThrough: lease?.paidThrough ?? null,
      graceUntil: lease?.graceUntil ?? null,
      lastVerifiedAt: this.state.lastVerifiedAt,
      verificationOverdue:
        !!lease &&
        this.effectiveNow() - Date.parse(this.state.lastVerifiedAt ?? "") >=
          VERIFICATION_INTERVAL_MS,
      message,
    };
  }
  activate(code: string) {
    this.lastFailure = null;
    return this.online("/v1/activate", { code });
  }
  refresh() {
    this.lastFailure = null;
    return this.online("/v1/verify", {});
  }
  private online(
    path: string,
    body: Record<string, string>,
  ): Promise<LicenseStatusDto> {
    if (this.flight) return this.flight;
    this.flight = this.performOnline(path, body).finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  private async performOnline(
    path: string,
    body: Record<string, string>,
  ): Promise<LicenseStatusDto> {
    const before = await this.getStatus();
    if (before.state === "NOT_CONFIGURED" || before.state === "DEVELOPMENT")
      return before;
    if (path.endsWith("verify") && !this.state.token) return before;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(
        new URL(path, this.config.serverUrl),
        {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...body,
            installationId: this.state.installationId,
            ...(path.endsWith("verify") ? { token: this.state.token } : {}),
          }),
          signal: controller.signal,
        },
      );
      const raw = await this.readBoundedBody(response, controller.signal);
      if (!response.ok) {
        let serverCode = "";
        try {
          serverCode = String(
            (JSON.parse(raw) as { error?: unknown }).error ?? "",
          );
        } catch {
          /* no server details are exposed */
        }
        this.lastFailure =
          serverCode === "installation_mismatch"
            ? "installation"
            : path.endsWith("activate") &&
                ["invalid_activation", "invalid_installation"].includes(
                  serverCode,
                )
              ? "code"
              : response.status === 429 || response.status >= 500
                ? "offline"
                : "invalid";
        return await this.getStatus();
      }
      let result: { token?: unknown };
      try {
        result = JSON.parse(raw) as { token?: unknown };
      } catch {
        throw new ResponseProblem("invalid");
      }
      if (typeof result.token !== "string")
        throw new ResponseProblem("invalid");
      let lease: LicenseLease;
      try {
        lease = verifyLease(
          result.token,
          this.config.publicKey!,
          this.state.installationId,
        );
      } catch {
        throw new ResponseProblem("invalid");
      }
      const currentLease = this.safeLease();
      if (
        lease.revision < this.state.revision ||
        (currentLease && lease.issuedAt <= currentLease.issuedAt)
      )
        throw new ResponseProblem("invalid");
      const issuedAt = Date.parse(lease.issuedAt);
      if (
        !Number.isFinite(issuedAt) ||
        issuedAt + ROLLBACK_TOLERANCE < this.state.lastTrustedTime
      )
        throw new ResponseProblem("invalid");
      this.state.token = result.token;
      this.state.revision = lease.revision;
      this.state.lastVerifiedAt = new Date(
        Math.max(issuedAt, this.effectiveNow()),
      ).toISOString();
      this.state.lastTrustedTime = Math.max(
        this.state.lastTrustedTime,
        issuedAt,
      );
      this.state.maxSeenWallClock = Math.max(
        this.state.maxSeenWallClock,
        this.now(),
      );
      this.invalid = false;
      // Re-anchoring must preserve elapsed monotonic time, even when the wall
      // clock or the server is slightly behind the effective trusted clock.
      this.anchorTrustedTime = Math.max(this.effectiveNow(), issuedAt);
      this.anchorMonotonic = this.monotonicNow();
      await this.persist();
      this.lastFailure = null;
      return await this.getStatus();
    } catch (error) {
      this.lastFailure =
        error instanceof ResponseProblem && error.kind === "invalid"
          ? "invalid"
          : "offline";
      return await this.getStatus();
    } finally {
      clearTimeout(timer);
    }
  }
  private async readBoundedBody(response: Response, signal: AbortSignal) {
    if (!response.body) throw new ResponseProblem("invalid");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        if (signal.aborted) throw new ResponseProblem("offline");
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ResponseProblem("invalid");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(merged);
    } catch {
      throw new ResponseProblem("invalid");
    }
  }
}

class ResponseProblem extends Error {
  readonly kind: "offline" | "invalid";
  constructor(kind: "offline" | "invalid") {
    super(kind);
    this.kind = kind;
  }
}
