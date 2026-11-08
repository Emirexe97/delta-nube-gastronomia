import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type SecretStorage = { isAvailable?: () => boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };
export type WaiterCredential = { storeId: string; waiterToken: string };
type Identity = { installationId: string; licenseId: string };
type Persisted = { schema: 1; origin: string; identity: Identity; encryptedCredential: string; validatedAt: number };
type CredentialEnvelope = { origin: string; identity: Identity; credential: WaiterCredential };
type Options = {
  userDataPath: string; baseUrl: string; safeStorage: SecretStorage;
  installationId: () => string | undefined; licenseId: () => string | undefined;
  fetch?: typeof fetch; now?: () => number;
};

/** Main-process-only waiter credential enrollment. Never returns tickets or logs credentials. */
export class WaiterProvisioning {
  private readonly file: string;
  private readonly origin: string;
  private readonly storage: SecretStorage;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly options: Options;
  private credentialValue: WaiterCredential | null = null;
  private owner: Identity | null = null;
  private ownerOrigin = "";
  private credentialInvalid = false;
  private flight: Promise<boolean> | null = null;
  private retryAt = 0;
  private failures = 0;
  private validatedAt = 0;
  private readonly revalidateMs = 12 * 60 * 60_000;

  constructor(options: Options) {
    this.options = options;
    this.file = join(options.userDataPath, "waiter-connection-state.json");
    this.storage = options.safeStorage;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.origin = validOrigin(options.baseUrl) ?? "";
  }

  async initialize(): Promise<void> {
    this.credentialValue = null;
    this.owner = null;
    this.ownerOrigin = "";
    this.credentialInvalid = false;
    if (!this.origin || !this.currentIdentity()) return;
    let parsed: Persisted;
    try { parsed = JSON.parse(await readFile(this.file, "utf8")) as Persisted; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      this.credentialInvalid = true;
      return;
    }
    try {
      if (!parsed || parsed.schema !== 1 || typeof parsed.origin !== "string" || !validIdentity(parsed.identity) || typeof parsed.encryptedCredential !== "string" || !parsed.encryptedCredential) throw new Error("invalid state");
      // Identity/origin mismatch is a stale cache, not corruption. It can be safely replaced
      // only after the current licensing authority supplies a fresh scoped ticket.
      if (parsed.origin !== this.origin || !sameIdentity(parsed.identity, this.currentIdentity())) return;
      if (this.storage.isAvailable?.() === false) throw new Error("secure storage unavailable");
      const value = JSON.parse(this.storage.decryptString(Buffer.from(parsed.encryptedCredential, "base64"))) as CredentialEnvelope;
      if (!value || value.origin !== parsed.origin || !sameIdentity(value.identity, parsed.identity) || !validCredential(value.credential) || !sameIdentity(parsed.identity, this.currentIdentity())) throw new Error("invalid credential");
      if (!Number.isSafeInteger(parsed.validatedAt) || parsed.validatedAt < 0 || parsed.validatedAt > this.now() + 15_000) throw new Error("invalid validation time");
      this.credentialValue = { storeId: value.credential.storeId, waiterToken: value.credential.waiterToken };
      this.owner = { ...parsed.identity }; this.ownerOrigin = parsed.origin;
      this.validatedAt = parsed.validatedAt;
    } catch {
      // Do not overwrite or delete an unreadable cache: that could destroy the only recovery evidence.
      this.credentialInvalid = true;
    }
  }

  /** One ticket is consumed transiently; callers may retry after a transient failure. */
  provision(waiterTicket: string): Promise<boolean> {
    const cached = this.credential();
    const identity = this.currentIdentity();
    if (this.credentialInvalid || !this.origin || !identity) return Promise.resolve(false);
    if (this.owner && (!sameIdentity(this.owner, identity) || this.ownerOrigin !== this.origin)) {
      this.credentialValue = null; this.owner = null; this.ownerOrigin = ""; this.validatedAt = 0;
      this.failures = 0; this.retryAt = 0;
    }
    if (cached && this.now() - this.validatedAt < this.revalidateMs) return Promise.resolve(true);
    if (this.flight) return this.flight;
    if (this.now() < this.retryAt) return Promise.resolve(false);
    if (this.storage.isAvailable?.() === false) return Promise.resolve(false);
    if (typeof waiterTicket !== "string" || !/^dn-waiter-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(waiterTicket)) return Promise.resolve(false);
    this.flight = this.perform(waiterTicket).finally(() => { this.flight = null; });
    return this.flight;
  }

  /** Available only to main-process wiring; returns null if cache belongs to another identity/origin. */
  credential(): WaiterCredential | null {
    if (!this.credentialValue || this.credentialInvalid || !this.origin || this.ownerOrigin !== this.origin || this.now() - this.validatedAt >= 48 * 60 * 60_000) return null;
    const identity = this.currentIdentity();
    return identity && this.owner && sameIdentity(identity, this.owner) ? { ...this.credentialValue } : null;
  }

  private async perform(ticket: string): Promise<boolean> {
    try {
      const identity = this.currentIdentity();
      if (!identity) return false;
      const response = await this.fetcher(new URL("/v1/waiter-connections", this.origin), {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${ticket}`, "content-type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("request failed");
      const body = await response.json();
      if (!validCredential(body) || !sameIdentity(identity, this.currentIdentity()) || !this.origin) throw new Error("invalid response");
      const data: Persisted = { schema: 1, origin: this.origin, identity, encryptedCredential: this.encrypt(JSON.stringify({ origin: this.origin, identity, credential: body } satisfies CredentialEnvelope)), validatedAt: this.now() };
      await this.persist(data);
      // Re-check after I/O; a license or installation switch must never publish the prior identity.
      if (!sameIdentity(identity, this.currentIdentity()) || !this.origin) { this.credentialInvalid = true; return false; }
      this.credentialValue = { storeId: body.storeId, waiterToken: body.waiterToken };
      this.owner = { ...identity }; this.ownerOrigin = this.origin;
      this.validatedAt = data.validatedAt;
      this.failures = 0; this.retryAt = 0;
      return true;
    } catch {
      this.failures = Math.min(this.failures + 1, 8);
      this.retryAt = this.now() + Math.min(60_000, 1000 * 2 ** (this.failures - 1));
      return false;
    }
  }

  private currentIdentity(): Identity | null {
    try {
      const installationId = this.options.installationId();
      const licenseId = this.options.licenseId();
      if (!validId(installationId) || !validId(licenseId)) return null;
      return { installationId, licenseId };
    } catch { return null; }
  }

  private encrypt(value: string): string {
    if (this.storage.isAvailable?.() === false) throw new Error("secure storage unavailable");
    return this.storage.encryptString(value).toString("base64");
  }

  private async persist(data: Persisted) {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" }); await rename(temp, this.file); }
    catch (error) { const fs = await import("node:fs/promises"); await fs.rm(temp, { force: true }).catch(() => undefined); throw error; }
  }
}

function validOrigin(value: string): string | null {
  try { const u = new URL(value); return !u.username && !u.password && !u.search && !u.hash && u.pathname === "/" && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) ? u.origin : null; }
  catch { return null; }
}
function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function validIdentity(value: any): value is Identity { return !!value && typeof value === "object" && validId(value.installationId) && validId(value.licenseId); }
function sameIdentity(a: unknown, b: unknown): boolean { return !!a && !!b && typeof a === "object" && typeof b === "object" && (a as Identity).installationId === (b as Identity).installationId && (a as Identity).licenseId === (b as Identity).licenseId; }
function validCredential(value: any): value is WaiterCredential {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === "storeId,waiterToken" &&
    typeof value.storeId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.storeId) &&
    typeof value.waiterToken === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value.waiterToken);
}
