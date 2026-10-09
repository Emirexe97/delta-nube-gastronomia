import { describeUserPermissions } from "./user-permissions";
import {
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_PERMISSIONS,
} from "@gastronomy/domain";
import { describe, expect, it } from "vitest";

describe("descripciones de permisos sin cambiar privilegios", () => {
  it("reconoce el comodín de demostración", () => {
    expect(describeUserPermissions(["*"])).toBe("Acceso total");
  });
  it("reconoce el conjunto completo explícito, independientemente del orden", () => {
    expect(describeUserPermissions([...SYSTEM_PERMISSIONS].reverse())).toBe(
      "Acceso total",
    );
  });
  it("explica exactamente el alcance completo salvo usuarios", () => {
    expect(describeUserPermissions(DEFAULT_ROLE_PERMISSIONS.MANAGER!)).toBe(
      "Todas las operaciones excepto administrar usuarios",
    );
  });
  it("describe las acciones del mozo recibidas, sin asumir otras por rol", () => {
    expect(describeUserPermissions(DEFAULT_ROLE_PERMISSIONS.WAITER!)).toBe(
      "Crear pedidos · Editar pedidos · Reimprimir comandas",
    );
    expect(describeUserPermissions(["orders.create", "orders.edit"])).toBe(
      "Crear pedidos · Editar pedidos",
    );
  });
  it("describe caja e informes sin atribuir descuentos ni exportación", () => {
    expect(describeUserPermissions(DEFAULT_ROLE_PERMISSIONS.CASHIER!)).toBe(
      "Crear pedidos · Editar pedidos · Reimprimir comandas · Abrir caja · Cerrar caja · Registrar gastos · Registrar retiros · Ver informes",
    );
  });
  it("no confunde ausencia de permisos con imposibilidad de iniciar sesión", () => {
    expect(describeUserPermissions([])).toBe("Sin permisos asignados");
    expect(describeUserPermissions(["deliveries.view"])).toBe("Ver repartos");
  });
  it("no inventa acciones para permisos desconocidos ni expone códigos técnicos", () => {
    expect(describeUserPermissions(["toString", "__proto__"])).toBe(
      "Otros permisos asignados",
    );
    expect(describeUserPermissions(["future.secret"])).toBe(
      "Otros permisos asignados",
    );
    expect(describeUserPermissions(["orders.create", "future.secret"])).toBe(
      "Crear pedidos · Otros permisos asignados",
    );
  });
  it("no oculta un conjunto desconocido como el alcance conocido de Supervisor", () => {
    expect(
      describeUserPermissions([
        ...DEFAULT_ROLE_PERMISSIONS.MANAGER!,
        "future.secret",
      ]),
    ).toContain("Otros permisos asignados");
  });
  it("no modifica la entrada y evita repeticiones", () => {
    const permissions = Object.freeze([
      "orders.edit",
      "orders.create",
      "orders.edit",
    ]);
    expect(describeUserPermissions(permissions)).toBe(
      "Crear pedidos · Editar pedidos",
    );
    expect(permissions).toEqual([
      "orders.edit",
      "orders.create",
      "orders.edit",
    ]);
  });
});
