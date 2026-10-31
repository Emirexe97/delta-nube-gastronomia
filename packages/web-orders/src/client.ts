import {
  parseWebOrderRecord,
  parseWebOrderSubmission,
  WebOrderValidationError,
  type CreateWebOrderResult,
  type WebOrderPage,
  type WebOrderRecord,
  type WebOrderSubmission,
} from "./index.js";

export class WebOrdersHttpError extends Error {
  constructor(readonly status: number) {
    super(`Web orders HTTP ${status}`);
    this.name = "WebOrdersHttpError";
  }
}

/** Use only from site backends or the POS main process, never public browser JS. */
export class WebOrdersClient {
  private readonly baseUrl: URL;
  constructor(
    baseUrl: string,
    private readonly token: string,
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
    url.pathname = url.pathname.replace(/\/$/, "") + "/";
    this.baseUrl = url;
  }

  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new WebOrdersHttpError(response.status);
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
  ): Promise<CreateWebOrderResult> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      throw new WebOrderValidationError("Idempotency-Key inválida");
    const data = (await this.request(
      "v1/web-orders",
      "POST",
      parseWebOrderSubmission(submission),
      idempotencyKey,
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

  /** Persist each returned order and its cursor locally BEFORE acknowledging it. */
  async list(after = 0, limit = 50): Promise<WebOrderPage> {
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

  async acknowledgeReceived(id: string): Promise<WebOrderRecord> {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
      throw new WebOrderValidationError("ID inválido");
    const data = (await this.request(
      `v1/web-orders/${id}/received`,
      "POST",
    )) as Record<string, unknown>;
    const order = parseWebOrderRecord(data?.order);
    if (order.id !== id || order.receivedAt === null)
      throw new WebOrderValidationError("Acuse inválido");
    return order;
  }
}
