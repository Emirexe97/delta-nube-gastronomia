import { createHash } from "node:crypto";
import {
  WebOrdersClient,
  type WebCatalogSnapshot,
  type WebOrderRecord,
} from "@gastronomy/web-orders";
import type { WebSyncStatus } from "@gastronomy/contracts";

const PAGE_SIZE = 50;
const MAX_PAGES_PER_TICK = 5;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface WebCommerceRepository {
  getWebCommerceCatalogSnapshot(): WebCatalogSnapshot;
  getWebOrderCursor(storeId: string): number;
  /** Must persist the order and advance its cursor atomically. */
  ingestWebOrder(storeId: string, record: WebOrderRecord): void;
  listWebPendingAcks(storeId: string): string[];
  markWebOrderAcked(storeId: string, id: string): void;
}

export interface WebCommerceSyncOptions {
  getRepository: () => WebCommerceRepository;
  env?: NodeJS.ProcessEnv;
  getInstallationId?: () => string | undefined;
  /** Optional hard stop for every sync entry point. Defaults to enabled. */
  isEnabled?: () => boolean;
  makeClient?: (
    url: string,
    token: string,
    installationId?: string,
  ) => WebOrdersClient;
  now?: () => number;
}

/** Main-process worker only. Call run from the main process scheduler; no timers are created here. */
export function createWebCommerceSync(options: WebCommerceSyncOptions) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const enabled = () => options.isEnabled?.() !== false;
  let inFlight: Promise<WebSyncStatus> | null = null;
  let lastCatalogHash: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastError: string | null = null;
  let nextRetryAt = 0;
  let failures = 0;
  let publishedStore: string | null = null;
  let catalogGeneration = 0;
  let catalogDirty = true;

  const config = () => ({
    url: env.GASTRONOMY_WEB_ORDERS_URL?.trim() ?? "",
    token: env.GASTRONOMY_WEB_ORDERS_TOKEN?.trim() ?? "",
    storeId: env.GASTRONOMY_WEB_ORDERS_STORE_ID?.trim() ?? "",
  });
  const configured = () => {
    if (!enabled()) return false;
    const { url, token, storeId } = config();
    if (
      !/^[A-Za-z0-9_-]{43,128}$/.test(token) ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(storeId)
    )
      return false;
    try {
      const parsed = new URL(url);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
        parsed.hostname,
      );
      return (
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        (parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && loopback))
      );
    } catch {
      return false;
    }
  };
  const status = (includeRunning = true): WebSyncStatus => {
    if (!configured())
      return {
        state: "UNCONFIGURED",
        lastSyncedAt: null,
        message: "Conector web sin configurar",
      };
    if (includeRunning && inFlight)
      return {
        state: "SYNCING",
        lastSyncedAt: lastSuccessAt,
        message: "Sincronizando",
      };
    if (lastError)
      return {
        state: "ERROR",
        lastSyncedAt: lastSuccessAt,
        message: "No se pudo sincronizar; se reintentará automáticamente",
      };
    return {
      state: lastSuccessAt && !catalogDirty ? "SYNCED" : "PENDING",
      lastSyncedAt: lastSuccessAt,
      message:
        lastSuccessAt && !catalogDirty
          ? "Sincronización al día"
          : "Pendiente de sincronización",
    };
  };

  async function execute(): Promise<WebSyncStatus> {
    if (!enabled()) return { state: "UNCONFIGURED", lastSyncedAt: null, message: "Sincronización web deshabilitada para este perfil" };
    const { url, token, storeId } = config();
    if (!configured()) {
      lastError = "Conector web sin configurar";
      return status(false);
    }
    if (nextRetryAt > now()) return status(false);
    lastError = null;
    try {
      const installationId = options.getInstallationId?.();
      const client = (
        options.makeClient ??
        ((base, secret, id) => new WebOrdersClient(base, secret, id))
      )(url, token, installationId);
      const repository = options.getRepository(); // lazy: don't open the DB until explicitly configured and due

      // Publish before polling. A publish failure does not prevent inbound orders from being persisted.
      const generation = catalogGeneration;
      try {
        const snapshot = repository.getWebCommerceCatalogSnapshot();
        const hash = createHash("sha256")
          .update(JSON.stringify(snapshot))
          .digest("hex");
        if (
          catalogDirty ||
          publishedStore !== storeId ||
          lastCatalogHash !== hash
        ) {
          await client.publishCatalog(snapshot, storeId);
          if (generation === catalogGeneration) {
            lastCatalogHash = hash;
            publishedStore = storeId;
            catalogDirty = false;
          }
        }
      } catch {
        lastError = "No se pudo publicar el catálogo";
      }

      // Re-attempt unacknowledged durable records before fetching newer pages.
      try {
        for (const id of repository
          .listWebPendingAcks(storeId)
          .slice(0, PAGE_SIZE * MAX_PAGES_PER_TICK)) {
          const acknowledged = await client.acknowledgeReceived(id, storeId);
          if (acknowledged.storeId !== storeId)
            throw new Error("La orden recibida pertenece a otra tienda");
          repository.markWebOrderAcked(storeId, id);
        }

        let cursor = repository.getWebOrderCursor(storeId);
        for (
          let pageNumber = 0;
          pageNumber < MAX_PAGES_PER_TICK;
          pageNumber++
        ) {
          const page = await client.list(cursor, PAGE_SIZE, storeId);
          for (const order of page.orders) {
            if (order.storeId !== storeId)
              throw new Error("La orden recibida pertenece a otra tienda");
            repository.ingestWebOrder(storeId, order);
            if (order.receivedAt != null) continue;
            // ingestWebOrder commits order+cursor before any remote acknowledgement.
            const acknowledged = await client.acknowledgeReceived(
              order.id,
              storeId,
            );
            if (acknowledged.storeId !== storeId)
              throw new Error("La orden recibida pertenece a otra tienda");
            repository.markWebOrderAcked(storeId, order.id);
          }
          cursor = page.nextCursor;
          if (!page.hasMore || page.orders.length === 0) break;
        }
      } catch {
        lastError = "No se pudieron recibir los pedidos web";
      }
      if (lastError) throw new Error("sync failed");
      failures = 0;
      nextRetryAt = 0;
      lastError = null;
      lastSuccessAt = new Date(now()).toISOString();
    } catch (error) {
      failures++;
      nextRetryAt =
        now() +
        Math.min(1_000 * 2 ** Math.min(failures - 1, 8), MAX_BACKOFF_MS);
      lastError =
        error instanceof Error
          ? error.message.slice(0, 240)
          : "Error de sincronización";
    }
    return status(false);
  }

  return {
    run(force = false): Promise<WebSyncStatus> {
      if (inFlight) return inFlight;
      if (force) nextRetryAt = 0;
      const promise = execute();
      inFlight = promise;
      void promise.finally(() => {
        if (inFlight === promise) inFlight = null;
      });
      return promise;
    },
    status,
    getStoreId(): string | null {
      return enabled() && configured() ? config().storeId : null;
    },
    invalidate(): void {
      catalogGeneration++;
      lastCatalogHash = null;
      publishedStore = null;
      catalogDirty = true;
    },
  };
}
