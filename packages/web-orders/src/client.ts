import {
  parseWebOrderRecord,
  parseWebOrderSubmission,
  WebOrderValidationError,
  type CreateWebOrderResult,
  type WebOrderPage,
  type WebOrderRecord,
  type WebOrderSubmission,
  parseWebCatalogSnapshot,
  type WebCatalogSnapshot,
} from "./index.js";

export class WebOrdersHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`Web orders HTTP ${status}${code ? `: ${code}` : ""}`);
    this.name = "WebOrdersHttpError";
  }
}

/** Use only from site backends or the POS main process, never public browser JS. */
export class WebOrdersClient {
  private readonly baseUrl: URL;
  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly installationId?: string,
  ) {
    const url = new URL(baseUrl);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new WebOrderValidationError(
        "Usá HTTPS, sin credenciales ni query en la URL; HTTP sólo en loopback.",
      );
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token))
      throw new WebOrderValidationError("Token inválido");
    if (
      installationId !== undefined &&
      !/^[A-Za-z0-9_-]{1,128}$/.test(installationId)
    )
      throw new WebOrderValidationError("ID de instalación inválido");
    url.pathname = url.pathname.replace(/\/$/, "") + "/";
    this.baseUrl = url;
  }

  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    idempotencyKey?: string,
    expectedStoreId?: string,
    requirePublishedCatalog = false,
    expectedSiteId?: string,
  ): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(expectedStoreId ? { "x-expected-store-id": expectedStoreId } : {}),
        ...(this.installationId
          ? { "x-pos-installation": this.installationId }
          : {}),
        ...(requirePublishedCatalog
          ? { "x-require-published-catalog": "true" }
          : {}),
        ...(expectedSiteId ? { "x-expected-site-id": expectedSiteId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      let errorText = "";
      try {
        const reader = response.body?.getReader();
        if (reader) {
          const part = await reader.read();
          if (part.value && part.value.byteLength <= 4096)
            errorText = new TextDecoder().decode(part.value);
          await reader.cancel();
        }
      } catch {}
      let code: string | undefined;
      if (errorText.length <= 4096) {
        try {
          const parsed = JSON.parse(errorText) as { error?: unknown };
          if (typeof parsed.error === "string") code = parsed.error;
        } catch {}
      }
      throw new WebOrdersHttpError(response.status, code);
    }
    // Consume under a hard bound, including chunked responses from a bad proxy.
    const reader = response.body?.getReader();
    if (!reader) throw new WebOrderValidationError("Respuesta vacía");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new WebOrderValidationError("Respuesta demasiado grande");
      }
      chunks.push(part.value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(data));
  }

  async submit(
    submission: WebOrderSubmission,
    idempotencyKey: string,
    options: {
      requirePublishedCatalog?: boolean;
      expectedStoreId?: string;
      expectedSiteId?: string;
    } = {},
  ): Promise<CreateWebOrderResult> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      throw new WebOrderValidationError("Idempotency-Key inválida");
    if (
      options.expectedStoreId !== undefined &&
      !/^[A-Za-z0-9_-]{1,64}$/.test(options.expectedStoreId)
    )
      throw new WebOrderValidationError("Store ID inválido");
    if (
      options.expectedSiteId !== undefined &&
      !/^[A-Za-z0-9_-]{1,64}$/.test(options.expectedSiteId)
    )
      throw new WebOrderValidationError("Site ID inválido");
    const data = (await this.request(
      "v1/web-orders",
      "POST",
      parseWebOrderSubmission(submission),
      idempotencyKey,
      options.expectedStoreId,
      options.requirePublishedCatalog === true,
      options.expectedSiteId,
    )) as Record<string, unknown>;
    const order = parseWebOrderRecord(data?.order);
    const url = new URL(String(data?.whatsappUrl));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "wa.me" ||
      url.username ||
      url.password ||
      url.port
    )
      throw new WebOrderValidationError("Enlace de WhatsApp inválido");
    return { order, whatsappUrl: url.toString() };
  }

  /** Publish from a trusted backend/POS using the commerce receive token. */
  async publishCatalog(
    snapshot: WebCatalogSnapshot,
    expectedStoreId: string,
  ): Promise<{ revision: number }> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(expectedStoreId))
      throw new WebOrderValidationError("Store ID inválido");
    const data = (await this.request(
      "v1/web-catalog",
      "PUT",
      parseWebCatalogSnapshot(snapshot),
      undefined,
      expectedStoreId,
    )) as Record<string, unknown>;
    if (!Number.isSafeInteger(data?.revision) || Number(data.revision) < 1)
      throw new WebOrderValidationError("Versión de catálogo inválida");
    return { revision: Number(data.revision) };
  }

  /** Fetch the current commerce snapshot from a site backend using its submit token. */
  async getCatalog(expected?: {
    storeId?: string;
    siteId?: string;
  }): Promise<{
    snapshot: WebCatalogSnapshot;
    revision: number;
    updatedAt: string;
  }> {
    if (
      expected?.storeId !== undefined &&
      !/^[A-Za-z0-9_-]{1,64}$/.test(expected.storeId)
    )
      throw new WebOrderValidationError("Store ID inválido");
    if (
      expected?.siteId !== undefined &&
      !/^[A-Za-z0-9_-]{1,64}$/.test(expected.siteId)
    )
      throw new WebOrderValidationError("Site ID inválido");
    const data = (await this.request(
      "v1/web-catalog",
      "GET",
      undefined,
      undefined,
      expected?.storeId,
      false,
      expected?.siteId,
    )) as Record<string, unknown>;
    if (
      !Number.isSafeInteger(data?.revision) ||
      Number(data.revision) < 1 ||
      typeof data?.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(data.updatedAt))
    )
      throw new WebOrderValidationError("Respuesta de catálogo inválida");
    return {
      snapshot: parseWebCatalogSnapshot(data.snapshot),
      revision: Number(data.revision),
      updatedAt: data.updatedAt,
    };
  }

  /** Persist each returned order and its cursor locally BEFORE acknowledging it. */
  async list(
    after = 0,
    limit = 50,
    expectedStoreId?: string,
  ): Promise<WebOrderPage> {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new WebOrderValidationError("Cursor/límite inválido");
    const data = (await this.request(
      `v1/web-orders?after=${after}&limit=${limit}`,
      "GET",
      undefined,
      undefined,
      expectedStoreId,
    )) as Record<string, unknown>;
    if (
      !data ||
      !Array.isArray(data.orders) ||
      data.orders.length > limit ||
      typeof data.hasMore !== "boolean"
    )
      throw new WebOrderValidationError("Página inválida");
    const orders = data.orders.map(parseWebOrderRecord);
    let previous = after;
    for (const order of orders) {
      if (order.sequence <= previous)
        throw new WebOrderValidationError("Secuencia inválida");
      previous = order.sequence;
    }
    if (data.nextCursor !== previous)
      throw new WebOrderValidationError("Cursor de respuesta inválido");
    return { orders, nextCursor: previous, hasMore: data.hasMore };
  }

  async acknowledgeReceived(
    id: string,
    expectedStoreId?: string,
  ): Promise<WebOrderRecord> {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
      throw new WebOrderValidationError("ID inválido");
    const data = (await this.request(
      `v1/web-orders/${id}/received`,
      "POST",
      undefined,
      undefined,
      expectedStoreId,
    )) as Record<string, unknown>;
    const order = parseWebOrderRecord(data?.order);
    if (order.id !== id || order.receivedAt === null)
      throw new WebOrderValidationError("Acuse inválido");
    return order;
  }
}
