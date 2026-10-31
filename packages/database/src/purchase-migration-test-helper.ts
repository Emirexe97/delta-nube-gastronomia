import type Database from "better-sqlite3-multiple-ciphers";
import { migrations } from "./migrations";

export const latestSchemaVersion = Math.max(
  ...migrations.map((migration) => migration.version),
);

/** Rewinds only schema artifacts newer than targetVersion, preserving business rows. */
export function rewindPurchaseTestSchema(
  db: InstanceType<typeof Database>,
  targetVersion: number,
) {
  if (targetVersion < 43) {
    db.exec("DROP INDEX IF EXISTS orders_cash_session_shift_number_idx");
    const orders = db.prepare("PRAGMA table_info(orders)").all() as Array<{
      name: string;
    }>;
    if (orders.some((column) => column.name === "shift_number"))
      db.exec("ALTER TABLE orders DROP COLUMN shift_number");
    db.prepare("DELETE FROM sequences WHERE name LIKE 'order:%'").run();
  }
  if (targetVersion < 41)
    db.exec("DROP TABLE IF EXISTS product_cost_recipes; DROP TABLE IF EXISTS ingredients;");
  if (targetVersion < 40) {
    const products = db.prepare("PRAGMA table_info(products)").all() as Array<{
      name: string;
    }>;
    const orderItems = db
      .prepare("PRAGMA table_info(order_items)")
      .all() as Array<{ name: string }>;
    if (products.some((column) => column.name === "combo_definition_json"))
      db.exec("ALTER TABLE products DROP COLUMN combo_definition_json");
    if (orderItems.some((column) => column.name === "combo_components_json"))
      db.exec("ALTER TABLE order_items DROP COLUMN combo_components_json");
  }
  if (targetVersion < 39) {
    db.exec(`DROP TRIGGER IF EXISTS purchase_item_product_corrections_no_update; DROP TRIGGER IF EXISTS purchase_item_product_corrections_no_delete;
      DROP INDEX IF EXISTS purchase_item_product_corrections_item_idx; DROP TABLE IF EXISTS purchase_item_product_corrections;
      DROP TRIGGER IF EXISTS purchase_cancellations_no_update; DROP TRIGGER IF EXISTS purchase_cancellations_no_delete;
      DROP INDEX IF EXISTS purchase_cancellations_purchase_idx; DROP TABLE IF EXISTS purchase_cancellations;`);
    const purchases = db
      .prepare("PRAGMA table_info(purchases)")
      .all() as Array<{ name: string }>;
    if (purchases.some((column) => column.name === "cancellation_reason"))
      db.exec("ALTER TABLE purchases DROP COLUMN cancellation_reason");
    if (purchases.some((column) => column.name === "cancelled_at"))
      db.exec("ALTER TABLE purchases DROP COLUMN cancelled_at");
  }
  if (targetVersion < 38) {
    db.exec(
      "DROP TRIGGER IF EXISTS orders_service_confirmed_items; DROP TRIGGER IF EXISTS order_items_service_insert; DROP TRIGGER IF EXISTS order_items_service_quantity_increase; DROP TRIGGER IF EXISTS order_items_service_delete_last",
    );
    const orders = db.prepare("PRAGMA table_info(orders)").all() as Array<{
      name: string;
    }>;
    for (const name of [
      "service_pending_since",
      "served_at",
      "service_revision",
    ])
      if (orders.some((column) => column.name === name))
        db.exec(`ALTER TABLE orders DROP COLUMN ${name}`);
  }
  if (targetVersion < 37)
    db.exec("DROP TABLE IF EXISTS purchase_item_quantity_corrections");
  if (targetVersion < 36)
    db.exec("DROP TABLE IF EXISTS purchase_item_cost_corrections");
  if (targetVersion < 35) {
    const purchases = db
      .prepare("PRAGMA table_info(purchases)")
      .all() as Array<{ name: string }>;
    if (purchases.some((column) => column.name === "revision"))
      db.exec("ALTER TABLE purchases DROP COLUMN revision");
  }
  db.prepare("DELETE FROM schema_migrations WHERE version > ?").run(
    targetVersion,
  );
}

export function removeNewNullablePurchaseColumns(row: Record<string, unknown>) {
  const {
    cancelled_at: _cancelledAt,
    cancellation_reason: _cancellationReason,
    ...historical
  } = row;
  return historical;
}
