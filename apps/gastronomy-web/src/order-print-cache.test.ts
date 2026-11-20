import type { BootstrapDto } from "@gastronomy/contracts";
import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { createDemoApi } from "./demo/demo-api";
import { bootstrapKey } from "./order-entry-cache";
import {
  applyOrderPrintState,
  refreshOrderPrintState,
} from "./order-print-cache";

async function fixture() {
  const api = createDemoApi({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  const initial = await api.bootstrap();
  const order = await api.createOrder({
    type: "DINE_IN",
    tableId: initial.tables.find((t) => t.active && !t.currentOrderId)!.id,
  });
  await api.addOrderItem({
    orderId: order.id,
    productId: initial.products.find((p) => p.active && !p.comboDefinition)!.id,
    quantity: 1,
  });
  const client = new QueryClient();
  client.setQueryData(bootstrapKey, await api.bootstrap());
  const cached = client.getQueryData<BootstrapDto>(bootstrapKey)!;
  await api.confirmOrder({ orderId: order.id });
  const delta = await api.getOrderPrintState({
    orderId: order.id,
    includeConfirmation: true,
  });
  return { api, order, client, cached, delta };
}

it("updates the confirmed order and its table, dashboard and inventory without replacing unrelated data", async () => {
  const { api, client, cached, delta } = await fixture();
  try {
    expect(applyOrderPrintState(client, cached, delta, true)).toBe(true);
    const next = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    const full = await api.bootstrap();
    for (const key of ["orders", "products", "tables", "dashboard"] as const)
      expect(next[key]).toEqual(full[key]);
    for (const key of [
      "cashSession",
      "deliveryLedger",
      "users",
      "categories",
    ] as const)
      expect(next[key]).toBe(cached[key]);
  } finally {
    client.clear();
  }
});

it("reconciles instead of overwriting a shift change or a concurrent update", async () => {
  const { client, cached, order, delta } = await fixture();
  try {
    expect(
      applyOrderPrintState(
        client,
        cached,
        { ...delta, cashSessionId: "different" },
        true,
      ),
    ).toBe(false);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await refreshOrderPrintState(client, order.id, true, {
      getOrderPrintState: async () => {
        client.setQueryData(bootstrapKey, { ...cached, orders: [] });
        return delta;
      },
    });
    expect(client.getQueryData<BootstrapDto>(bootstrapKey)!.orders).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bootstrapKey });
  } finally {
    client.clear();
  }
});
