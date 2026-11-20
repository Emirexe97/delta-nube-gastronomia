import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WebSiteStatus, WebSiteBrandingEdit, WebProductPhoto, WebSitePreviewDraft } from "@gastronomy/contracts";

type SecretStorage = { isAvailable?: () => boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };
type Credential = { storeId: string; receiveToken: string };
type Signup = { slug: string; whatsappNumber: string };
type BrandingEdit = WebSiteBrandingEdit;
const jpegHeader = "data:image/jpeg;base64,";
const maxCoverBytes = 320 * 1024;
function validCover(value: unknown, byteLimit = maxCoverBytes): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > jpegHeader.length + Math.ceil(byteLimit / 3) * 4 || !value.startsWith(jpegHeader)) return false;
  const encoded = value.slice(jpegHeader.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length >= 4 && bytes.length <= byteLimit && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9 && bytes.toString("base64") === encoded;
}
const validRef = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id);
const validPhoto = (p: WebProductPhoto) => p && validRef(p.productRef) && validCover(p.dataUrl, 160*1024);
type Persisted = { schema: 2; status: WebSiteStatus; encryptedCredential: string | null; encryptedSignup: string | null };
type Options = { userDataPath: string; baseUrl?: string; env?: NodeJS.ProcessEnv; safeStorage: SecretStorage; fetch?: typeof fetch; installationId: () => string | undefined; now?: () => number; onConfigured?: (credential: Credential, baseUrl: string) => void };
const emptyStatus = (): WebSiteStatus => ({ state: "UNCONFIGURED", slug: null, url: null, displayName: "", tagline: "", accent: "", designMode: "STANDARD", message: "Tienda web sin configurar" });
const normalizeSignup = (input: Signup): Signup => {
  const slug = input.slug.trim().toLowerCase();
  const whatsappNumber = input.whatsappNumber.replace(/\D/g, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) throw new Error("El enlace debe tener letras, números o guiones.");
  if (!/^\d{8,15}$/.test(whatsappNumber)) throw new Error("WhatsApp debe tener entre 8 y 15 dígitos, con código de país.");
  return { slug, whatsappNumber };
};

/** Main-process only: no ticket/receive token is returned, persisted in plaintext, or logged. */
export class WebSiteProvisioning {
  private readonly options: Options;
  private readonly file: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetcher: typeof fetch;
  private readonly storage: SecretStorage;
  private baseUrl = "";
  private data: Persisted = { schema: 2, status: emptyStatus(), encryptedCredential: null, encryptedSignup: null };
  private credential: Credential | null = null;
  private signup: Signup | null = null;
  private credentialInvalid = false;
  private terminalSignupError = false;
  private requestFlight: Promise<WebSiteStatus> | null = null;
  private lastReconciledAt = 0;
  private readonly now: () => number;
  constructor(options: Options) { this.options = options; this.file = join(options.userDataPath, "web-site-state.json"); this.env = options.env ?? process.env; this.fetcher = options.fetch ?? fetch; this.storage = options.safeStorage; this.now = options.now ?? Date.now; }

  async initialize() {
    this.baseUrl = (this.options.baseUrl ?? this.env.GASTRONOMY_WEB_PROVISION_URL ?? "").trim();
    if (!validBaseUrl(this.baseUrl)) this.baseUrl = "";
    let found = false;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Persisted;
      found = true;
      if (![1, 2].includes((parsed as any).schema) || !parsed.status || typeof parsed.status.state !== "string") throw new Error("state");
      this.data = { schema: 2, status: parsed.status, encryptedCredential: parsed.encryptedCredential ?? null, encryptedSignup: (parsed as any).encryptedSignup ?? null };
      if (this.data.encryptedCredential) {
        if (this.storage.isAvailable?.() === false) throw new Error("secure storage unavailable");
        const value = JSON.parse(this.storage.decryptString(Buffer.from(this.data.encryptedCredential, "base64"))) as Credential;
        if (!validCredential(value)) throw new Error("credential");
        this.credential = value;
        this.configureSync(value);
      }
      if (this.data.encryptedSignup) {
        const value = JSON.parse(this.storage.decryptString(Buffer.from(this.data.encryptedSignup, "base64"))) as Signup;
        this.signup = normalizeSignup(value);
      }
    } catch {
      if (found) {
        this.credentialInvalid = true;
        this.credential = null;
        this.data.status = { ...emptyStatus(), state: "ERROR", message: "No se pudo recuperar de forma segura la configuración de la tienda; volvé a contactar soporte." };
      }
    }
    if (!this.credentialInvalid && (!found || !this.credential)) {
      if (!this.baseUrl) this.data.status = emptyStatus();
      else if (!this.signup && this.data.status.state !== "ERROR") this.data.status = { ...emptyStatus(), state: "NOT_REGISTERED", message: "Tienda web disponible para configurar" };
    }
    if (this.signup && this.hasManualCommerceConfig() && !this.credential) {
      this.terminalSignupError = true;
      this.data.status = { ...this.data.status, state: "ERROR", message: "Ya existe una conexión web manual; revisá Configuración antes de registrar otra tienda." };
    }
    if (!this.credentialInvalid) await this.persist();
  }

  status(): WebSiteStatus { return { ...this.data.status }; }
  selectedSignup(): Signup | null { return this.signup && !this.terminalSignupError ? { ...this.signup } : null; }
  hasPendingSignup() { return !!this.signup && !this.credential && !this.credentialInvalid; }
  async select(input: Signup): Promise<WebSiteStatus> {
    if (this.credentialInvalid) return this.status();
    if (this.data.status.state === "ACTIVE" || this.credential) throw new Error("Ya hay una tienda registrada; no se puede registrar otra.");
    if (this.hasManualCommerceConfig()) {
      this.data.status = { ...this.data.status, state: "ERROR", message: "Ya existe una conexión web configurada manualmente; no se va a registrar otra tienda." };
      await this.persist(); return this.status();
    }
    this.signup = normalizeSignup(input);
    this.terminalSignupError = false;
    this.data.encryptedSignup = this.encrypt(JSON.stringify(this.signup));
    this.data.status = { ...emptyStatus(), state: "PENDING", slug: this.signup.slug, message: "Esperando habilitación segura de la tienda" };
    await this.persist(); return this.status();
  }

  /** Receives a fresh, short-lived ticket from an approved v2 lease; ticket is never saved. */
  provision(ticket: string, choice: Signup): Promise<WebSiteStatus> {
    if (this.data.status.state === "ACTIVE" || this.credential) return Promise.resolve(this.status());
    let signup: Signup;
    try { signup = normalizeSignup(choice); } catch (error) { return Promise.reject(error); }
    if (!this.signup || signup.slug !== this.signup.slug || signup.whatsappNumber !== this.signup.whatsappNumber) return Promise.resolve(this.status());
    if (!this.baseUrl || this.hasManualCommerceConfig()) return Promise.resolve(this.status());
    if (!/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(ticket)) return Promise.resolve({ ...this.data.status, state: "ERROR", message: "No se pudo validar la autorización de la tienda" });
    if (this.requestFlight) return this.requestFlight;
    this.requestFlight = this.performProvision(ticket, signup).finally(() => { this.requestFlight = null; });
    return this.requestFlight;
  }

  /** Refresh an existing trial-origin site's access using a one-shot signed lease ticket. */
  async refreshAccess(ticket: string): Promise<void> {
    if (this.data.status.state !== "ACTIVE" || !this.credential || !this.baseUrl) return;
    if (!/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(ticket)) throw new Error("invalid ticket");
    const response = await this.fetcher(new URL("/v1/web-sites/access", this.baseUrl), { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("site access refresh failed");
  }

  async getStatus(reconcile = true): Promise<WebSiteStatus> {
    if (this.requestFlight) return this.requestFlight;
    if (!reconcile || !this.credential || this.credentialInvalid || this.now() - this.lastReconciledAt < 30_000) return this.status();
    this.requestFlight = this.reconcile().finally(() => { this.requestFlight = null; });
    return this.requestFlight;
  }

  async updateBranding(input: BrandingEdit): Promise<WebSiteStatus> {
    // Do not let a delayed reconciliation replace the published result.
    if (this.requestFlight) await this.requestFlight;
    if (this.requestFlight) throw new Error("Esperá a que termine la publicación anterior.");
    if (!this.credential || this.data.status.state !== "ACTIVE" || this.credentialInvalid) throw new Error("La tienda web no está configurada.");
    if (input.bannerDataUrl !== undefined && !validCover(input.bannerDataUrl)) throw new Error("La imagen de portada no es válida o supera los 320 KB.");
    if (input.logoDataUrl !== undefined && !validCover(input.logoDataUrl, 96*1024)) throw new Error("El logo no es válido o supera los 96 KB.");
    if (input.productPhoto !== undefined && !validPhoto(input.productPhoto)) throw new Error("La foto de producto no es válida o supera los 160 KB.");
    this.requestFlight = this.publishBranding(input, this.credential).finally(() => { this.requestFlight = null; });
    return this.requestFlight;
  }

  private async publishBranding(input: BrandingEdit, credential: Credential): Promise<WebSiteStatus> {
    try {
      const response = await this.request("/v1/web-sites/branding", credential.receiveToken, "PATCH", input, true);
      if (response.status === 403) throw new Error("El sitio está pausado o tiene un diseño personalizado. Actualizá el estado antes de publicar.");
      if ([400, 413].includes(response.status) && input.bannerDataUrl !== undefined) throw new Error("El servicio no aceptó la portada. Verificá que admita banners y volvé a intentar.");
      if (!response.ok) throw new Error(response.status === 409 ? "La identidad no pudo actualizarse; recargá y probá nuevamente." : "No se pudo guardar la identidad de la tienda web.");
      const metadata = await parseMetadata(response);
      if (input.bannerDataUrl !== undefined && metadata.bannerDataUrl !== input.bannerDataUrl) throw new Error("El servicio no confirmó el cambio de portada. Volvé a consultar el estado.");
      if ((input.logoDataUrl !== undefined && metadata.logoDataUrl !== input.logoDataUrl) ||
          (input.productPhoto !== undefined && metadata.logoDataUrl === undefined)) throw new Error("El servicio no confirmó los cambios de imágenes. Actualizá el servicio y revisá la carta.");
      this.applyMetadata(metadata); this.lastReconciledAt = this.now(); await this.persist(); return this.status();
    } catch (error) {
      if (error instanceof Error && /diseño personalizado|identidad no pudo|^El servicio no/.test(error.message)) throw error;
      throw new Error("No se pudo guardar la identidad de la tienda web.");
    }
  }

  private editorCredential(): Credential {
    if (!this.credential || this.credentialInvalid || this.data.status.state !== "ACTIVE" || this.data.status.designMode !== "STANDARD") throw new Error("Se necesita una tienda activa con diseño estándar.");
    return this.credential;
  }
  async getProductPhoto(productRef: string): Promise<WebProductPhoto> {
    if (!validRef(productRef)) throw new Error("Producto no válido.");
    const response = await this.request("/v1/web-sites/product-photo/" + encodeURIComponent(productRef), this.editorCredential().receiveToken, "GET", undefined, true);
    if (!response.ok) throw new Error("No se pudo consultar la foto web. Verificá la conexión y la versión del servicio.");
    const photo = await response.json();
    if (!hasExactKeys(photo, ["productRef","dataUrl"]) || photo.productRef !== productRef || !validPhoto(photo)) throw new Error("El servicio no devolvió una foto válida.");
    return {productRef, dataUrl: photo.dataUrl};
  }

  async createMobilePreview(input: WebSitePreviewDraft): Promise<{url:string;expiresAt:string}> {
    const credential = this.editorCredential();
    const {url,slug} = this.status();
    if (!url || !slug || !validStorefrontUrl(url,slug)) throw new Error("La tienda no tiene una dirección válida.");
    // Paid and trial sites on our hosted service always use this exact tenant hostname.
    // An explicitly configured pilot may have its own domain, selected by its provisioner.
    if (new URL(this.baseUrl).hostname === "pedidos.deltanubeweb.com" &&
        url !== `https://${slug}.deltanubeweb.com` && url !== `https://${slug}.deltanubeweb.com/`) {
      throw new Error("La dirección de la vista previa no corresponde a la tienda.");
    }
    if (!hasExactKeys(input, ["displayName","tagline","accent","bannerDataUrl","logoDataUrl","product"]) ||
        typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.length > 80 ||
        typeof input.tagline !== "string" || input.tagline.length > 160 || !/^#[0-9a-f]{6}$/i.test(input.accent) ||
        !validCover(input.bannerDataUrl) || !validCover(input.logoDataUrl,96*1024) ||
        (input.product !== null && (!hasExactKeys(input.product,["productRef","name","category","priceMinor","photoDataUrl"]) ||
          !validRef(input.product.productRef) ||
          typeof input.product.name !== "string" || input.product.name.length > 120 || typeof input.product.category !== "string" || input.product.category.length > 80 ||
          !Number.isSafeInteger(input.product.priceMinor) || input.product.priceMinor < 0 || !validCover(input.product.photoDataUrl,160*1024)))) throw new Error("No se pudo validar la vista previa.");
    const response = await this.request("/v1/web-sites/mobile-preview",credential.receiveToken,"POST",input,true);
    if (!response.ok) throw new Error("No se pudo crear la vista privada. Revisá tu conexión y la versión del servicio.");
    const result = await response.json();
    if (!hasExactKeys(result,["token","expiresAt"]) || typeof result.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.token) || typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error("Enlace de prueba no válido.");
    return {url: new URL("/vista-previa#" + result.token, url).href, expiresAt: result.expiresAt};
  }

  private async performProvision(ticket: string, signup: Signup): Promise<WebSiteStatus> {
    try {
      const response = await this.request("/v1/web-sites", ticket, "POST", signup);
      if (response.status === 409) {
        this.terminalSignupError = true;
        this.data.status = { ...this.data.status, state: "ERROR", message: "Ese enlace ya está ocupado. Elegí otro nombre para la tienda." };
        await this.persist(); return this.status();
      }
      if (!response.ok) throw new Error("provisioning failed");
      const body = await response.json() as any;
      if (!hasExactKeys(body, ["storeId", "slug", "url", "receiveToken", "displayName", "tagline", "accent", "designMode"]) || !validCredential({ storeId: body.storeId, receiveToken: body.receiveToken }) || !validDnsSlug(body.slug) || typeof body.url !== "string" || !validStorefrontUrl(body.url, body.slug)) throw new Error("invalid provisioning response");
      const metadata = validateMetadata({ displayName: body.displayName, tagline: body.tagline, accent: body.accent, designMode: body.designMode });
      const credential = { storeId: body.storeId as string, receiveToken: body.receiveToken as string };
      this.credential = credential;
      this.data.encryptedCredential = this.encrypt(JSON.stringify(credential));
      this.data.encryptedSignup = null; this.signup = null;
      this.data.status = { state: "ACTIVE", slug: body.slug, url: body.url, ...metadata, message: "Tienda web lista" };
      this.configureSync(credential); this.options.onConfigured?.(credential, this.baseUrl);
      // A retried signup can bind an existing shop. Its legacy-compatible signup
      // envelope deliberately omits the image; reconcile on the next status read.
      this.lastReconciledAt = 0; await this.persist();
    } catch {
      this.data.status = { ...this.data.status, state: "ERROR", message: "No se pudo completar la tienda; se reintentará automáticamente" };
      await this.persist().catch(() => undefined);
    }
    return this.status();
  }

  private async reconcile(): Promise<WebSiteStatus> {
    try {
      const response = await this.request("/v1/web-sites/branding", this.credential!.receiveToken, "GET", undefined, true);
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) this.data.status = { ...this.data.status, state: "ERROR", message: "No se pudo validar el estado actual de la tienda." };
        throw new Error("reconcile failed");
      }
      const metadata = await parseMetadata(response);
      this.applyMetadata(metadata); await this.persist();
    } catch { /* keep last known canonical metadata; no token/error detail to renderer */ }
    this.lastReconciledAt = this.now();
    return this.status();
  }
  private applyMetadata(metadata: ReturnType<typeof validateMetadata>) { this.data.status = { ...this.data.status, ...metadata, state: "ACTIVE", message: "Tienda web configurada" }; }
  private async request(path: string, bearer: string, method: string, body?: unknown, installation = false) {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = { authorization: `Bearer ${bearer}`, "content-type": "application/json" };
    if (installation) { const id = this.options.installationId(); if (!id) throw new Error("installation unavailable"); headers["x-pos-installation"] = id; }
    if (path === "/v1/web-sites/branding") { headers["x-web-site-banner"] = "1"; headers["x-web-site-media"] = "1"; }
    return this.fetcher(url, { method, redirect: "error", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(method === "PATCH" || path === "/v1/web-sites/mobile-preview" ? 20_000 : 5000) });
  }
  private encrypt(value: string) { if (this.storage.isAvailable?.() === false) throw new Error("secure storage unavailable"); return this.storage.encryptString(value).toString("base64"); }
  private hasManualCommerceConfig() { return !!(this.env.GASTRONOMY_WEB_ORDERS_URL || this.env.GASTRONOMY_WEB_ORDERS_TOKEN || this.env.GASTRONOMY_WEB_ORDERS_STORE_ID); }
  private configureSync(credential: Credential) {
    const manual = this.env.GASTRONOMY_WEB_ORDERS_URL || this.env.GASTRONOMY_WEB_ORDERS_TOKEN || this.env.GASTRONOMY_WEB_ORDERS_STORE_ID;
    if (manual) return;
    this.env.GASTRONOMY_WEB_ORDERS_URL = this.baseUrl;
    this.env.GASTRONOMY_WEB_ORDERS_TOKEN = credential.receiveToken;
    this.env.GASTRONOMY_WEB_ORDERS_STORE_ID = credential.storeId;
  }
  private async persist() { await mkdir(dirname(this.file), { recursive: true }); const temp = `${this.file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(this.data), { mode: 0o600 }); await rename(temp, this.file); }
}
function validBaseUrl(value: string) { try { const u = new URL(value); return !u.username && !u.password && !u.search && !u.hash && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))); } catch { return false; } }
function validCredential(value: any): value is Credential { return !!value && /^[A-Za-z0-9_-]{1,64}$/.test(value.storeId) && /^[A-Za-z0-9_-]{43,128}$/.test(value.receiveToken); }
function validDnsSlug(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value); }
function validStorefrontUrl(value: string, slug: string) { try { const u = new URL(value); const labels = u.hostname.toLowerCase().split("."); return u.protocol === "https:" && !u.username && !u.password && !u.port && u.pathname === "/" && !u.search && !u.hash && labels.length >= 3 && labels[0] === slug && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)); } catch { return false; } }
function validateMetadata(value: any) {
  const keys = ["displayName", "tagline", "accent", "designMode"];
  const banner = value?.bannerDataUrl;
  const logo = value?.logoDataUrl;
  if (logo !== undefined) { if(!validCover(logo,96*1024)) throw new Error("invalid branding response"); keys.push("logoDataUrl"); }
  if (banner !== undefined) keys.push("bannerDataUrl");
  if (!hasExactKeys(value, keys) || (banner !== undefined && !validCover(banner)) || typeof value.displayName !== "string" || value.displayName.length > 120 || typeof value.tagline !== "string" || value.tagline.length > 240 || typeof value.accent !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(value.accent) || !["STANDARD", "CUSTOM"].includes(value.designMode)) throw new Error("invalid branding response");
  return { displayName: value.displayName, tagline: value.tagline, accent: value.accent, designMode: value.designMode as "STANDARD" | "CUSTOM", bannerDataUrl: banner as string | null | undefined, logoDataUrl: logo as string | null | undefined };
}
async function parseMetadata(response: Response) { return validateMetadata(await response.json()); }
function hasExactKeys(value: any, keys: string[]) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
