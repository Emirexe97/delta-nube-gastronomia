import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BootstrapDto,
  DeliveryProjectionDto,
  OrderDto,
} from "@gastronomy/contracts";
import { createDemoApi } from "./demo/demo-api";
import { bootstrapKey } from "./order-entry-cache";
import { applyTakeawayFinanceProjection } from "./finance-reconciliation-cache";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((c) => c.clear()));

async function fixture() {
  const api = createDemoApi({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  const base = await api.bootstrap();
  const session = base.cashSession!;
  const old: OrderDto = {
    ...base.orders[0]!,
    type: "TAKEAWAY",
    tableId: null,
    lifecycleStatus: "CONFIRMED",
    version: 4,
    paymentStatus: "UNPAID",
    paidMinor: 0,
    totalMinor: 1250,
    operationalStatus: "READY",
    cashSessionCreatedId: session.id,
    cashSessionPaidId: null,
    payments: [],
  };
  const saved: OrderDto = {
    ...old,
    version: 5,
    paymentStatus: "PAID",
    paidMinor: 1250,
    cashSessionPaidId: session.id,
  };
  const before = { ...base, orders: [old] };
  const delta: DeliveryProjectionDto = {
    order: saved,
    cashSessionId: session.id,
    openCashSessionId: session.id,
    financials: {
      cashSession: {
        ...session,
        expectedAmountMinor: session.expectedAmountMinor + 1250,
      },
      dashboard: {
        ...base.dashboard,
        salesTotalMinor: base.dashboard.salesTotalMinor + 1250,
      },
    },
    deliveryLedger: [],
    driverDeliveryActivity: [],
  };
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(bootstrapKey, before);
  return { client, before, old, saved, delta };
}

describe("takeaway finance reconciliation", () => {
  it("uses the authoritative cash and dashboard, and does not change stock or delivery ledger", async () => {
    const { client, before, old, saved, delta } = await fixture();
    expect(
      applyTakeawayFinanceProjection(
        client,
        before,
        old,
        saved,
        delta,
        "payment",
      ),
    ).toBe(true);
    const actual = client.getQueryData<BootstrapDto>(bootstrapKey)!;
    expect(actual.orders[0]).toEqual(saved);
    expect(actual.cashSession).toEqual(delta.financials!.cashSession);
    expect(actual.dashboard).toEqual(delta.financials!.dashboard);
    expect(actual.products).toBe(before.products);
    expect(actual.deliveryLedger).toBe(before.deliveryLedger);
  });
  it("refuses missing financials, register rollover, stale revision, or another cache write", async () => {
    const { client, before, old, saved, delta } = await fixture();
    expect(
      applyTakeawayFinanceProjection(
        client,
        before,
        old,
        saved,
        { ...delta, financials: undefined },
        "payment",
      ),
    ).toBe(false);
    expect(
      applyTakeawayFinanceProjection(
        client,
        before,
        old,
        saved,
        { ...delta, openCashSessionId: null },
        "payment",
      ),
    ).toBe(false);
    const newer = { ...saved, version: 7 };
    expect(
      applyTakeawayFinanceProjection(
        client,
        before,
        old,
        newer,
        { ...delta, order: newer },
        "payment",
      ),
    ).toBe(false);
    client.setQueryData(bootstrapKey, { ...before, orders: [] });
    expect(
      applyTakeawayFinanceProjection(
        client,
        before,
        old,
        saved,
        delta,
        "payment",
      ),
    ).toBe(false);
  });
  it("never interprets a concurrent payment as part of a prepaid pickup", async () => {
    const { client, before, old, saved, delta } = await fixture();
    const concurrent: OrderDto = {
      ...saved,
      operationalStatus: "DELIVERED",
      version: 6,
    };
    expect(
      applyTakeawayFinanceProjection(
        client,
        before,
        old,
        concurrent,
        { ...delta, order: concurrent },
        "deliver",
      ),
    ).toBe(false);
    expect(client.getQueryData(bootstrapKey)).toBe(before);
  });
});
