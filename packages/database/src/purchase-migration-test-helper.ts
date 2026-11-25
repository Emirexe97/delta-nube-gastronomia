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
  if (targetVersion < 61) {
    db.exec(`DROP INDEX IF EXISTS customers_active_search_idx;
      DROP INDEX IF EXISTS customer_addresses_customer_search_idx;
      DROP INDEX IF EXISTS customer_account_allocations_order_idx;`);
    for (const [table, name] of [
      ["customers", "name_search"],
      ["customers", "notes_search"],
      ["customer_addresses", "address_search"],
      ["customer_addresses", "notes_search"],
    ] as const) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === name))
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    }
  }
  if (targetVersion < 60) {
    for (const table of [
      "products",
      "categories",
      "product_prices",
      "price_lists",
      "price_books",
      "price_book_assignments",
      "product_price_book_bases",
      "product_price_book_overrides",
      "modifiers",
      "modifier_groups",
      "settings",
    ]) {
      for (const op of ["insert", "update", "delete"]) {
        db.exec(`DROP TRIGGER IF EXISTS waiter_menu_revision_${table}_${op}`);
      }
    }
    db.exec("DROP TABLE IF EXISTS waiter_menu_revision");
  }
  if (targetVersion < 59)
    db.exec(`DROP INDEX IF EXISTS orders_cash_paid_idx;
      DROP INDEX IF EXISTS order_item_modifiers_item_idx;
      DROP INDEX IF EXISTS order_item_halves_item_idx;
      DROP INDEX IF EXISTS order_item_halves_product_idx;
      DROP INDEX IF EXISTS order_items_product_idx;
      DROP INDEX IF EXISTS purchase_items_product_purchase_idx;
      DROP INDEX IF EXISTS cash_movements_order_idx;
      DROP INDEX IF EXISTS cash_movements_change_session_idx;
      DROP INDEX IF EXISTS finance_expenses_paid_due_idx;
      DROP INDEX IF EXISTS audit_log_timestamp_idx;
      DROP INDEX IF EXISTS audit_log_action_idx;
      DROP INDEX IF EXISTS customer_account_receipts_session_idx;`);
  if (targetVersion < 58) {
    db.exec(`DROP INDEX IF EXISTS shift_order_closures_order_idx;
      DROP TABLE IF EXISTS shift_order_closures;
      DROP INDEX IF EXISTS domain_events_shift_time_idx;
      DROP INDEX IF EXISTS domain_events_aggregate_time_idx;`);
    for (const [table, name] of [
      ["domain_events", "cash_session_id"],
      ["domain_events", "actor_user_id"],
      ["orders", "driver_remuneration_minor"],
    ] as const) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === name))
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    }
  }
  if (targetVersion < 57) db.exec("DROP TABLE IF EXISTS finance_book_entries");
  if (targetVersion < 56) {
    const charges = db.prepare("PRAGMA table_info(customer_account_charges)").all() as Array<{ name: string }>;
    if (charges.some((column) => column.name === "adjustment_minor"))
      db.exec("ALTER TABLE customer_account_charges DROP COLUMN adjustment_minor");
  }
  if (targetVersion < 55) {
    for (const [table, name] of [
      ["order_items", "half_and_half_group_name_snapshot"],
      ["products", "half_and_half_group_override"],
      ["categories", "default_half_and_half_group_id"],
      ["categories", "half_and_half_groups_json"],
    ] as const) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === name))
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    }
  }
  if (targetVersion < 54)
    db.exec("DROP INDEX IF EXISTS orders_delivery_shift_idx; DROP INDEX IF EXISTS delivery_outstanding_order_idx;");
  if (targetVersion < 53) db.exec("DROP INDEX IF EXISTS cash_movements_reference_idx; DROP INDEX IF EXISTS cash_sessions_closed_history_idx");
  if (targetVersion < 52) {
    for (const group of ["products", "categories", "prices", "price_lists", "settings"])
      for (const op of ["insert", "update", "delete"])
        db.exec(`DROP TRIGGER IF EXISTS web_catalog_revision_${group}_${op}`);
    db.exec("DROP TABLE IF EXISTS web_catalog_revision");
  }
  if (targetVersion < 51) db.exec("DROP TABLE IF EXISTS tutorial_progress");
  if (targetVersion < 50) {
    db.exec("DROP TABLE IF EXISTS waiter_reprints");
    for (const [table, name] of [
      ["waiter_batches", "kitchen_snapshot_json"], ["waiter_batches", "print_mode"], ["waiter_pending_batches", "print_mode"],
    ] as const) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>;
      if (columns.some((column) => column.name === name))
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    }
  }
  if (targetVersion < 49 && targetVersion >= 48) {
    const books = db.prepare("PRAGMA table_info(price_books)").all() as Array<{
      name: string;
    }>;
    if (books.some((column) => column.name === "rounding_increment_minor"))
      db.exec("ALTER TABLE price_books DROP COLUMN rounding_increment_minor");
  }
  if (targetVersion < 48)
    db.exec(`DROP TABLE IF EXISTS product_price_book_overrides;
      DROP TABLE IF EXISTS product_price_book_bases;
      DROP TABLE IF EXISTS price_book_assignments;
      DROP TABLE IF EXISTS price_books;`);
  if (targetVersion < 47 && targetVersion >= 45)
    db.exec("ALTER TABLE waiter_sessions DROP COLUMN expires_on_cash_close");
  if (targetVersion < 46)
    db.exec("DROP TABLE IF EXISTS waiter_pending_batch_lines; DROP TABLE IF EXISTS waiter_pending_batches;");
  if (targetVersion < 45)
    db.exec(`DROP TABLE IF EXISTS waiter_batch_lines; DROP TABLE IF EXISTS waiter_batches;
      DROP TABLE IF EXISTS waiter_sessions; DROP TABLE IF EXISTS waiter_challenges;`);
  if (targetVersion < 44) {
    db.exec(`DROP TABLE IF EXISTS web_order_acks;
      DROP TABLE IF EXISTS web_order_cursors;
      DROP TABLE IF EXISTS web_order_inbox;`);
    const products = db.prepare("PRAGMA table_info(products)").all() as Array<{
      name: string;
    }>;
    if (products.some((column) => column.name === "web_published"))
      db.exec("ALTER TABLE products DROP COLUMN web_published");
  }
  if (targetVersion < 42) {
    db.exec("DROP INDEX IF EXISTS print_jobs_kitchen_baseline_idx");
    const printJobs = db.prepare("PRAGMA table_info(print_jobs)").all() as Array<{
      name: string;
    }>;
    if (printJobs.some((column) => column.name === "kitchen_snapshot_json"))
      db.exec("ALTER TABLE print_jobs DROP COLUMN kitchen_snapshot_json");
  }
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
