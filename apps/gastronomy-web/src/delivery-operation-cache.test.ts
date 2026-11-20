import type {
  BootstrapDto,
  DeliveryProjectionDto,
} from "@gastronomy/contracts";
import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { createDemoApi } from "./demo/demo-api";
import { applyDeliveryProjection } from "./delivery-operation-cache";
import { bootstrapKey } from "./order-entry-cache";

async function assignment() {
  const api = createDemoApi({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  const boot = await api.bootstrap();
  const order = {
    ...boot.orders[0]!,
    type: "DELIVERY" as const,
    version: 1,
    lifecycleStatus: "CONFIRMED" as const,
    driverUserId: "before",
    cashSessionCreatedId: boot.cashSession!.id,
    cashSessionPaidId: null,
  };
  const client = new QueryClient();
  client.setQueryData(bootstrapKey, { ...boot, orders: [order] });
  const cached = client.getQueryData<BootstrapDto>(bootstrapKey)!;
  const old = cached.orders[0]!;
  const saved = { ...old, driverUserId: "after", version: 2 };
  const delta: DeliveryProjectionDto = {
    order: saved,
    cashSessionId: boot.cashSession!.id,
    openCashSessionId: boot.cashSession!.id,
    deliveryLedger: [],
    driverDeliveryActivity: [],
  };
  return { client, cached, old, saved, delta };
}

it("preserva caja y catálogo al reasignar; rechaza una revisión o un turno ajeno", async () => {
  const { client, cached, old, saved, delta } = await assignment();
  try {
    expect(
      applyDeliveryProjection(
        client,
        cached,
        old,
        saved,
        { ...delta, openCashSessionId: null },
        "assign",
      ),
    ).toBe(false);
    expect(
      applyDeliveryProjection(
        client,
        cached,
        old,
        { ...saved, version: 3 },
        delta,
        "assign",
      ),
    ).toBe(false);
    expect(
      applyDeliveryProjection(client, cached, old, saved, delta, "assign"),
    ).toBe(true);
    const next = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    expect(next.orders[0]).toEqual(saved);
    for (const key of [
      "products",
      "cashSession",
      "dashboard",
      "tables",
    ] as const)
      expect(next[key]).toBe(cached[key]);
    expect(
      applyDeliveryProjection(client, cached, old, saved, delta, "assign"),
    ).toBe(false);
  } finally {
    client.clear();
  }
});

it("no publica como cobrado si falta la proyección contable o si la consulta quedó desactualizada", async () => {
  const { client, cached, old, delta } = await assignment();
  try {
    const saved = {
      ...old,
      operationalStatus: "DELIVERED" as const,
      version: 2,
    };
    const projection = { ...delta, order: saved };
    expect(
      applyDeliveryProjection(client, cached, old, saved, projection, "state"),
    ).toBe(false);
    await client.invalidateQueries({
      queryKey: bootstrapKey,
      refetchType: "none",
    });
    expect(
      applyDeliveryProjection(
        client,
        cached,
        old,
        saved,
        {
          ...projection,
          financials: {
            cashSession: cached.cashSession!,
            dashboard: cached.dashboard,
          },
        },
        "state",
      ),
    ).toBe(false);
    expect(client.getQueryData(bootstrapKey)).toBe(cached);
  } finally {
    client.clear();
  }
});
