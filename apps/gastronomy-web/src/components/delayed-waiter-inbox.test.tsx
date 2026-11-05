import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BootstrapDto, DelayedWaiterBatch } from "@gastronomy/contracts";
import { canReviewDelayedWaiters, DelayedWaiterInbox, delayedWaiterKey } from "./delayed-waiter-inbox";

const data = {
  currentUser: { id: "cashier", roleCode: "CASHIER", permissions: ["orders.create"] },
  cashSession: { id: "shift-1", status: "OPEN" },
} as BootstrapDto;
const entry: DelayedWaiterBatch = {
  requestId: "batch-delayed-example",
  tableId: "table-1", tableNumber: 1, waiterName: "Ana",
  receivedAt: "2026-11-05T14:02:00.000Z", submittedAt: "2026-11-05T14:00:00.000Z",
  status: "PENDING_REVIEW",
  lines: [{ productId: "pizza", name: "Pizza", quantity: 2 }],
};
function render(entries: DelayedWaiterBatch[]) {
  const client = new QueryClient();
  client.setQueryData([...delayedWaiterKey, data.currentUser.id], entries);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(DelayedWaiterInbox, { data, active: false })));
}
describe("cashier review of delayed waiter batches", () => {
  it("does not grant waiter access just because the waiter can create orders", () => {
    expect(canReviewDelayedWaiters(data)).toBe(true);
    expect(canReviewDelayedWaiters({ ...data, currentUser: { ...data.currentUser, roleCode: "WAITER" } })).toBe(false);
    expect(canReviewDelayedWaiters({ ...data, currentUser: { ...data.currentUser, permissions: [] } })).toBe(false);
  });
  it("shows pending local data, warns before duplicate manual entry, and needs no network flag", () => {
    const html = render([entry]);
    expect(html).toContain("Mesa 1");
    expect(html).toContain("Ana");
    expect(html).toContain("no necesita Internet");
    expect(html).toContain("No se incorporaron a la mesa ni se imprimieron");
    expect(html).toContain("ya se cargaron manualmente");
  });
  it("renders an explicit empty state", () => {
    expect(render([])).toContain("No hay tandas demoradas pendientes");
  });
});
