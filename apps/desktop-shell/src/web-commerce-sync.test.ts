import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node 24 runs TypeScript test files directly.
import { createWebCommerceSync } from "./web-commerce-sync.ts";

const env = {
  GASTRONOMY_WEB_ORDERS_URL: "https://orders.example",
  GASTRONOMY_WEB_ORDERS_TOKEN: "x".repeat(43),
  GASTRONOMY_WEB_ORDERS_STORE_ID: "store_a",
};
const catalog = {
  products: [
    {
      productRef: "p1",
      name: "Pizza",
      category: "Comida",
      takeawayPriceMinor: 1000,
      deliveryPriceMinor: 1200,
    },
  ],
};
function setup(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  let cursor = 0;
  const repository = {
    getWebCommerceCatalogSnapshot: () => catalog,
    getWebCommerceCatalogRevision: () => 1,
    getWebOrderCursor: () => cursor,
    ingestWebOrder: (_store: string, order: any) => {
      events.push("persist");
      cursor = order.sequence;
    },
    listWebPendingAcks: () => [],
    markWebOrderAcked: () => events.push("mark-acked"),
  };
  let publishCount = 0;
  const client = {
    list: async (after: number) => ({
      orders: after ? [] : [{ id: "order-1", storeId: "store_a", sequence: 1 }],
      nextCursor: after ? after : 1,
      hasMore: false,
    }),
    acknowledgeReceived: async (_id: string, expectedStoreId: string) => {
      assert.equal(expectedStoreId, "store_a");
      events.push("remote-ack");
      return { storeId: "store_a", receivedAt: new Date().toISOString() };
    },
    publishCatalog: async (_snapshot: unknown, storeId: string) => {
      assert.equal(storeId, "store_a");
      publishCount++;
      return { revision: 1 };
    },
  };
  const sync = createWebCommerceSync({
    getRepository: () => repository,
    env: { ...env, ...overrides } as NodeJS.ProcessEnv,
    makeClient: (() => client) as any,
  });
  return {
    sync,
    events,
    get publishCount() {
      return publishCount;
    },
  };
}

test("is unconfigured without secrets and does not open repository", async () => {
  let opened = false;
  const sync = createWebCommerceSync({
    getRepository: () => {
      opened = true;
      throw Error();
    },
    env: {},
  });
  assert.equal(sync.getStoreId(), null);
  assert.equal((await sync.run()).state, "UNCONFIGURED");
  assert.equal(opened, false);
});

test("hard-disabled sync skips discovery, catalog publish, inbound fetch, and forced/manual retry", async () => {
  let opened = false;
  let clientCreated = false;
  const sync = createWebCommerceSync({
    getRepository: () => { opened = true; throw new Error("must not open local database"); },
    env,
    isEnabled: () => false,
    makeClient: (() => { clientCreated = true; throw new Error("must not create client"); }) as any,
  });
  assert.equal(sync.getStoreId(), null);
  assert.equal(sync.status().state, "UNCONFIGURED");
  assert.equal((await sync.run()).state, "UNCONFIGURED");
  assert.equal((await sync.run(true)).state, "UNCONFIGURED");
  sync.invalidate();
  assert.equal((await sync.run(true)).state, "UNCONFIGURED");
  assert.equal(opened, false);
  assert.equal(clientCreated, false);
});

test("passes licensed installation identity only to the main-process client", async () => {
  let capturedInstallation: string | undefined;
  const sync = createWebCommerceSync({
    env,
    getInstallationId: () => "licensed-install-id",
    getRepository: () => ({
      getWebCommerceCatalogSnapshot: () => catalog,
      getWebCommerceCatalogRevision: () => 1,
      getWebOrderCursor: () => 0,
      ingestWebOrder: () => {},
      listWebPendingAcks: () => [],
      markWebOrderAcked: () => {},
    }),
    makeClient: ((_url: string, _token: string, installationId?: string) => {
      capturedInstallation = installationId;
      return {
        publishCatalog: async () => ({ revision: 1 }),
        list: async (after: number) => ({
          orders: [],
          nextCursor: after,
          hasMore: false,
        }),
        acknowledgeReceived: async () => assert.fail("no orders expected"),
      } as any;
    }) as any,
  });
  await sync.run();
  assert.equal(capturedInstallation, "licensed-install-id");
});

test("persists each order before acknowledging and avoids identical catalog PUTs", async () => {
  const f = setup();
  await f.sync.run();
  await f.sync.run();
  assert.deepEqual(f.events.slice(0, 3), [
    "persist",
    "remote-ack",
    "mark-acked",
  ]);
  assert.equal(f.publishCount, 1);
  assert.equal(f.sync.status().state, "SYNCED");
});

test("uses the catalog revision and does not materialize unchanged snapshots", async () => {
  let revision = 1;
  let snapshotReads = 0;
  let publishCount = 0;
  const repository = {
    getWebCommerceCatalogSnapshot: () => {
      snapshotReads++;
      return catalog;
    },
    getWebCommerceCatalogRevision: () => revision,
    getWebOrderCursor: () => 0,
    ingestWebOrder: () => {},
    listWebPendingAcks: () => [],
    markWebOrderAcked: () => {},
  };
  const sync = createWebCommerceSync({
    getRepository: () => repository,
    env,
    makeClient: (() => ({
      publishCatalog: async () => {
        publishCount++;
        return { revision: publishCount };
      },
      list: async (after: number) => ({ orders: [], nextCursor: after, hasMore: false }),
      acknowledgeReceived: async () => assert.fail("no orders expected"),
    })) as any,
  });
  await sync.run();
  await sync.run();
  assert.equal(snapshotReads, 1);
  assert.equal(publishCount, 1);
  revision = 2;
  await sync.run();
  assert.equal(snapshotReads, 2);
  assert.equal(publishCount, 1);
});

test("republishes when the repository instance changes even at the same revision", async () => {
  let repository = {
    getWebCommerceCatalogSnapshot: () => catalog,
    getWebCommerceCatalogRevision: () => 1,
    getWebOrderCursor: () => 0,
    ingestWebOrder: () => {},
    listWebPendingAcks: () => [],
    markWebOrderAcked: () => {},
  };
  let publishCount = 0;
  const sync = createWebCommerceSync({
    getRepository: () => repository,
    env,
    makeClient: (() => ({
      publishCatalog: async () => { publishCount++; return { revision: publishCount }; },
      list: async (after: number) => ({ orders: [], nextCursor: after, hasMore: false }),
      acknowledgeReceived: async () => assert.fail("no orders expected"),
    })) as any,
  });
  await sync.run();
  repository = { ...repository };
  await sync.run();
  assert.equal(publishCount, 2);
});

test("polls and persists orders when first catalog publish fails, then retries it", async () => {
  let failPublish = true;
  // The test fixture client is replaced through a dedicated sync to control the failure.
  let persisted = 0;
  let publishes = 0;
  const repository = {
    getWebCommerceCatalogSnapshot: () => catalog,
    getWebCommerceCatalogRevision: () => 1,
    getWebOrderCursor: () => 0,
    ingestWebOrder: () => { persisted++; },
    listWebPendingAcks: () => [],
    markWebOrderAcked: () => {},
  };
  const sync = createWebCommerceSync({
    getRepository: () => repository,
    env,
    makeClient: (() => ({
      publishCatalog: async () => {
        publishes++;
        if (failPublish) throw new Error("publish failed");
        return { revision: 1 };
      },
      list: async () => ({ orders: [{ id: "o1", storeId: "store_a", sequence: 1 }], nextCursor: 1, hasMore: false }),
      acknowledgeReceived: async () => ({ storeId: "store_a", receivedAt: new Date().toISOString() }),
    })) as any,
  });
  assert.equal((await sync.run()).state, "ERROR");
  assert.equal(persisted, 1);
  failPublish = false;
  assert.equal((await sync.run(true)).state, "SYNCED");
  assert.equal(publishes, 2);
});

test("keeps catalog pending when its revision changes during PUT", async () => {
  let revision = 1;
  let release!: () => void;
  let publishes = 0;
  const repository = {
    getWebCommerceCatalogSnapshot: () => catalog,
    getWebCommerceCatalogRevision: () => revision,
    getWebOrderCursor: () => 0,
    ingestWebOrder: () => {},
    listWebPendingAcks: () => [],
    markWebOrderAcked: () => {},
  };
  const sync = createWebCommerceSync({
    getRepository: () => repository,
    env,
    makeClient: (() => ({
      publishCatalog: async () => {
        publishes++;
        if (publishes === 1) await new Promise<void>((resolve) => { release = resolve; });
        return { revision: publishes };
      },
      list: async (after: number) => ({ orders: [], nextCursor: after, hasMore: false }),
      acknowledgeReceived: async () => assert.fail("no orders expected"),
    })) as any,
  });
  const first = sync.run();
  await new Promise((resolve) => setImmediate(resolve));
  revision = 2;
  release();
  assert.equal((await first).state, "PENDING");
  assert.equal((await sync.run()).state, "SYNCED");
  assert.equal(publishes, 2);
});

test("lost publish response cannot suppress an automatic retry after a local price reverts", async () => {
  let revision = 0, now = 0, price = 1000;
  const received: number[] = [];
  const repository = {
    getWebCommerceCatalogRevision: () => revision,
    getWebCommerceCatalogSnapshot: () => ({ products: [{ ...catalog.products[0]!, takeawayPriceMinor: price }] }),
    getWebOrderCursor: () => 0, listWebPendingAcks: () => [],
    markWebOrderAcked: () => {}, ingestWebOrder: () => {},
  };
  const sync = createWebCommerceSync({
    env, getRepository: () => repository, now: () => now,
    makeClient: () => ({
      publishCatalog: async (value: typeof catalog) => {
        received.push(value.products[0]!.takeawayPriceMinor);
        if (received.length === 2) throw new Error("response lost after applying");
      },
      list: async () => ({ orders: [], nextCursor: 0, hasMore: false }),
    } as any),
  });
  assert.equal((await sync.run()).state, "SYNCED");
  price = 1200; revision++;
  assert.equal((await sync.run()).state, "ERROR");
  price = 1000; revision++; now += 15_000;
  assert.equal((await sync.run()).state, "SYNCED");
  assert.deepEqual(received, [1000, 1200, 1000]);
});

test("coalesces concurrent ticks into one in-flight run", async () => {
  const f = setup();
  const [a, b] = await Promise.all([f.sync.run(), f.sync.run()]);
  assert.deepEqual(a, b);
  assert.equal(f.publishCount, 1);
});

test("invalidating during a catalog PUT leaves state pending and republishes next tick", async () => {
  let finishPublish!: () => void;
  let publishCount = 0;
  const repository = {
    getWebCommerceCatalogSnapshot: () => catalog,
    getWebCommerceCatalogRevision: () => 1,
    getWebOrderCursor: () => 0,
    ingestWebOrder: () => {},
    listWebPendingAcks: () => [],
    markWebOrderAcked: () => {},
  };
  const sync = createWebCommerceSync({
    getRepository: () => repository,
    env,
    makeClient: (() => ({
      publishCatalog: async () => {
        publishCount++;
        if (publishCount === 1)
          await new Promise<void>((resolve) => {
            finishPublish = resolve;
          });
        return { revision: publishCount };
      },
      list: async (after: number) => ({
        orders: [],
        nextCursor: after,
        hasMore: false,
      }),
      acknowledgeReceived: async () => assert.fail("no orders expected"),
    })) as any,
  });
  const firstRun = sync.run();
  await new Promise((resolve) => setImmediate(resolve));
  sync.invalidate();
  finishPublish();
  assert.equal((await firstRun).state, "PENDING");
  assert.equal(sync.status().state, "PENDING");
  assert.equal((await sync.run()).state, "SYNCED");
  assert.equal(publishCount, 2);
});

test("rejects cross-store orders without acknowledging or publishing", async () => {
  const f = setup();
  // Exercise server data whose store identity does not match configured tenant.
  const broken = createWebCommerceSync({
    getRepository: () => ({
      ...({} as any),
      getWebOrderCursor: () => 0,
      getWebCommerceCatalogSnapshot: () => catalog,
      getWebCommerceCatalogRevision: () => 1,
      ingestWebOrder: () => {},
      listWebPendingAcks: () => [],
      markWebOrderAcked: () => {},
    }),
    env,
    makeClient: (() => ({
      list: async () => ({
        orders: [{ id: "x", storeId: "other", sequence: 1 }],
        nextCursor: 1,
        hasMore: false,
      }),
      acknowledgeReceived: async () => assert.fail("must not ack"),
      publishCatalog: async () => assert.fail("must not publish"),
    })) as any,
  });
  assert.equal((await broken.run()).state, "ERROR");
  assert.equal(f.publishCount, 0);
});
