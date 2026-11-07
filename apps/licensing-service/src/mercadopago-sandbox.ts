import { createHmac, timingSafeEqual } from "node:crypto";
import { SandboxCreationRejected } from "./sandbox-billing.js";
import type {
  SandboxCharge,
  SandboxGateway,
  SandboxSubscription,
} from "./sandbox-billing.js";

const API = "https://api.mercadopago.com";
const USERS_API = "https://api.mercadolibre.com";
const CHECKOUT_HOST = "www.mercadopago.com.ar";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 256_000;

export type SandboxConfig = {
  enabled?: boolean;
  accessToken: string;
  buyerEmail: string;
  buyerId?: string;
  sellerId?: string;
  backUrl: string;
  notificationUrl?: string;
};

export type SubscriptionInput = {
  externalReference: string;
  reason: string;
  amountArs: number;
  buyerEmail: string;
  backUrl: string;
};

export type WebhookHeaders = {
  xSignature?: string;
  xRequestId?: string;
  dataId?: string;
};

export class MercadoPagoSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercadoPagoSandboxError";
  }
}

/** Explicitly opt-in: production credentials and non-test buyers are rejected before any request. */
export function readSandboxConfig(
  env: NodeJS.ProcessEnv = process.env,
): SandboxConfig {
  if (env.MP_SANDBOX_ENABLED !== "true")
    throw new MercadoPagoSandboxError(
      "Mercado Pago sandbox is not explicitly enabled",
    );
  const accessToken = env.MP_SANDBOX_ACCESS_TOKEN?.trim() ?? "";
  const buyerEmail = env.MP_SANDBOX_BUYER_EMAIL?.trim().toLowerCase() ?? "";
  const buyerId = env.MP_SANDBOX_BUYER_ID?.trim();
  const sellerId = env.MP_SANDBOX_SELLER_ID?.trim();
  if (buyerId !== undefined && !/^[1-9]\d{0,18}$/.test(buyerId))
    throw new MercadoPagoSandboxError("Invalid test buyer ID");
  if (sellerId !== undefined && !/^[1-9]\d{0,18}$/.test(sellerId))
    throw new MercadoPagoSandboxError("Invalid test seller ID");
  if (/^APP_USR-[A-Za-z0-9-]+$/.test(accessToken)) {
    if (!sellerId || !buyerId || sellerId === buyerId)
      throw new MercadoPagoSandboxError(
        "APP_USR sandbox requires distinct explicit seller and buyer IDs",
      );
  } else if (!/^TEST-[A-Za-z0-9-]+$/.test(accessToken))
    throw new MercadoPagoSandboxError(
      "A TEST- or explicitly attested APP_USR credential is required",
    );
  if (!/^[^\s@]+@testuser\.com$/.test(buyerEmail))
    throw new MercadoPagoSandboxError(
      "A Mercado Pago test-buyer email (@testuser.com) is required",
    );
  const backUrl = requireSafeReturnUrl(env.MP_SANDBOX_BACK_URL ?? "");
  const notificationUrl = env.MP_SANDBOX_NOTIFICATION_URL
    ? requireNotificationUrl(env.MP_SANDBOX_NOTIFICATION_URL)
    : undefined;
  return {
    enabled: true,
    accessToken,
    buyerEmail,
    buyerId,
    sellerId,
    backUrl,
    notificationUrl,
  };
}

function requireText(value: string, label: string, max = 256): string {
  const clean = value.trim();
  if (!clean || clean.length > max || /[\r\n]/.test(clean))
    throw new MercadoPagoSandboxError(`Invalid ${label}`);
  return clean;
}

function assertSandboxConfig(config: SandboxConfig): void {
  if (config.enabled !== true)
    throw new MercadoPagoSandboxError(
      "Mercado Pago sandbox requires explicit environment opt-in",
    );
  const testToken = /^TEST-[A-Za-z0-9-]+$/.test(config.accessToken);
  const modernToken = /^APP_USR-[A-Za-z0-9-]+$/.test(config.accessToken);
  if (
    (!testToken && !modernToken) ||
    !/^[^\s@]+@testuser\.com$/i.test(config.buyerEmail)
  )
    throw new MercadoPagoSandboxError(
      "Sandbox gateway requires a supported credential and configured test buyer",
    );
  if (
    modernToken &&
    (!config.sellerId ||
      !config.buyerId ||
      !/^[1-9]\d{0,18}$/.test(config.sellerId) ||
      !/^[1-9]\d{0,18}$/.test(config.buyerId) ||
      config.sellerId === config.buyerId)
  )
    throw new MercadoPagoSandboxError(
      "APP_USR sandbox requires distinct explicit seller and buyer IDs",
    );
  requireSafeReturnUrl(config.backUrl);
}

function requireSafeReturnUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname === CHECKOUT_HOST ||
    url.hostname.endsWith(".mercadopago.com.ar")
  ) {
    throw new MercadoPagoSandboxError(
      "backUrl must be an application HTTPS URL",
    );
  }
  return url.toString();
}

function requireNotificationUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname.endsWith("mercadopago.com.ar")
  )
    throw new MercadoPagoSandboxError(
      "notificationUrl must be an application HTTPS URL",
    );
  return url.toString();
}

async function request<T>(
  config: SandboxConfig,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  assertSandboxConfig(config);
  try {
    await attestModernTestAccounts(config, fetcher);
  } catch (error) {
    if (init.method === "POST" && path === "/preapproval")
      throw new SandboxCreationRejected(
        error instanceof Error
          ? error.message
          : "Sandbox identity check failed",
      );
    throw error;
  }
  return requestAt<T>(config, API, path, init, fetcher);
}

async function requestAt<T>(
  config: SandboxConfig,
  origin: string,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
    throw new MercadoPagoSandboxError("Invalid API path");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(`${origin}${path}`, {
      ...init,
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        "X-scope": "stage",
        ...init.headers,
      },
    });
    if (
      init.method === "POST" &&
      path === "/preapproval" &&
      [400, 401, 403, 422].includes(response.status)
    ) {
      await response.body?.cancel();
      throw new SandboxCreationRejected(
        "Provider refused the test subscription",
      );
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
      throw new MercadoPagoSandboxError("Mercado Pago response exceeded limit");
    if (!response.body)
      throw new MercadoPagoSandboxError("Empty Mercado Pago response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MercadoPagoSandboxError(
          "Mercado Pago response exceeded limit",
        );
      }
      chunks.push(part.value);
    }
    const raw = new TextDecoder().decode(Buffer.concat(chunks));
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new MercadoPagoSandboxError("Invalid Mercado Pago response");
    }
    if (!response.ok)
      throw new MercadoPagoSandboxError(
        `Mercado Pago sandbox request failed (${response.status})`,
      );
    return body as T;
  } catch (error) {
    if (
      error instanceof MercadoPagoSandboxError ||
      error instanceof SandboxCreationRejected
    )
      throw error;
    throw new MercadoPagoSandboxError(
      error instanceof Error && error.name === "AbortError"
        ? "Mercado Pago request timed out"
        : "Mercado Pago request failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function attestModernTestAccounts(
  config: SandboxConfig,
  fetcher: typeof fetch,
): Promise<void> {
  if (!config.accessToken.startsWith("APP_USR-")) return;
  const seller = await requestAt<any>(
    config,
    USERS_API,
    "/users/me",
    {},
    fetcher,
  );
  if (
    String(seller?.id) !== config.sellerId ||
    seller?.site_id !== "MLA" ||
    !Array.isArray(seller?.tags) ||
    !seller.tags.includes("test_user")
  )
    throw new MercadoPagoSandboxError(
      "Configured seller is not attested as the expected Argentina test user",
    );
  const buyer = await requestAt<any>(
    config,
    USERS_API,
    `/users/${encodeURIComponent(config.buyerId!)}`,
    {},
    fetcher,
  );
  if (
    String(buyer?.id) !== config.buyerId ||
    buyer?.site_id !== "MLA" ||
    !Array.isArray(buyer?.tags) ||
    !buyer.tags.includes("test_user") ||
    (buyer.email && String(buyer.email).toLowerCase() !== config.buyerEmail)
  )
    throw new MercadoPagoSandboxError(
      "Configured buyer is not attested as the expected Argentina test user",
    );
}

export async function createPendingSubscription(
  config: SandboxConfig,
  input: SubscriptionInput,
  fetcher: typeof fetch = fetch,
) {
  if (input.buyerEmail.trim().toLowerCase() !== config.buyerEmail)
    throw new MercadoPagoSandboxError(
      "Only the configured test buyer is allowed",
    );
  toCents(input.amountArs);
  const result = await request<any>(
    config,
    "/preapproval",
    {
      method: "POST",
      body: JSON.stringify({
        reason: requireText(input.reason, "reason", 120),
        external_reference: requireText(
          input.externalReference,
          "external reference",
          128,
        ),
        payer_email: config.buyerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: input.amountArs,
          currency_id: "ARS",
        },
        back_url: requireSafeReturnUrl(config.backUrl),
        ...(config.notificationUrl
          ? { notification_url: config.notificationUrl }
          : {}),
        status: "pending",
      }),
    },
    fetcher,
  );
  if (
    result.status !== "pending" ||
    !matchesSubscription(result, input, config)
  )
    throw new MercadoPagoSandboxError(
      "Provider did not confirm the expected pending sandbox subscription",
    );
  if (result.live_mode === true)
    throw new MercadoPagoSandboxError("Provider returned a live subscription");
  const checkout = safeCheckoutUrl(result.init_point);
  if (
    new URL(checkout).searchParams.get("preapproval_id") !== String(result.id)
  )
    throw new MercadoPagoSandboxError(
      "Checkout does not identify the created subscription",
    );
  return {
    id: requireText(String(result.id ?? ""), "subscription id", 128),
    status: "pending" as const,
    checkoutUrl: checkout,
  };
}

function safeCheckoutUrl(value: unknown): string {
  if (typeof value !== "string")
    throw new MercadoPagoSandboxError("Provider checkout URL is missing");
  const url = new URL(value);
  if (
    url.origin !== "https://" + CHECKOUT_HOST ||
    url.pathname !== "/subscriptions/checkout" ||
    url.username ||
    url.password
  )
    throw new MercadoPagoSandboxError(
      "Provider returned an unsupported checkout URL",
    );
  return url.toString();
}

function matchesSubscription(
  row: any,
  expected: SubscriptionInput,
  config: SandboxConfig,
): boolean {
  return (
    row?.external_reference === expected.externalReference &&
    matchesTestBuyer(row, config) &&
    row?.auto_recurring?.currency_id === "ARS" &&
    Number(row?.auto_recurring?.transaction_amount) === expected.amountArs &&
    row?.auto_recurring?.frequency === 1 &&
    row?.auto_recurring?.frequency_type === "months"
  );
}

// The API reference shows payer_id instead of payer_email in some preapproval
// responses. Match the configured test account ID; never guess from business data.
function matchesTestBuyer(row: any, config: SandboxConfig): boolean {
  if (
    row?.payer_email &&
    String(row.payer_email).toLowerCase() !== config.buyerEmail
  )
    return false;
  if (
    row?.payer_id &&
    config.buyerId &&
    String(row.payer_id) !== config.buyerId
  )
    return false;
  if (config.sellerId && String(row?.collector_id) !== config.sellerId)
    return false;
  const exactId = config.buyerId && String(row?.payer_id) === config.buyerId;
  const pendingEmail =
    row?.status === "pending" &&
    String(row?.payer_email ?? "").toLowerCase() === config.buyerEmail;
  return config.accessToken.startsWith("APP_USR-")
    ? Boolean(exactId || pendingEmail)
    : Boolean(row?.payer_email || (config.buyerId && exactId));
}

export async function getSubscription(
  config: SandboxConfig,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const row = await request<any>(
    config,
    `/preapproval/${encodeURIComponent(requireText(id, "subscription id", 128))}`,
    {},
    fetcher,
  );
  if (String(row?.id) !== id)
    throw new MercadoPagoSandboxError("Subscription ID mismatch");
  return row;
}

function normalizedSubscription(row: any, config: SandboxConfig) {
  const states: Record<
    string,
    "PENDING" | "AUTHORIZED" | "PAUSED" | "CANCELLED"
  > = Object.assign(Object.create(null), {
    pending: "PENDING",
    authorized: "AUTHORIZED",
    paused: "PAUSED",
    canceled: "CANCELLED",
  });
  if (!Object.hasOwn(states, row.status))
    throw new MercadoPagoSandboxError("Unsupported subscription status");
  if (row.live_mode === true)
    throw new MercadoPagoSandboxError("Provider returned a live subscription");
  if (
    row.auto_recurring?.currency_id !== "ARS" ||
    Number(row.auto_recurring?.frequency) !== 1 ||
    row.auto_recurring?.frequency_type !== "months" ||
    !Number.isFinite(Number(row.auto_recurring?.transaction_amount))
  )
    throw new MercadoPagoSandboxError(
      "Provider returned an unsupported subscription contract",
    );
  if (!matchesTestBuyer(row, config))
    throw new MercadoPagoSandboxError(
      "Provider subscription buyer does not match configured test buyer",
    );
  const checkoutUrl = row.init_point ? safeCheckoutUrl(row.init_point) : null;
  if (
    checkoutUrl &&
    new URL(checkoutUrl).searchParams.get("preapproval_id") !== String(row.id)
  )
    throw new MercadoPagoSandboxError(
      "Checkout does not identify the subscription",
    );
  const status = states[row.status] as SandboxSubscription["status"];
  return {
    id: String(row.id),
    reference: String(row.external_reference ?? ""),
    payerEmail: config.buyerEmail,
    amountCents: toCents(row.auto_recurring.transaction_amount),
    status,
    checkoutUrl,
  } satisfies SandboxSubscription;
}

function toCents(amount: unknown): number {
  const n = Number(amount);
  if (
    !Number.isFinite(n) ||
    n <= 0 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 1e-7
  )
    throw new MercadoPagoSandboxError("Provider returned an invalid amount");
  return Math.round(n * 100);
}

export function createMpGateway(
  config: SandboxConfig,
  fetcher: typeof fetch = fetch,
): SandboxGateway {
  assertSandboxConfig(config);
  return {
    buyerEmail: config.buyerEmail,
    async create(input: {
      reference: string;
      payerEmail: string;
      amountCents: number;
    }) {
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
        throw new MercadoPagoSandboxError(
          "Amount must be positive integer cents",
        );
      const result = await createPendingSubscription(
        config,
        {
          externalReference: input.reference,
          reason: "Suscripción mensual Delta Nube",
          amountArs: input.amountCents / 100,
          buyerEmail: input.payerEmail,
          backUrl: config.backUrl,
        },
        fetcher,
      );
      const row = await getSubscription(config, result.id, fetcher);
      return normalizedSubscription(
        { ...row, init_point: result.checkoutUrl },
        config,
      );
    },
    async getSubscription(id: string) {
      return normalizedSubscription(
        await getSubscription(config, id, fetcher),
        config,
      );
    },
    async cancel(id: string) {
      await cancelSubscription(config, id, fetcher);
      return normalizedSubscription(
        await getSubscription(config, id, fetcher),
        config,
      );
    },
    async getCharge(id: string) {
      const { authorizedPayment, payment } =
        await getAuthorizedPaymentAndPayment(config, id, fetcher);
      const subscription = normalizedSubscription(
        await getSubscription(
          config,
          String(authorizedPayment.preapproval_id),
          fetcher,
        ),
        config,
      );
      if (
        authorizedPayment.external_reference !== subscription.reference ||
        authorizedPayment.currency_id !== "ARS" ||
        toCents(authorizedPayment.transaction_amount) !==
          subscription.amountCents
      )
        throw new MercadoPagoSandboxError(
          "Authorized payment does not match its subscription",
        );
      if (!payment || payment.id == null) {
        const invoiceStatus =
          authorizedPayment.status === "scheduled"
            ? "PENDING"
            : authorizedPayment.status === "rejected"
              ? "REJECTED"
              : ["canceled", "cancelled", "refunded", "charged_back"].includes(
                    authorizedPayment.status,
                  )
                ? "REVERSED"
                : null;
        if (!invoiceStatus)
          throw new MercadoPagoSandboxError(
            "Unsupported authorized-payment state without canonical payment",
          );
        return {
          id: String(authorizedPayment.id),
          subscriptionId: subscription.id,
          reference: String(authorizedPayment.external_reference ?? ""),
          payerEmail: subscription.payerEmail,
          amountCents: toCents(authorizedPayment.transaction_amount),
          currency: authorizedPayment.currency_id,
          paymentId: null,
          status: invoiceStatus,
          debitDate: String(authorizedPayment.debit_date ?? ""),
        } satisfies SandboxCharge;
      }
      const debitTime = Date.parse(authorizedPayment.debit_date);
      const approvedTime = Date.parse(payment.date_approved);
      const validDate =
        Number.isFinite(debitTime) &&
        Number.isFinite(approvedTime) &&
        approvedTime >= debitTime &&
        approvedTime < addOneMonth(debitTime);
      const identityMatches =
        String(payment.id) === String(authorizedPayment.payment.id) &&
        payment.external_reference === authorizedPayment.external_reference &&
        payment.currency_id === authorizedPayment.currency_id &&
        Number(payment.transaction_amount) ===
          Number(authorizedPayment.transaction_amount) &&
        (!config.sellerId ||
          String(payment.collector_id) === config.sellerId) &&
        (!config.buyerId || String(payment.payer?.id) === config.buyerId) &&
        (!payment.payer?.email ||
          String(payment.payer.email).toLowerCase() ===
            subscription.payerEmail);
      if (!identityMatches)
        throw new MercadoPagoSandboxError(
          "Canonical payment does not match its invoice",
        );
      const rawStatus = String(payment.status);
      if (rawStatus === "approved" && !validDate)
        throw new MercadoPagoSandboxError(
          "Payment approval outside billing period",
        );
      const status: SandboxCharge["status"] =
        Number(payment.transaction_amount_refunded ?? 0) > 0
          ? "REVERSED"
          : rawStatus === "approved"
            ? "APPROVED"
            : rawStatus === "rejected"
              ? "REJECTED"
              : ["refunded", "charged_back", "cancelled"].includes(rawStatus)
                ? "REVERSED"
                : "PENDING";
      return {
        id: String(authorizedPayment.id),
        subscriptionId: subscription.id,
        reference: String(authorizedPayment.external_reference ?? ""),
        payerEmail: subscription.payerEmail,
        amountCents: toCents(authorizedPayment.transaction_amount),
        currency: authorizedPayment.currency_id as "ARS",
        paymentId: String(payment.id),
        status,
        debitDate: String(authorizedPayment.debit_date ?? ""),
      } satisfies SandboxCharge;
    },
  };
}

export async function cancelSubscription(
  config: SandboxConfig,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const result = await request<any>(
    config,
    `/preapproval/${encodeURIComponent(requireText(id, "subscription id", 128))}`,
    { method: "PUT", body: JSON.stringify({ status: "canceled" }) },
    fetcher,
  );
  if (result.status !== "canceled" || result.live_mode === true)
    throw new MercadoPagoSandboxError(
      "Provider did not confirm sandbox cancellation",
    );
  return { id: String(result.id), status: "canceled" as const };
}

/** Mercado Pago signature manifest uses URL/query data.id, x-request-id and ts; body is deliberately ignored. */
export function verifyWebhookSignature(
  headers: WebhookHeaders,
  secret: string,
): boolean {
  if (!secret || !headers.xSignature || !headers.xRequestId || !headers.dataId)
    return false;
  const fields = new Map(
    headers.xSignature.split(",").map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? ["", ""]
        : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const ts = fields.get("ts"),
    supplied = fields.get("v1");
  if (
    !ts ||
    !/^\d+$/.test(ts) ||
    Math.abs(Date.now() - Number(ts) * 1000) > 5 * 60_000 ||
    !supplied ||
    !/^[a-f0-9]{64}$/i.test(supplied)
  )
    return false;
  const manifest = `id:${headers.dataId.toLowerCase()};request-id:${headers.xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Retrieve the canonical authorized-payment event, then its referenced canonical payment; no webhook body is trusted. */
export async function getAuthorizedPaymentAndPayment(
  config: SandboxConfig,
  authorizedPaymentId: string,
  fetcher: typeof fetch = fetch,
) {
  const authorized = await request<any>(
    config,
    `/authorized_payments/${encodeURIComponent(requireText(authorizedPaymentId, "authorized payment id", 128))}`,
    {},
    fetcher,
  );
  if (
    !authorized.preapproval_id ||
    String(authorized.id) !== authorizedPaymentId ||
    authorized.live_mode === true
  )
    throw new MercadoPagoSandboxError(
      "Unsupported authorized-payment representation; no entitlement granted",
    );
  const payment = authorized.payment?.id
    ? await request<any>(
        config,
        `/v1/payments/${encodeURIComponent(String(authorized.payment.id))}`,
        {},
        fetcher,
      )
    : null;
  if (payment && payment.live_mode !== false)
    throw new MercadoPagoSandboxError("Payment is not confirmed sandbox data");
  return { authorizedPayment: authorized, payment };
}

function addOneMonth(timestamp: number): number {
  const d = new Date(timestamp);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}
