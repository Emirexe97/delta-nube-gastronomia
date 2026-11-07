/** Outbound-only terminal connection. No POS listener, no receive credential in the QR. */
export type RelayRequest = {
  requestId: string;
  kind: "pair" | "rpc";
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
  expiresAt: string | number;
};
type Reply = { result: unknown } | { error: { code: string; message: string } };
type Config = {
  origin: string;
  publicOrigin?: string;
  storeId: string;
  installation: string;
  token: string;
};

export function waiterRelayConfig(
  env: NodeJS.ProcessEnv,
  installation?: string,
): Config | null {
  try {
    const u = new URL(env.GASTRONOMY_WEB_ORDERS_URL ?? "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (
      u.username ||
      u.password ||
      u.hash ||
      u.search ||
      u.pathname !== "/" ||
      !(u.protocol === "https:" || (loopback && u.protocol === "http:"))
    )
      return null;
    const token = env.GASTRONOMY_WEB_ORDERS_TOKEN ?? "";
    const storeId = env.GASTRONOMY_WEB_ORDERS_STORE_ID ?? "";
    if (
      !/^[\w-]{43,128}$/.test(token) ||
      !/^[\w-]{1,64}$/.test(storeId) ||
      !installation ||
      !/^[\w-]{1,128}$/.test(installation)
    )
      return null;
    // Explicitly configured mobile entry point, never a URL supplied by the relay response.
    // Allows a private loopback connector plus a separate HTTPS ingress in a local pilot.
    const publicUrl = env.GASTRONOMY_WAITER_PUBLIC_URL;
    if (publicUrl) {
      const p = new URL(publicUrl);
      if (p.protocol !== "https:" || p.username || p.password || p.hash || p.search || p.pathname !== "/") return null;
      return { origin: u.origin, publicOrigin: p.origin, storeId, installation, token };
    }
    return { origin: u.origin, storeId, installation, token };
  } catch {
    return null;
  }
}

type Options = {
  config(): Config | null;
  /** Present only in shift-aware desktops; null is an explicitly closed cash. */
  cashSessionId?(): string | null;
  process(request: RelayRequest): Promise<unknown>;
  fetch?: typeof fetch;
  now?: () => number;
};
export function createWaiterRelay(options: Options) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let activeUntil = 0,
    running = false,
    epoch = 0,
    backoff = 0;
  let connectionError: string | null = null;
  // Retain completed responses until acknowledgement: never re-execute pairing or print on a lost ACK.
  const replies = new Map<string, { until: number; reply: Reply }>();
  async function request(config: Config, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await fetcher(new URL(path, config.origin), {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: "Bearer " + config.token,
        "x-pos-installation": config.installation,
        "x-expected-store-id": config.storeId,
        ...extraHeaders,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok)
      throw new Error(
        res.status === 401 || res.status === 403
          ? "El conector no está autorizado para esta caja."
          : "No se pudo conectar al servicio de mozos. Revisá Internet y la configuración del servicio.",
      );
    return res.status === 204 ? {} : await res.json();
  }
  return {
    configured: () => !!options.config(),
    connectionError: () => connectionError,
    reset() {
      ++epoch;
      activeUntil = 0;
      backoff = 0;
      replies.clear();
      connectionError = null;
    },
    wake() {
      activeUntil = now() + 18 * 60_000;
    },
    async invite(
      challengeId: string,
    ): Promise<{ url: string; expiresAt: string }> {
      const config = options.config();
      if (!config)
        throw new Error("Configurá el conector seguro de esta instalación.");
      const value = await request(config, "/v1/waiter/invitations", {
        challengeId,
      });
      if (
        value.challengeId !== challengeId ||
        !Number.isFinite(Date.parse(value.expiresAt))
      )
        throw new Error("El servicio devolvió una invitación inválida.");
      const url = new URL("/waiter", config.publicOrigin ?? config.origin);
      url.hash = new URLSearchParams({
        tenant: config.storeId,
        terminal: config.installation,
        challenge: challengeId,
      }).toString();
      activeUntil = now() + 18 * 60_000;
      connectionError = null;
      backoff = 0;
      return {
        url: url.href,
        expiresAt: new Date(value.expiresAt).toISOString(),
      };
    },
    async tick() {
      const config = options.config(),
        generation = epoch;
      if (running || !config || now() < backoff) return;
      running = true;
      try {
        const cashSessionId = options.cashSessionId?.();
        // Keep serving an open shift, even after 18 minutes or a PC restart.
        // The short tail also reports closure and drains already queued replies.
        if (cashSessionId) activeUntil = now() + 120_000;
        if (now() >= activeUntil) return;
        for (const [id, v] of replies) if (v.until <= now()) replies.delete(id);
        const { requests } = await request(
          config,
          "/v1/waiter/terminal/requests",
          undefined,
          options.cashSessionId ? { "x-pos-cash-session": cashSessionId ?? "" } : {},
        );
        if (!Array.isArray(requests)) throw new Error("Respuesta inválida");
        for (const req of requests.slice(0, 32) as RelayRequest[]) {
          if (epoch !== generation) return;
          if (!req || !/^[a-zA-Z0-9_-]{8,128}$/.test(req.requestId)) continue;
          const until =
            typeof req.expiresAt === "number"
              ? req.expiresAt
              : Date.parse(req.expiresAt);
          if (!Number.isFinite(until) || until <= now()) continue;
          const key = [config.storeId, config.installation, req.requestId].join(
            ":",
          );
          let cached = replies.get(key);
          if (!cached) {
            let reply: Reply;
            try {
              reply = { result: await options.process(req) };
              if (Buffer.byteLength(JSON.stringify(reply)) > 512 * 1024) {
                reply = {
                  error: {
                    code: "response_too_large",
                    message:
                      "El menú supera el tamaño admitido en el teléfono. Usá la caja para este pedido.",
                  },
                };
              }
            } catch (e) {
              // Only known application errors cross the public relay; never send a stack, SQL, or an arbitrary exception.
              reply =
                e instanceof WaiterRequestError
                  ? {
                      error: { code: e.code, message: e.message.slice(0, 160) },
                    }
                  : {
                      error: {
                        code: "pos_unavailable",
                        message:
                          "No se pudo completar la operación en caja. Consultá la tanda antes de volver a enviarla.",
                      },
                    };
            }
            cached = { until: Math.min(until, now() + 120_000), reply };
            replies.set(key, cached);
          }
          if (epoch !== generation) return;
          await request(
            config,
            "/v1/waiter/terminal/requests/" +
              encodeURIComponent(req.requestId) +
              "/response",
            cached.reply,
          );
          replies.delete(key);
        }
        connectionError = null;
      } catch {
        connectionError =
          "Caja sin comunicación con el servicio de mozos. Revisá Internet.";
        backoff = now() + 3000;
      } finally {
        running = false;
      }
    },
  };
}
export class WaiterRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
