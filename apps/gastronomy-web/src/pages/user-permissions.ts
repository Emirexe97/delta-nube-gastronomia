import { SYSTEM_PERMISSIONS, type Permission } from "@gastronomy/domain";

const permissionLabels: Record<Permission, string> = {
  "orders.create": "Crear pedidos",
  "orders.edit": "Editar pedidos",
  "orders.cancel": "Cancelar pedidos",
  "orders.reprint": "Reimprimir comandas",
  "orders.discount": "Aplicar descuentos",
  "orders.deposit": "Registrar señas",
  "orders.override_price": "Cambiar precios en pedidos",
  "payments.refund": "Devolver pagos",
  "tables.manage": "Gestionar mesas",
  "cash.open": "Abrir caja",
  "cash.close": "Cerrar caja",
  "cash.expense": "Registrar gastos",
  "cash.income": "Autorizar devoluciones recibidas en caja",
  "cash.withdraw": "Registrar retiros",
  "reports.view": "Ver informes",
  "reports.export": "Exportar informes",
  "settings.manage": "Configurar el sistema",
  "users.manage": "Administrar usuarios",
  "customers.manage": "Gestionar clientes",
  "prices.bulk_update": "Actualizar listas de precios",
  "stock.adjust": "Ajustar stock",
  "purchases.manage": "Gestionar compras",
  "finance.view": "Ver finanzas",
  "finance.manage": "Gestionar finanzas",
};

export function describeUserPermissions(
  permissions: readonly string[],
): string {
  const granted = new Set(permissions);
  if (!granted.size) return "Sin permisos asignados";
  if (
    granted.has("*") ||
    SYSTEM_PERMISSIONS.every((permission) => granted.has(permission))
  ) {
    return "Acceso total";
  }
  const withoutUserManagement = SYSTEM_PERMISSIONS.filter(
    (permission) => permission !== "users.manage",
  );
  if (
    granted.size === withoutUserManagement.length &&
    withoutUserManagement.every((permission) => granted.has(permission))
  ) {
    return "Todas las operaciones excepto administrar usuarios";
  }
  const descriptions = SYSTEM_PERMISSIONS.filter((permission) =>
    granted.has(permission),
  ).map((permission) => permissionLabels[permission]);
  // The browser demo also uses this legacy delivery permission.
  if (granted.has("deliveries.view")) descriptions.push("Ver repartos");
  if (
    [...granted].some(
      (permission) =>
        permission !== "deliveries.view" &&
        !Object.prototype.hasOwnProperty.call(permissionLabels, permission),
    )
  ) {
    descriptions.push("Otros permisos asignados");
  }
  return descriptions.join(" · ");
}
