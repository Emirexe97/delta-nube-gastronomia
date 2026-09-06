export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_gastronomy_schema",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_code TEXT NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  pin_hash TEXT NOT NULL,
  must_change_pin INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_sessions (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opened_by_user_id TEXT NOT NULL REFERENCES users(id),
  closed_by_user_id TEXT REFERENCES users(id),
  opening_amount_minor INTEGER NOT NULL CHECK (opening_amount_minor >= 0),
  expected_amount_minor INTEGER,
  counted_amount_minor INTEGER,
  difference_minor INTEGER,
  status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_number
  ON cash_sessions(number) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS cash_sessions_business_date_idx ON cash_sessions(business_date);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  affects_cash INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  affects_cash INTEGER NOT NULL DEFAULT 1,
  payment_method_id TEXT REFERENCES payment_methods(id),
  order_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON cash_movements(cash_session_id, created_at);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  stock_minor INTEGER,
  print_destination TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id, active, sort_order);
CREATE INDEX IF NOT EXISTS products_name_idx ON products(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS price_lists (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_prices (
  product_id TEXT NOT NULL REFERENCES products(id),
  price_list_id TEXT NOT NULL REFERENCES price_lists(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, price_list_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone_normalized);
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('DINE_IN','TAKEAWAY','DELIVERY')),
  operational_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  cash_session_created_id TEXT NOT NULL REFERENCES cash_sessions(id),
  cash_session_paid_id TEXT REFERENCES cash_sessions(id),
  table_id TEXT REFERENCES restaurant_tables(id),
  customer_id TEXT REFERENCES customers(id),
  customer_name_snapshot TEXT,
  customer_phone_snapshot TEXT,
  delivery_address_snapshot TEXT,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  promised_at TEXT,
  scheduled INTEGER NOT NULL DEFAULT 0,
  waiter_user_id TEXT REFERENCES users(id),
  driver_user_id TEXT REFERENCES users(id),
  notes TEXT,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  printed_at TEXT,
  print_count INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_per_table
  ON orders(table_id) WHERE table_id IS NOT NULL AND operational_status NOT IN ('DELIVERED','CANCELLED');
CREATE INDEX IF NOT EXISTS orders_number_idx ON orders(number);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(operational_status, payment_status);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at);
CREATE INDEX IF NOT EXISTS orders_promised_idx ON orders(promised_at);
CREATE INDEX IF NOT EXISTS orders_cash_created_idx ON orders(cash_session_created_id);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor_snapshot INTEGER NOT NULL,
  price_list_id TEXT REFERENCES price_lists(id),
  discount_minor_snapshot INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id, sort_order);

CREATE TABLE IF NOT EXISTS order_item_halves (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  position TEXT NOT NULL CHECK (position IN ('FIRST','SECOND')),
  product_name_snapshot TEXT NOT NULL,
  price_minor_snapshot INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id TEXT,
  name_snapshot TEXT NOT NULL,
  unit_price_minor_snapshot INTEGER NOT NULL,
  scope TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  received_minor INTEGER,
  reference TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);
CREATE INDEX IF NOT EXISTS payments_cash_idx ON payments(cash_session_id, created_at);

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  printer_name TEXT,
  copies INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  printed_at TEXT
);
CREATE INDEX IF NOT EXISTS print_jobs_order_idx ON print_jobs(order_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  business_date TEXT,
  operator_user_id TEXT REFERENCES users(id),
  authorizer_user_id TEXT REFERENCES users(id),
  permission_used TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type, entity_id, timestamp);
CREATE INDEX IF NOT EXISTS audit_log_business_date_idx ON audit_log(business_date, timestamp);

CREATE TABLE IF NOT EXISTS domain_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS domain_events_pending_idx ON domain_events(published_at, occurred_at);
`,
  },
  {
    version: 2,
    name: "modifiers_stock_and_delivery_ledger",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS modifier_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  min_select INTEGER NOT NULL DEFAULT 0,
  max_select INTEGER NOT NULL DEFAULT 99,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modifiers (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES modifier_groups(id),
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(group_id, name)
);

CREATE TABLE IF NOT EXISTS product_modifiers (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  modifier_id TEXT NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  PRIMARY KEY(product_id, modifier_id)
);

CREATE TABLE IF NOT EXISTS delivery_ledger (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  driver_user_id TEXT NOT NULL REFERENCES users(id),
  restaurant_amount_minor INTEGER NOT NULL,
  delivery_fee_minor INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('DRIVER_OWES_BUSINESS','BUSINESS_OWES_DRIVER')),
  amount_due_minor INTEGER NOT NULL,
  settled_amount_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED')),
  created_at TEXT NOT NULL,
  settled_at TEXT,
  settled_by_user_id TEXT REFERENCES users(id),
  settlement_reason TEXT
);
CREATE INDEX IF NOT EXISTS delivery_ledger_driver_idx ON delivery_ledger(driver_user_id, status, created_at);
`,
  },
  {
    version: 3,
    name: "historical_category_snapshot",
    sql: String.raw`
ALTER TABLE order_items ADD COLUMN category_name_snapshot TEXT;
UPDATE order_items
SET category_name_snapshot = (
  SELECT c.name FROM products p JOIN categories c ON c.id = p.category_id
  WHERE p.id = order_items.product_id
)
WHERE category_name_snapshot IS NULL;
`,
  },
  {
    version: 4,
    name: "staff_number_for_keyboard_entry",
    sql: String.raw`
ALTER TABLE users ADD COLUMN staff_number INTEGER;
UPDATE users SET staff_number = rowid WHERE staff_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_number_idx ON users(staff_number);
`,
  },
  {
    version: 5,
    name: "order_drafts_and_driver_collection",
    sql: String.raw`
ALTER TABLE orders ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'CONFIRMED'
  CHECK (lifecycle_status IN ('DRAFT','CONFIRMED'));
ALTER TABLE orders ADD COLUMN confirmed_at TEXT;
ALTER TABLE orders ADD COLUMN collected_by_driver INTEGER NOT NULL DEFAULT 0;
UPDATE orders SET confirmed_at = created_at WHERE lifecycle_status = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS orders_lifecycle_idx ON orders(lifecycle_status, operational_status);
`,
  },
  {
    version: 6,
    name: "auditable_payment_refunds",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS payment_refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx ON payment_refunds(payment_id, created_at);
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx ON payment_refunds(order_id, created_at);
CREATE INDEX IF NOT EXISTS payment_refunds_cash_idx ON payment_refunds(cash_session_id, created_at);
`,
  },
  {
    version: 7,
    name: "unify_takeaway_and_delivery_prices",
    sql: String.raw`
UPDATE product_prices
SET amount_minor = (
  SELECT takeaway.amount_minor
  FROM product_prices takeaway
  JOIN price_lists takeaway_list ON takeaway_list.id = takeaway.price_list_id
  WHERE takeaway.product_id = product_prices.product_id
    AND takeaway_list.code = 'TAKEAWAY'
)
WHERE price_list_id = (SELECT id FROM price_lists WHERE code = 'DELIVERY')
  AND EXISTS (
    SELECT 1
    FROM product_prices takeaway
    JOIN price_lists takeaway_list ON takeaway_list.id = takeaway.price_list_id
    WHERE takeaway.product_id = product_prices.product_id
      AND takeaway_list.code = 'TAKEAWAY'
  );
`,
  },
  {
    version: 8,
    name: "cash_closing_float_reconciliation",
    sql: String.raw`
ALTER TABLE cash_sessions ADD COLUMN closing_float_amount_minor INTEGER;
ALTER TABLE cash_sessions ADD COLUMN cash_removed_amount_minor INTEGER;
ALTER TABLE cash_sessions ADD COLUMN float_difference_minor INTEGER;
`,
  },
  {
    version: 9,
    name: "delivery_fee_per_customer_address",
    sql: String.raw`
ALTER TABLE customer_addresses ADD COLUMN delivery_fee_minor INTEGER NOT NULL DEFAULT 0
  CHECK (delivery_fee_minor >= 0);
`,
  },
  {
    version: 10,
    name: "honest_print_outcomes_and_attempts",
    sql: String.raw`
ALTER TABLE orders ADD COLUMN print_attempt_count INTEGER NOT NULL DEFAULT 0;

UPDATE orders
SET print_attempt_count = COALESCE((
      SELECT SUM(pj.attempts)
      FROM print_jobs pj
      WHERE pj.order_id = orders.id
    ), 0),
    print_count = COALESCE((
      SELECT COUNT(*)
      FROM print_jobs pj
      WHERE pj.order_id = orders.id AND pj.status = 'PRINTED'
    ), 0),
    printed_at = (
      SELECT MIN(pj.printed_at)
      FROM print_jobs pj
      WHERE pj.order_id = orders.id AND pj.status = 'PRINTED'
    );

CREATE INDEX IF NOT EXISTS print_jobs_status_created_idx
  ON print_jobs(status, created_at);
`,
  },
  {
    version: 11,
    name: "normalize_delivery_balances_and_claim_print_jobs",
    sql: String.raw`
UPDATE delivery_ledger
SET settled_amount_minor = amount_due_minor,
    status = 'SETTLED',
    settled_at = COALESCE(settled_at, created_at),
    settlement_reason = COALESCE(settlement_reason, 'Normalización automática de saldo cero')
WHERE status = 'PENDING' AND amount_due_minor <= settled_amount_minor;

UPDATE print_jobs AS stale
SET status = 'FAILED',
    last_error = COALESCE(last_error, 'Solicitud duplicada normalizada al actualizar')
WHERE stale.status IN ('QUEUED','RECOVERING')
  AND EXISTS (
    SELECT 1 FROM print_jobs newer
    WHERE newer.order_id = stale.order_id
      AND newer.kind = stale.kind
      AND newer.status IN ('QUEUED','RECOVERING')
      AND (
        newer.created_at > stale.created_at OR
        (newer.created_at = stale.created_at AND newer.id > stale.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_one_active_per_kind_idx
  ON print_jobs(order_id, kind)
  WHERE status IN ('QUEUED','RECOVERING');
`,
  },
  {
    version: 12,
    name: "customer_profiles_lifecycle_and_preferences",
    sql: String.raw`
ALTER TABLE customers ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE customers ADD COLUMN preferences TEXT;
ALTER TABLE customers ADD COLUMN preferred_payment_method_code TEXT;
ALTER TABLE customers ADD COLUMN merged_into_customer_id TEXT REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS customers_active_name_idx
  ON customers(active, name COLLATE NOCASE, id);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx
  ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx
  ON customer_addresses(customer_id, is_default DESC, created_at);
`,
  },
  {
    version: 13,
    name: "persistent_idempotency_and_terminal_identity",
    sql: String.raw`
CREATE TABLE IF NOT EXISTS command_receipts (
  idempotency_key TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL,
  cash_session_id TEXT,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILED')),
  persisted_result_json TEXT,
  error_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS command_receipts_terminal_idx ON command_receipts(terminal_id, created_at);
`,
  },
  {
    version: 14,
    name: "cash_movements_reversals",
    sql: String.raw`
ALTER TABLE cash_movements ADD COLUMN reference_id TEXT REFERENCES cash_movements(id);
`,
  },
];
