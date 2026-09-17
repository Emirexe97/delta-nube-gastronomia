import type { OrderDto } from "@gastronomy/contracts";

/**
 * Filtra el historial de mesas cerradas del turno actual
 * y permite buscar por mozo, número de mesa o producto vendido.
 */
export function filterClosedTableOrders(
  orders: OrderDto[],
  cashSessionId?: string | null,
  query = "",
): OrderDto[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return orders
    .filter((order) => {
      // Solo pedidos de salón
      if (order.type !== "DINE_IN") return false;

      // Solo mesas cerradas o canceladas (no pedidos activos en mesa)
      if (
        order.operationalStatus !== "DELIVERED" &&
        order.operationalStatus !== "CANCELLED"
      ) {
        return false;
      }

      // Si hay un turno activo, filtrar los que pertenezcan a dicho turno
      if (cashSessionId) {
        const matchesSession =
          order.cashSessionPaidId === cashSessionId ||
          order.cashSessionCreatedId === cashSessionId;
        if (!matchesSession) return false;
      }

      if (!normalizedQuery) return true;

      // 1. Búsqueda por mozo
      const waiter = (order.waiterName ?? "").toLocaleLowerCase();
      if (waiter.includes(normalizedQuery)) return true;

      // 2. Búsqueda por número de mesa
      const tableNum =
        order.tableNumber != null ? String(order.tableNumber) : "";
      if (
        tableNum &&
        (tableNum === normalizedQuery ||
          tableNum.includes(normalizedQuery) ||
          `mesa ${tableNum}`.includes(normalizedQuery))
      ) {
        return true;
      }

      // 3. Búsqueda por producto vendido (nombre directo, mitades o modificadores)
      const hasMatchingProduct = order.items.some((item) => {
        if (
          item.productNameSnapshot
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        ) {
          return true;
        }
        if (
          item.halves?.some((half) =>
            half.nameSnapshot
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        ) {
          return true;
        }
        if (
          item.modifiers?.some((modifier) =>
            modifier.nameSnapshot
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        ) {
          return true;
        }
        return false;
      });
      if (hasMatchingProduct) return true;

      // 4. Búsqueda por número de pedido (#1001 o 1001)
      const orderNumberStr = String(order.number);
      if (
        orderNumberStr.includes(normalizedQuery) ||
        `#${orderNumberStr}`.includes(normalizedQuery)
      ) {
        return true;
      }

      return false;
    })
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt).valueOf() -
        new Date(a.updatedAt || a.createdAt).valueOf(),
    );
}
