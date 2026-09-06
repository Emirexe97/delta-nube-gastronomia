export const SYSTEM_PERMISSIONS = [
  "orders.create",
  "orders.edit",
  "orders.cancel",
  "orders.reprint",
  "orders.discount",
  "orders.override_price",
  "payments.refund",
  "tables.manage",
  "cash.open",
  "cash.close",
  "cash.expense",
  "cash.withdraw",
  "reports.view",
  "reports.export",
  "settings.manage",
  "users.manage",
  "customers.manage",
  "prices.bulk_update",
  "stock.adjust",
] as const;

export type Permission = (typeof SYSTEM_PERMISSIONS)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  ADMIN: SYSTEM_PERMISSIONS,
  MANAGER: SYSTEM_PERMISSIONS.filter(
    (permission) => permission !== "users.manage",
  ),
  CASHIER: [
    "orders.create",
    "orders.edit",
    "orders.reprint",
    "cash.open",
    "cash.close",
    "cash.expense",
    "cash.withdraw",
    "reports.view",
  ],
  WAITER: ["orders.create", "orders.edit", "orders.reprint"],
  DELIVERY_DRIVER: [],
};

export function assertPermission(
  permissions: readonly string[],
  required: Permission,
) {
  if (!permissions.includes(required))
    throw new Error("El usuario no tiene permiso para esta operación.");
}
