import { QueryClient } from "@tanstack/react-query";
import type { BootstrapDto, OrderDto } from "@gastronomy/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo/demo-api";
import { bootstrapKey } from "./order-entry-cache";
import { applyTakeawayConfirmation } from "./order-confirm-cache";

class Storage implements DemoStorage {
  getItem() {
    return null;
  }
  setItem() {}
  removeItem() {}
}
const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

async function fixture() {
  const api = createDemoApi(new Storage());
  const initial = await api.bootstrap();
  const created = await api.createOrder({
    type: "TAKEAWAY",
    customerName: "Cliente QA",
    customerPhone: "11 1234-5678",
  });
  const product = initial.products.find(
    (row) => row.active && !row.comboDefinition,
  )!;
  await api.addOrderItem({
    orderId: created.id,
    productId: product.id,
    quantity: 2,
  });
  const client = new QueryClient();
  clients.push(client);
  const raw = await api.bootstrap();
  const before: BootstrapDto = {
    ...raw,
    orders: raw.orders.map((row) =>
      row.id === created.id ? { ...row, version: 1 } : row,
    ),
  };
  client.setQueryData(bootstrapKey, before);
  const original = before.orders.find((row) => row.id === created.id)!;
  const confirmed = await api.confirmOrder({ orderId: created.id });
  const response = { ...confirmed, version: 2 };
  const delta = await api.getOrderPrintState({
    orderId: created.id,
    includeConfirmation: true,
  });
  return {
    api,
    client,
    before,
    original,
    response,
    delta: { ...delta, order: response },
    product,
  };
}

describe("takeaway confirmation projection", () => {
  it("requires all affected products and copies the reported stock rather than subtracting locally", async () => {
    const { client, before, original, response, delta, product } =
      await fixture();
    const extra = delta.confirmation!;
    const missing = { ...delta, confirmation: { ...extra, stocks: [] } };
    expect(
      applyTakeawayConfirmation(client, before, original, response, missing),
    ).toBe(false);
    const projected = {
      ...delta,
      confirmation: {
        ...extra,
        stocks: [{ productId: product.id, stockMinor: 7300 }],
      },
    };
    expect(
      applyTakeawayConfirmation(client, before, original, response, projected),
    ).toBe(true);
    const cached = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    expect(cached.products.find((p) => p.id === product.id)?.stockMinor).toBe(
      7300,
    );
    expect(cached.products.find((p) => p.id !== product.id)).toBe(
      before.products.find((p) => p.id !== product.id),
    );
  });
  it("applies authoritative confirmation and inventory without another bootstrap", async () => {
    const { api, client, before, original, response, delta } = await fixture();
    expect(
      applyTakeawayConfirmation(client, before, original, response, delta),
    ).toBe(true);
    const cached = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    const authoritative = await api.bootstrap();
    expect(
      cached.orders.find((row) => row.id === original.id)?.lifecycleStatus,
    ).toBe("CONFIRMED");
    expect(cached.products).toEqual(authoritative.products);
    expect(cached.dashboard).toEqual(authoritative.dashboard);
    expect(cached.cashSession).toBe(before.cashSession);
  });

  it("rejects stale revision, changed cash session, and a replayed confirmation", async () => {
    const { client, before, original, response, delta } = await fixture();
    expect(
      applyTakeawayConfirmation(
        client,
        before,
        original,
        { ...response, version: 3 },
        delta,
      ),
    ).toBe(false);
    const stale = {
      ...before,
      cashSession: { ...before.cashSession!, id: "other" },
    };
    client.setQueryData(bootstrapKey, stale);
    expect(
      applyTakeawayConfirmation(client, stale, original, response, delta),
    ).toBe(false);
    client.setQueryData(bootstrapKey, before);
    const replay: OrderDto = {
      ...original,
      lifecycleStatus: "CONFIRMED",
      version: 2,
    };
    expect(
      applyTakeawayConfirmation(client, before, replay, response, delta),
    ).toBe(false);
  });
});
