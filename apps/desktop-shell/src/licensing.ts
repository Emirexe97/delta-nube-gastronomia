import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { LicenseStatusDto } from "@gastronomy/contracts";
import {
  leaseAccess,
  verifyLease,
  devicePublicKeyFingerprint,
  signDeviceProof,
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
  accountEmail?: string | null;
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
  enforceLicense?: boolean;
  safeStorage?: { isAvailable?: () => boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };
};
type DeviceIdentity = { schema: 1; publicKey: string; encryptedPrivateKey: string; enrollment?: NonNullable<LicenseStatusDto["enrollment"]> };
type WebSiteChoice = { slug: string; whatsappNumber: string };

export class DesktopLicensing {
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly fetcher: typeof fetch;
  private state!: Persisted;
  private config: Config;
  private flight: Promise<LicenseStatusDto> | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private invalid = false;
  private configured = false;
  private readonly file: string;
  private readonly identityFile: string;
  private identity: DeviceIdentity | null = null;
  private identityPrivateKey: string | null = null;
  private identityLoadError: string | null = null;
  private enrollment: NonNullable<LicenseStatusDto["enrollment"]> = { requestId: null, status: null, keyFingerprint: null };
  private anchorMonotonic = 0;
  private anchorTrustedTime = 0;
  private lastPersistedEffective = 0;
  private persistChain: Promise<void> = Promise.resolve();
  private lastFailure: "offline" | "code" | "installation" | "invalid" | null =
    null;
  private enrollmentError: string | null = null;
  private webSiteProvisioner: ((ticket: string, signup: WebSiteChoice) => Promise<{ state?: string }>) | null = null;
  private getWebSiteChoice: (() => WebSiteChoice | null) | null = null;
  private selectWebSiteChoice: ((signup: WebSiteChoice) => Promise<unknown>) | null = null;
  private getWebSiteStatus: (() => { state?: string }) | null = null;
  private webSiteRetryAt = 0;
  private webSiteFailures = 0;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.fetcher = options.fetch ?? fetch;
    this.config = options.config ?? {};
    this.file = join(options.userDataPath, "license-state.json");
    this.identityFile = join(options.userDataPath, "device-identity.json");
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
    try {
      const identity = JSON.parse(await readFile(this.identityFile, "utf8")) as DeviceIdentity;
      if (identity.schema !== 1 || typeof identity.publicKey !== "string" || typeof identity.encryptedPrivateKey !== "string") throw new Error("identity");
      const decrypt = this.options.safeStorage?.decryptString;
      if (!decrypt) throw new Error("secure storage unavailable");
      const privateKey = decrypt(Buffer.from(identity.encryptedPrivateKey, "base64"));
      const derived = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
      if (derived !== identity.publicKey) throw new Error("key mismatch");
      // Drop legacy website tickets/choices: approval leases mint fresh tickets and the phone is stored encrypted by the provisioner.
      this.identity = { schema: 1, publicKey: identity.publicKey, encryptedPrivateKey: identity.encryptedPrivateKey, ...(identity.enrollment ? { enrollment: identity.enrollment } : {}) }; this.identityPrivateKey = privateKey;
      if (identity.enrollment) this.enrollment = identity.enrollment;
      await this.persistIdentity();
    } catch (error) {
      try { await readFile(this.identityFile); this.identityLoadError = "No se pudo recuperar de forma segura la identidad de este equipo. Contactá a soporte."; } catch { /* first run */ }
      this.identity = null; this.identityPrivateKey = null;
    }
  }
  private validConfig() {
    if (!this.config.publicKey || !this.config.serverUrl) return false;
    try {
      if (
        createPublicKey(this.config.publicKey).asymmetricKeyType !== "ed25519"
      )
        return false;
      const url = new URL(this.config.serverUrl);
      if (url.username || url.password) return false;
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
    if (!this.options.isPackaged && !this.options.enforceLicense)
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
        this.enrollmentError ?? (this.enrollment.status === "PENDING" ? "Solicitud enviada. Esperando habilitación del negocio." : this.enrollment.status === "REJECTED" ? "La solicitud de habilitación fue rechazada. Verificá los datos e intentá nuevamente." : this.failureMessage("UNACTIVATED")),
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
      ? "Ingresá con la cuenta de tu negocio en Configuración → Licencia para activar este equipo."
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
      enrollment: { ...this.enrollment },
      account: this.state.accountEmail ? { email: this.state.accountEmail } : null,
    };
  }
  activate(code: string) {
    return this.enqueue(() => { this.lastFailure = null; return this.online("/v1/activate", { code }); });
  }
  setWebSiteProvisioner(handlers: { provision: (ticket: string, signup: WebSiteChoice) => Promise<{ state?: string }>; getChoice: () => WebSiteChoice | null; selectChoice: (signup: WebSiteChoice) => Promise<unknown>; getStatus: () => { state?: string } }) {
    this.webSiteProvisioner = handlers.provision; this.getWebSiteChoice = handlers.getChoice; this.selectWebSiteChoice = handlers.selectChoice; this.getWebSiteStatus = handlers.getStatus;
  }
  hasEnrollmentIdentity() { return !!(this.identity && this.identityPrivateKey); }
  signInAccount(input: { email: string; password: string }): Promise<LicenseStatusDto> {
    return this.enqueue(() => this.performAccountSignIn(input));
  }
  private async performAccountSignIn(input: { email: string; password: string }): Promise<LicenseStatusDto> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]{1,128}@[^\s@.]{1,128}(?:\.[^\s@.]{1,63})+$/.test(email) || email.length > 254 || typeof input.password !== "string" || input.password.length < 1 || input.password.length > 1024) throw new Error("Ingresá un email y contraseña válidos.");
    if (!this.configured) throw new Error("La licencia aún no está configurada. Conectate con soporte.");
    if (this.identityLoadError) throw new Error(this.identityLoadError);
    try {
      await this.ensureDeviceIdentity();
      const keyFingerprint = devicePublicKeyFingerprint(this.identity!.publicKey);
      const challenge = await this.postEnrollment("/v2/devices/challenge", { installationId: this.state.installationId, publicKey: this.identity!.publicKey, purpose: "lease" });
      this.validateChallenge(challenge);
      const signature = signDeviceProof({ purpose: "lease", challengeId: challenge.challengeId, nonce: challenge.nonce, installationId: this.state.installationId, keyFingerprint }, this.identityPrivateKey!);
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response; let raw: string;
      try {
        response = await this.fetcher(new URL("/v2/accounts/activate", this.config.serverUrl), { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: input.password, installationId: this.state.installationId, publicKey: this.identity!.publicKey, challengeId: challenge.challengeId, signature }), signal: controller.signal });
        raw = await this.readBoundedBody(response, controller.signal);
      } finally { clearTimeout(timer); }
      if (!response.ok) { let code = ""; try { code = String((JSON.parse(raw) as any).error ?? ""); } catch {} throw new Error(`account:${accountError(code, response.status)}`); }
      const result = JSON.parse(raw) as any;
      this.validateRequest(result, keyFingerprint);
      if (result.request.status !== "APPROVED" || typeof result.token !== "string" || result.account?.email?.toLowerCase() !== email) throw new ResponseProblem("invalid");
      const verifiedLease = verifyLease(result.token, this.config.publicKey!, this.state.installationId);
      if (result.request.licenseId !== verifiedLease.licenseId || typeof result.account?.email !== "string" || result.account.email.length > 254 || result.account.email.toLowerCase() !== email) throw new ResponseProblem("invalid");
      if (result.webSiteTicket !== undefined && (typeof result.webSiteTicket !== "string" || !/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(result.webSiteTicket))) throw new ResponseProblem("invalid");
      await this.acceptToken(result.token);
      this.state.accountEmail = email; await this.persist();
      this.enrollment = { requestId: result.request.id, status: "APPROVED", keyFingerprint, businessName: result.request.businessName };
      this.identity!.enrollment = this.enrollment; await this.persistIdentity();
      if (typeof result.webSiteTicket === "string") await this.acceptWebSiteTicket(result.webSiteTicket);
      return this.getStatus();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("account:")) throw new Error(error.message.slice(8));
      if (error instanceof Error && error.message.includes("almacenamiento seguro")) throw error;
      if (error instanceof ResponseProblem && error.kind === "invalid") throw new Error("El servidor devolvió una respuesta de licencia inválida. Contactá a soporte.");
      throw new Error("No se pudo conectar con el servidor. Revisá internet e intentá nuevamente; la licencia guardada se conserva.");
    } finally { input.password = ""; }
  }
  private async ensureDeviceIdentity() {
    if (this.identity && this.identityPrivateKey) return;
    if (!this.options.safeStorage || this.options.safeStorage.isAvailable?.() === false) throw new Error("El almacenamiento seguro del sistema no está disponible.");
    const pair = generateKeyPairSync("ed25519"); const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString(); const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    this.identity = { schema: 1, publicKey, encryptedPrivateKey: this.options.safeStorage.encryptString(privateKey).toString("base64") }; this.identityPrivateKey = privateKey;
    await mkdir(dirname(this.identityFile), { recursive: true }); await this.persistIdentity();
  }
  async registerWebSite(signup: WebSiteChoice) {
    if (!this.identity || !this.selectWebSiteChoice || !this.getWebSiteStatus) throw new Error("Para habilitar una tienda, andá a Configuración → Licencia → Solicitar habilitación y esperá la aprobación sobre tu licencia existente.");
    if (this.getWebSiteStatus().state === "ACTIVE") throw new Error("Ya hay una tienda registrada; no se puede registrar otra.");
    const normalized = { slug: signup.slug.trim().toLowerCase(), whatsappNumber: signup.whatsappNumber.replace(/\D/g, "") };
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized.slug) || !/^\d{8,15}$/.test(normalized.whatsappNumber)) throw new Error("Revisá el enlace y WhatsApp (8 a 15 dígitos con código de país).");
    await this.selectWebSiteChoice(normalized);
    // The fresh authenticated v2 lease mints a new, short-lived ticket; never reuse or persist one.
    await this.refresh();
    return this.getWebSiteStatus();
  }
  retryWebSiteProvisioning() {
    if (!this.identity || this.enrollment.status !== "APPROVED" || !this.getWebSiteChoice?.() || this.getWebSiteStatus?.().state === "ACTIVE" || this.now() < this.webSiteRetryAt) return Promise.resolve(this.getWebSiteStatus?.());
    return this.refresh();
  }
  requestLicenseAccess(input: { businessName: string; webSite?: WebSiteChoice }) {
    return this.enqueue(() => this.performLicenseAccessRequest(input));
  }
  private async performLicenseAccessRequest(input: { businessName: string; webSite?: WebSiteChoice }) {
    this.lastFailure = null;
    this.enrollmentError = null;
    const businessName = input.businessName.trim();
    if (!businessName || businessName.length > 120) return this.getStatus();
    const phone = input.webSite?.whatsappNumber.replace(/\D/g, "") ?? "";
    const webSite = input.webSite && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.webSite.slug.trim().toLowerCase()) && /^\d{8,15}$/.test(phone) ? { slug: input.webSite.slug.trim().toLowerCase(), whatsappNumber: phone } : undefined;
    if (input.webSite && !webSite) throw new Error("Revisá el enlace y WhatsApp (8 a 15 dígitos con código de país).");
    try {
      if (this.identityLoadError) throw new Error(this.identityLoadError);
      if (!this.identity) {
        if (!this.options.safeStorage || this.options.safeStorage.isAvailable?.() === false) throw new Error("El almacenamiento seguro del sistema no está disponible. No se puede solicitar la habilitación en este equipo.");
        const pair = generateKeyPairSync("ed25519");
        const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
        const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        const encryptedPrivateKey = this.options.safeStorage.encryptString(privateKey).toString("base64");
        this.identity = { schema: 1, publicKey, encryptedPrivateKey }; this.identityPrivateKey = privateKey;
        await mkdir(dirname(this.identityFile), { recursive: true }); await this.persistIdentity();
      }
      if (webSite) await this.selectWebSiteChoice?.(webSite);
      const keyFingerprint = devicePublicKeyFingerprint(this.identity.publicKey);
      const challenge = await this.postEnrollment("/v2/devices/challenge", { installationId: this.state.installationId, publicKey: this.identity.publicKey, purpose: "request" });
      this.validateChallenge(challenge);
      const signature = signDeviceProof({ purpose: "request", challengeId: challenge.challengeId, nonce: challenge.nonce, installationId: this.state.installationId, keyFingerprint, businessName }, this.identityPrivateKey!);
      const result = await this.postEnrollment("/v2/devices/request", { installationId: this.state.installationId, publicKey: this.identity.publicKey, businessName, challengeId: challenge.challengeId, signature });
      this.validateRequest(result, keyFingerprint);
      this.enrollment = { requestId: result.request.id, status: result.request.status, keyFingerprint, businessName };
      this.identity.enrollment = this.enrollment; await this.persistIdentity();
      if (result.request.status === "APPROVED" && typeof result.token === "string") await this.acceptToken(result.token);
      else if (result.token !== undefined) throw new ResponseProblem("invalid");
      if (typeof result.webSiteTicket === "string") await this.acceptWebSiteTicket(result.webSiteTicket);
    } catch (error) {
      this.lastFailure = "offline";
      if (error instanceof Error && (error.message.includes("almacenamiento seguro") || error.message.includes("identidad de este equipo"))) { this.enrollment = { ...this.enrollment, status: null }; this.enrollmentError = error.message; }
    }
    return this.getStatus();
  }
  private async postEnrollment(path: string, body: Record<string, unknown>) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(new URL(path, this.config.serverUrl), { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const raw = await this.readBoundedBody(response, controller.signal);
      if (!response.ok) throw new Error("enrollment failed");
      return JSON.parse(raw) as any;
    } catch (error) { if (error instanceof ResponseProblem) throw error; throw new ResponseProblem("offline"); }
    finally { clearTimeout(timer); }
  }
  private validateChallenge(value: any) {
    if (!value || typeof value.challengeId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.challengeId) || typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= this.now()) throw new ResponseProblem("invalid");
  }
  private validateRequest(value: any, fingerprint: string) {
    const request = value?.request;
    if (!request || typeof request.id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(request.id) || request.installationId !== this.state.installationId || request.keyFingerprint !== fingerprint || !["PENDING", "APPROVED", "REJECTED"].includes(request.status) || typeof request.businessName !== "string" || !Number.isFinite(Date.parse(request.createdAt)) || !(request.licenseId === null || typeof request.licenseId === "string")) throw new ResponseProblem("invalid");
  }
  private async persistIdentity() {
    const temp = `${this.identityFile}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(this.identity), { mode: 0o600 }); await rename(temp, this.identityFile);
  }
  refresh() {
    return this.enqueue(() => {
      this.lastFailure = null;
      if (this.identity && this.identityPrivateKey && (this.enrollment.status === "PENDING" || this.enrollment.status === "APPROVED")) return this.refreshEnrollmentLease();
      return this.online("/v1/verify", {});
    });
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(work, work);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  private async refreshEnrollmentLease() {
    try {
      const keyFingerprint = devicePublicKeyFingerprint(this.identity!.publicKey);
      const challenge = await this.postEnrollment("/v2/devices/challenge", { installationId: this.state.installationId, publicKey: this.identity!.publicKey, purpose: "lease" });
      this.validateChallenge(challenge);
      const signature = signDeviceProof({ purpose: "lease", challengeId: challenge.challengeId, nonce: challenge.nonce, installationId: this.state.installationId, keyFingerprint }, this.identityPrivateKey!);
      const result = await this.postEnrollment("/v2/devices/lease", { installationId: this.state.installationId, publicKey: this.identity!.publicKey, challengeId: challenge.challengeId, signature });
      this.validateRequest(result, keyFingerprint);
      this.enrollment = { requestId: result.request.id, status: result.request.status, keyFingerprint, ...(this.enrollment.businessName ? { businessName: this.enrollment.businessName } : {}) };
      this.identity!.enrollment = this.enrollment; await this.persistIdentity();
      if (result.request.status === "APPROVED" && typeof result.token === "string") await this.acceptToken(result.token);
      else if (result.token !== undefined) throw new ResponseProblem("invalid");
      if (typeof result.webSiteTicket === "string") await this.acceptWebSiteTicket(result.webSiteTicket);
      else if (this.getWebSiteChoice?.()) this.scheduleWebSiteRetry();
    } catch (error) { this.lastFailure = error instanceof ResponseProblem && error.kind === "invalid" ? "invalid" : "offline"; if (this.enrollment.status === "APPROVED" && this.getWebSiteChoice?.()) this.scheduleWebSiteRetry(); }
    return this.getStatus();
  }
  private async acceptWebSiteTicket(ticket: string) {
    if (!/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(ticket)) throw new ResponseProblem("invalid");
    if (!this.webSiteProvisioner || !this.getWebSiteChoice || this.now() < this.webSiteRetryAt) return;
    const choice = this.getWebSiteChoice(); if (!choice || this.getWebSiteStatus?.().state === "ACTIVE") return;
    try {
      const status = await this.webSiteProvisioner(ticket, choice);
      if (status.state === "ACTIVE") { this.webSiteFailures = 0; this.webSiteRetryAt = 0; }
      else this.scheduleWebSiteRetry();
    } catch { this.scheduleWebSiteRetry(); }
  }
  private scheduleWebSiteRetry() { this.webSiteFailures++; this.webSiteRetryAt = this.now() + Math.min(15_000 * 2 ** Math.min(this.webSiteFailures - 1, 5), 5 * 60_000); }
  private async acceptToken(token: string) {
    const lease = verifyLease(token, this.config.publicKey!, this.state.installationId);
    const currentLease = this.safeLease();
    if (lease.revision < this.state.revision || (currentLease && lease.issuedAt <= currentLease.issuedAt)) throw new ResponseProblem("invalid");
    const issuedAt = Date.parse(lease.issuedAt);
    if (!Number.isFinite(issuedAt) || issuedAt + ROLLBACK_TOLERANCE < this.state.lastTrustedTime) throw new ResponseProblem("invalid");
    this.state.token = token; this.state.revision = lease.revision; this.state.lastVerifiedAt = new Date(Math.max(issuedAt, this.effectiveNow())).toISOString(); this.state.lastTrustedTime = Math.max(this.state.lastTrustedTime, issuedAt); this.state.maxSeenWallClock = Math.max(this.state.maxSeenWallClock, this.now()); this.invalid = false; this.anchorTrustedTime = Math.max(this.effectiveNow(), issuedAt); this.anchorMonotonic = this.monotonicNow(); await this.persist(); this.lastFailure = null;
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
    const cancelOnAbort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancelOnAbort, { once: true });
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
      signal.removeEventListener("abort", cancelOnAbort);
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

function accountError(code: string, status: number): string {
  if (code === "invalid_credentials") return "Email o contraseña incorrectos.";
  if (code === "installation_mismatch") return "Esta cuenta no puede activarse en esta instalación. Contactá a soporte.";
  if (code === "rate_limited" || status === 429) return "Demasiados intentos. Esperá un momento y volvé a intentar.";
  if (status >= 500) return "El servicio no está disponible. Intentá nuevamente más tarde.";
  return "No se pudo activar la cuenta. Revisá los datos e intentá nuevamente.";
}
