import { describe, expect, it } from "vitest";
import { AUDIT_FILTER_ACTIONS } from "@gastronomy/contracts";
import { auditActionLabel, auditEntityLabel, permissionLabel } from "./lib";

const expected: Record<string, string> = {
  CASH_INCOME: "Ingreso de caja",
  CASH_EXPENSE: "Gasto de caja",
  CASH_WITHDRAWAL: "Retiro de caja",
  CASH_ADJUSTMENT: "Ajuste de caja",
  CUSTOMER_MERGED: "Ficha de cliente fusionada",
  CUSTOMER_MERGE_RECEIVED: "Datos de cliente incorporados",
  FINANCE_EXPENSE_PAID: "Gasto pagado",
  FINANCE_RECURRING_STOPPED: "Gasto recurrente detenido",
};
describe("vocabulario de auditoría", () => {
  for (const [action, label] of Object.entries(expected))
    it(`explica ${action} en español`, () =>
      expect(auditActionLabel(action)).toBe(label));
  it("traduce todas las acciones ofrecidas por el filtro sin cambiar sus códigos", () => {
    for (const action of AUDIT_FILTER_ACTIONS) {
      const fallback = action
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/^./, (letter) => letter.toUpperCase());
      expect(auditActionLabel(action), action).not.toBe(fallback);
    }
  });
  it("traduce entidades financieras y mantiene visible un código futuro desconocido", () => {
    expect(auditEntityLabel("FINANCE_EXPENSE")).toBe("Gasto");
    expect(auditEntityLabel("FINANCE_RECURRING")).toBe("Gasto recurrente");
    expect(auditEntityLabel("CASH_MOVEMENT")).toBe("Movimiento de caja");
    expect(auditEntityLabel("ORDER_ITEM")).toBe("Producto del pedido");
    expect(auditActionLabel("FUTURE_EVENT")).toBe("Future event");
    expect(auditEntityLabel("FUTURE_ENTITY")).toBe("FUTURE_ENTITY");
  });
  it("explica permisos existentes sin alterar autorización", () => {
    expect(permissionLabel("finance.manage")).toBe(
      "Administrar gastos y costos",
    );
    expect(permissionLabel("customers.manage")).toBe("Administrar clientes");
    expect(permissionLabel("orders.edit")).toBe("Editar pedidos");
    expect(permissionLabel(null)).toBe("—");
    expect(permissionLabel("future.permission")).toBe("future.permission");
  });
});
