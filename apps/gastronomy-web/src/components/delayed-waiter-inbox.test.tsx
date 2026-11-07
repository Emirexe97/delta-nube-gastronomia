import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  it("shows pending orders and warns before duplicate manual entry", () => {
    const html = render([entry]);
    expect(html).toContain("Mesa 1");
    expect(html).toContain("Ana");
    expect(html).toContain("todavía no se agregaron a la mesa ni se enviaron a cocina");
    expect(html).toContain("ya los cargó manualmente");
  });
  it("renders an explicit empty state", () => {
    expect(render([])).toContain("No hay pedidos pendientes de revisión");
    expect(render([])).toContain("Los pedidos ya aceptados aparecen dentro de su mesa");
    expect(render([])).not.toContain("Antes de confirmar");
  });
  it("places the permission-gated waiter tab in Salon, not Orders", () => {
    const root = resolve(process.cwd(), "src/pages");
    const salon = readFileSync(resolve(root, "tables-page.tsx"), "utf8");
    const orders = readFileSync(resolve(root, "orders-page.tsx"), "utf8");
    expect(salon).toContain("canReviewWaiters && <button id=\"salon-tab-mozos\"");
    expect(salon).toContain("<DelayedWaiterInbox data={data} active={workspaceActive} />");
    expect(orders).not.toContain("DelayedWaiterInbox");
    expect(orders).not.toContain("DelayedWaiterCount");
    expect(orders).not.toContain("Mozos demorados");
    const desktop = readFileSync(resolve(process.cwd(), "../desktop-shell/src/main.ts"), "utf8");
    expect(desktop).toContain("Salón → Mozos");
    expect(desktop).not.toContain("Pedidos → Mozos demorados");
  });
});
