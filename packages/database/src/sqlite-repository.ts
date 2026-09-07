import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3-multiple-ciphers";
import bcrypt from "bcryptjs";
import type { GastronomyRepository } from "@gastronomy/application";
import type {
  AddHalfAndHalfItemInput,
  AddOrderItemInput,
  AppSettingsDto,
  AuditEntryDto,
  BootstrapDto,
  BulkUpdateProductsInput,
  BusinessDate,
  CancelOrderInput,
  CashMovementInput,
  CashSessionDto,
  CashMovementType,
  CashSessionHistoryItemDto,
  CashSessionReportDto,
  CashSessionReportFilters,
  CategoryDto,
  CloseCashSessionInput,
  CreateOrderInput,
  CustomerDto,
  CustomerProfileDto,
  SearchCustomersPageInput,
  DashboardSummaryDto,
  DeliveryLedgerDto,
  DriverDeliveryActivityDto,
  DetailedReportDto,
  Id,
  OpenCashSessionInput,
  OrderDto,
  OrderType,
  OrderOperationalStatus,
  PayOrderInput,
  PaymentMethodDto,
  PrintJobDto,
  ModifierDto,
  ProductDto,
  RefundPaymentInput,
  RestaurantTableDto,
  ReportFilters,
  UpdateProductInput,
  UpdateDraftOrderInput,
  ConfirmOrderInput,
  SettleDeliveryInput,
  ReverseCashMovementInput,
  ReverseDeliverySettlementInput,
  UserDto,
} from "@gastronomy/contracts";
import {
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_PERMISSIONS,
  assertOperationalTransition,
  assertAppSettings,
  assertMoneyMinor,
  assertOrderAction,
  assertOrderTransition,
  assertPaymentAllocation,
  businessDateFromOpening,
  calculateCashClosing,
  calculateExpectedCash,
  calculateHalfAndHalfBase,
  calculateModifierCharge,
  calculateDiscountMinor,
  calculateLineTotal,
  paymentStatusFor,
  nonNegativeMoney,
  assertPermission,
} from "@gastronomy/domain";
import { migrations } from "./migrations";

type SqliteDatabase = InstanceType<typeof Database>;
type Row = Record<string, unknown>;

const DEFAULT_SETTINGS: AppSettingsDto = {
  businessName: "Delta Nube Gastronomía",
  currency: "ARS",
  halfAndHalfPricingMode: "HALF_PLUS_HALF",
  stockEnabled: false,
  maxConcurrentCashSessions: 1,
  allowCloseWithPendingOrders: false,
  touchProductPanelEnabled: false,
  deliverySettlementEnabled: false,
  enabledOrderStatuses: ["IN_PREPARATION", "DELIVERED"],
  quickDelayMinutes: [20, 30, 40, 45, 60],
  modules: {
    diningRoom: true,
    takeaway: true,
    delivery: true,
    modifiers: true,
    discounts: true,
    advancedStatuses: false,
  },
  printing: {
    terminalLabel: "Caja principal",
    kitchen: {
      profileName: "Comanda cocina",
      deviceName: "",
      mode: "SYSTEM_DIALOG",
      paperWidth: "80mm",
      charsPerLine: 42,
      copies: 1,
      cutter: true,
      cutMode: "PARTIAL",
      feedLinesBeforeCut: 4,
    },
    bill: {
      profileName: "Cuenta cliente",
      deviceName: "",
      mode: "SYSTEM_DIALOG",
      paperWidth: "80mm",
      charsPerLine: 42,
      copies: 1,
      cutter: true,
      cutMode: "PARTIAL",
      feedLinesBeforeCut: 4,
    },
    receiptTemplate: {
      kitchenHeader: "COMANDA",
      kitchenFooter: "",
      title: "Delta Nube Gastronomía",
      subtitle: "",
      footer: "Gracias por su compra",
      nonFiscalLegend: "Documento no fiscal",
      showOrderNumber: true,
      showDate: true,
      showTable: true,
      showWaiter: true,
      showCustomer: true,
      showItemQuantity: true,
      showItemUnitPrice: true,
      showItemTotal: true,
      showPaymentSummary: true,
    },
  },
};

const nowIso = () => new Date().toISOString();
const flag = (value: unknown) => Number(value) === 1;
const json = (value: unknown) => JSON.stringify(value);
const jsonStringArray = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};
const normalizePhone = (value: string) => value.replace(/\D/g, "");

function requireRow<T>(value: T | undefined | null, message: string): T {
  if (!value) throw new Error(message);
  return value;
}

export interface SqliteRepositoryOptions {
  adminPin?: string;
  seedStarterCatalog?: boolean;
}

export class SqliteGastronomyRepository implements GastronomyRepository {
  readonly db: SqliteDatabase;
  private readonly adminUserId = "user-admin";

  constructor(path: string, options: SqliteRepositoryOptions = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
    this.recoverInterruptedPrintClaims();
    this.seed(options);
  }

  private recoverInterruptedPrintClaims() {
    this.db
      .prepare(
        `UPDATE print_jobs SET status = 'QUEUED',
          last_error = COALESCE(last_error, 'La aplicación se cerró durante el reintento')
         WHERE status = 'RECOVERING'`,
      )
      .run();
  }

  close() {
    this.db.close();
  }

  backupTo(path: string) {
    return this.db.backup(path);
  }

  static validateDatabase(path: string) {
    const candidate = new Database(path, { readonly: true });
    try {
      const integrity = candidate.pragma("integrity_check", { simple: true });
      if (integrity !== "ok")
        throw new Error(
          `La copia no superó integrity_check: ${String(integrity)}`,
        );
      const tables = candidate
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Row[];
      const names = new Set(tables.map((row) => String(row.name)));
      for (const required of [
        "schema_migrations",
        "orders",
        "users",
        "audit_log",
      ]) {
        if (!names.has(required))
          throw new Error("El archivo no es una copia válida de Gastronomía.");
      }
    } finally {
      candidate.close();
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = new Set(
      (
        this.db
          .prepare("SELECT version FROM schema_migrations")
          .all() as Array<{ version: number }>
      ).map((row) => row.version),
    );
    const apply = this.db.transaction(() => {
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        this.db.exec(migration.sql);
        this.db
          .prepare(
            "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(migration.version, migration.name, nowIso());
      }
    });
    apply();
  }

  private seed(options: SqliteRepositoryOptions) {
    const seed = this.db.transaction(() => {
      const timestamp = nowIso();
      this.db
        .prepare(
          "INSERT OR IGNORE INTO settings(key, value_json, updated_at) VALUES ('app', ?, ?)",
        )
        .run(json(DEFAULT_SETTINGS), timestamp);
      for (const sequence of ["cash_session", "order"]) {
        this.db
          .prepare("INSERT OR IGNORE INTO sequences(name, value) VALUES (?, 0)")
          .run(sequence);
      }

      for (const permission of SYSTEM_PERMISSIONS) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO permissions(code, description) VALUES (?, ?)",
          )
          .run(permission, permission);
      }
      for (const [code, permissions] of Object.entries(
        DEFAULT_ROLE_PERMISSIONS,
      )) {
        const roleId = `role-${code.toLowerCase()}`;
        this.db
          .prepare(
            "INSERT OR IGNORE INTO roles(id, code, name) VALUES (?, ?, ?)",
          )
          .run(roleId, code, code);
        for (const permission of permissions) {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)",
            )
            .run(roleId, permission);
        }
      }
      const adminPin =
        options.adminPin ?? process.env.GASTRONOMY_ADMIN_PIN ?? "1234";
      const pinHash = bcrypt.hashSync(adminPin, 12);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO users(id, staff_number, full_name, role_id, pin_hash, must_change_pin, active, created_at, updated_at)
           VALUES (?, 1, 'Administrador', 'role-admin', ?, 1, 1, ?, ?)`,
        )
        .run(this.adminUserId, pinHash, timestamp, timestamp);

      const priceLists = [
        ["price-salon", "SALON", "Salón", 1],
        ["price-takeaway", "TAKEAWAY", "Takeaway", 2],
        ["price-delivery", "DELIVERY", "Delivery", 3],
      ] as const;
      for (const priceList of priceLists) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO price_lists(id, code, name, sort_order) VALUES (?, ?, ?, ?)",
          )
          .run(...priceList);
      }
      const methods = [
        ["payment-cash", "CASH", "Efectivo", 1, 1],
        ["payment-transfer", "TRANSFER", "Transferencia", 0, 2],
        ["payment-debit", "DEBIT", "Débito", 0, 3],
        ["payment-credit", "CREDIT", "Crédito", 0, 4],
      ] as const;
      for (const method of methods) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO payment_methods(id, code, name, affects_cash, sort_order) VALUES (?, ?, ?, ?, ?)",
          )
          .run(...method);
      }
      const categoryCount = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) AS count FROM categories")
            .get() as Row
        ).count,
      );
      if (categoryCount === 0) {
        const categories = ["Pizzas", "Empanadas", "Bebidas", "Otros"];
        categories.forEach((name, index) => {
          this.db
            .prepare(
              "INSERT OR IGNORE INTO categories(id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(
              `category-${index + 1}`,
              name,
              index + 1,
              timestamp,
              timestamp,
            );
        });
      }
      for (let number = 1; number <= 10; number += 1) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO restaurant_tables(id, number, sort_order) VALUES (?, ?, ?)",
          )
          .run(`table-${number}`, number, number);
      }
      this.db
        .prepare(
          "INSERT OR IGNORE INTO modifier_groups(id, name, sort_order) VALUES ('modifier-group-extras', 'Extras', 1)",
        )
        .run();
      if (options.seedStarterCatalog) this.seedStarterCatalog(timestamp);
    });
    seed();
  }

  private seedStarterCatalog(timestamp: string) {
    const products = [
      [
        "starter-muzza-grande",
        "category-1",
        "Muzzarella grande",
        "MUZG",
        1_500_000,
      ],
      [
        "starter-napo-grande",
        "category-1",
        "Napolitana grande",
        "NAPG",
        1_800_000,
      ],
      [
        "starter-especial-grande",
        "category-1",
        "Especial grande",
        "ESPG",
        2_000_000,
      ],
      ["starter-emp-carne", "category-2", "Empanada de carne", "EMPC", 180_000],
      ["starter-gaseosa", "category-3", "Gaseosa 1,5 L", "GAS15", 450_000],
    ] as const;
    for (const [id, categoryId, name, code, salonPrice] of products) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO products(id, category_id, name, code, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(id, categoryId, name, code, timestamp, timestamp);
      for (const [priceListId, multiplier] of [
        ["price-salon", 1],
        ["price-takeaway", 1],
        ["price-delivery", 1],
      ] as const) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO product_prices(product_id, price_list_id, amount_minor, updated_at) VALUES (?, ?, ?, ?)",
          )
          .run(id, priceListId, Math.round(salonPrice * multiplier), timestamp);
      }
    }
  }

  private idempotentTransaction<T>(
    idempotencyKey: string | undefined,
    terminalId: string | undefined,
    operation: string,
    cashSessionId: string | undefined,
    requestPayload: any,
    fn: () => T,
  ): T {
    // Para simplificar tests, generamos UUIDs locales si no se proveen.
    const key = idempotencyKey || randomUUID();
    const term = terminalId || "TEST_TERMINAL";
    const requestHash = createHash("sha256")
      .update(JSON.stringify(requestPayload))
      .digest("hex");
    const run = this.db.transaction(() => {
      const receipt = this.db
        .prepare("SELECT * FROM command_receipts WHERE idempotency_key = ?")
        .get(key) as Record<string, unknown> | undefined;
      if (receipt) {
        if (receipt.request_hash !== requestHash) {
          throw new Error(
            "Petición rechazada: La clave de idempotencia fue reutilizada con datos diferentes.",
          );
        }
        if (receipt.status === "FAILED") {
          throw new Error(
            "La petición previa falló: " + String(receipt.error_reason),
          );
        }
        return JSON.parse(String(receipt.persisted_result_json)) as T;
      }
      const result = fn();
      this.db
        .prepare(
          `INSERT INTO command_receipts (idempotency_key, terminal_id, cash_session_id, operation, request_hash, status, persisted_result_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?, ?)`,
        )
        .run(
          key,
          term,
          cashSessionId || null,
          operation,
          requestHash,
          JSON.stringify(result),
          new Date().toISOString(),
        );
      return result;
    });
    return run();
  }

  private nextSequence(name: "cash_session" | "order") {
    this.db
      .prepare("UPDATE sequences SET value = value + 1 WHERE name = ?")
      .run(name);
    return Number(
      (
        this.db
          .prepare("SELECT value FROM sequences WHERE name = ?")
          .get(name) as Row
      ).value,
    );
  }

  private currentUser(): UserDto {
    const row = requireRow(
      this.db
        .prepare(
          `SELECT u.id, u.staff_number, u.full_name, u.active, r.code AS role_code, r.name AS role_name
           FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
        )
        .get(this.adminUserId) as Row | undefined,
      "No existe el usuario operativo.",
    );
    const permissions = (
      this.db
        .prepare(
          `SELECT rp.permission_code FROM role_permissions rp
           JOIN users u ON u.role_id = rp.role_id WHERE u.id = ? ORDER BY rp.permission_code`,
        )
        .all(this.adminUserId) as Row[]
    ).map((permission) => String(permission.permission_code));
    return {
      id: String(row.id),
      staffNumber: Number(row.staff_number),
      fullName: String(row.full_name),
      roleCode: String(row.role_code) as UserDto["roleCode"],
      roleName: String(row.role_name),
      permissions,
      active: flag(row.active),
    };
  }

  private getSettings(): AppSettingsDto {
    const row = requireRow(
      this.db
        .prepare("SELECT value_json FROM settings WHERE key = 'app'")
        .get() as Row | undefined,
      "No existe la configuración principal.",
    );
    const stored = JSON.parse(
      String(row.value_json),
    ) as Partial<AppSettingsDto>;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      // Multiple open sessions are unsafe until every command is explicitly
      // scoped to a terminal/cash-session identifier.
      maxConcurrentCashSessions: 1,
      modules: {
        ...DEFAULT_SETTINGS.modules,
        ...stored.modules,
      },
      printing: {
        ...DEFAULT_SETTINGS.printing,
        ...stored.printing,
        kitchen: {
          ...DEFAULT_SETTINGS.printing.kitchen,
          ...stored.printing?.kitchen,
        },
        bill: {
          ...DEFAULT_SETTINGS.printing.bill,
          ...stored.printing?.bill,
        },
        receiptTemplate: {
          ...DEFAULT_SETTINGS.printing.receiptTemplate,
          ...stored.printing?.receiptTemplate,
        },
      },
    };
  }

  private getOpenCashSessionRow() {
    return this.db
      .prepare(
        "SELECT * FROM cash_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1",
      )
      .get() as Row | undefined;
  }

  private requireOpenCashSessionRow() {
    return requireRow(
      this.getOpenCashSessionRow(),
      "Abrí una caja antes de operar.",
    );
  }

  private cashSessionDto(row: Row): CashSessionDto {
    const movements = this.db
      .prepare(
        "SELECT type, amount_minor, affects_cash FROM cash_movements WHERE cash_session_id = ?",
      )
      .all(row.id) as Row[];
    const expected =
      row.expected_amount_minor == null
        ? calculateExpectedCash(
            Number(row.opening_amount_minor),
            movements.map((movement) => ({
              type: String(movement.type) as never,
              amountMinor: Number(movement.amount_minor),
              affectsCash: flag(movement.affects_cash),
            })),
          )
        : Number(row.expected_amount_minor);
    const movementTotal = (type: string) =>
      movements
        .filter(
          (movement) =>
            String(movement.type) === type && flag(movement.affects_cash),
        )
        .reduce((sum, movement) => sum + Number(movement.amount_minor), 0);
    const user = this.db
      .prepare("SELECT full_name FROM users WHERE id = ?")
      .get(row.opened_by_user_id) as Row;
    const sales = this.db
      .prepare(
        "SELECT type, paid_minor FROM orders WHERE cash_session_paid_id = ? AND lifecycle_status = 'CONFIRMED' AND operational_status <> 'CANCELLED' AND paid_minor > 0",
      )
      .all(row.id) as Row[];
    const salesByType: Record<OrderType, number> = {
      DINE_IN: 0,
      TAKEAWAY: 0,
      DELIVERY: 0,
    };
    for (const sale of sales)
      salesByType[String(sale.type) as keyof typeof salesByType] += Number(
        sale.paid_minor,
      );
    const salesByPaymentMethod = this.db
      .prepare(
        "SELECT pm.code, pm.name, SUM(p.amount_minor - COALESCE(r.refunded_minor, 0)) amount_minor FROM payments p JOIN payment_methods pm ON pm.id = p.payment_method_id LEFT JOIN (SELECT payment_id, SUM(amount_minor) refunded_minor FROM payment_refunds GROUP BY payment_id) r ON r.payment_id = p.id WHERE p.cash_session_id = ? GROUP BY pm.id HAVING SUM(p.amount_minor - COALESCE(r.refunded_minor, 0)) > 0 ORDER BY pm.sort_order",
      )
      .all(row.id) as Row[];
    return {
      id: String(row.id),
      number: Number(row.number),
      businessDate: String(row.business_date),
      openedAt: String(row.opened_at),
      closedAt: row.closed_at == null ? null : String(row.closed_at),
      openedByUserId: String(row.opened_by_user_id),
      openedByName: String(user.full_name),
      openingAmountMinor: Number(row.opening_amount_minor),
      expectedAmountMinor: expected,
      countedAmountMinor:
        row.counted_amount_minor == null
          ? null
          : Number(row.counted_amount_minor),
      differenceMinor:
        row.difference_minor == null ? null : Number(row.difference_minor),
      closingFloatAmountMinor:
        row.closing_float_amount_minor == null
          ? null
          : Number(row.closing_float_amount_minor),
      cashRemovedAmountMinor:
        row.cash_removed_amount_minor == null
          ? null
          : Number(row.cash_removed_amount_minor),
      floatDifferenceMinor:
        row.float_difference_minor == null
          ? null
          : Number(row.float_difference_minor),
      cashSalesMinor: movementTotal("SALE"),
      cashIncomeMinor: movementTotal("INCOME"),
      cashExpenseMinor: movementTotal("EXPENSE"),
      cashWithdrawalMinor: movementTotal("WITHDRAWAL"),
      cashRefundMinor: movementTotal("REFUND"),
      salesTotalMinor: sales.reduce(
        (sum, sale) => sum + Number(sale.paid_minor),
        0,
      ),
      salesByType,
      salesByPaymentMethod: salesByPaymentMethod.map((sale) => ({
        code: String(sale.code),
        name: String(sale.name),
        amountMinor: Number(sale.amount_minor),
      })),
      status: String(row.status) as CashSessionDto["status"],
    };
  }

  private audit(input: {
    entityType: string;
    entityId: string;
    action: string;
    permission?: string;
    reason?: string;
    before?: unknown;
    after?: unknown;
    authorizerUserId?: string;
  }) {
    const session = this.getOpenCashSessionRow();
    this.db
      .prepare(
        `INSERT INTO audit_log(id, timestamp, business_date, operator_user_id, authorizer_user_id,
          permission_used, entity_type, entity_id, action, before_json, after_json, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        nowIso(),
        session?.business_date ?? null,
        this.adminUserId,
        input.authorizerUserId ?? null,
        input.permission ?? null,
        input.entityType,
        input.entityId,
        input.action,
        input.before == null ? null : json(input.before),
        input.after == null ? null : json(input.after),
        input.reason ?? null,
      );
  }

  private event(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: unknown,
  ) {
    this.db
      .prepare(
        `INSERT INTO domain_events(id, aggregate_type, aggregate_id, event_type, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        aggregateType,
        aggregateId,
        eventType,
        json(payload),
        nowIso(),
      );
  }

  bootstrap(): BootstrapDto {
    const currentCash = this.getOpenCashSessionRow();
    return {
      settings: this.getSettings(),
      currentUser: this.currentUser(),
      cashSession: currentCash ? this.cashSessionDto(currentCash) : null,
      categories: this.listCategories(),
      products: this.listProducts(),
      modifiers: this.listModifiers(),
      tables: this.listTables(),
      orders: this.listBootstrapOrders(),
      users: this.listUsers(),
      deliveryLedger: this.listDeliveryLedger(),
      driverDeliveryActivity: this.listDriverDeliveryActivity(),
      paymentMethods: this.listPaymentMethods(),
      printJobs: this.listPrintJobs(),
      dashboard: this.getDashboard(
        currentCash ? String(currentCash.business_date) : undefined,
      ),
    };
  }

  ensureTable(number: number): RestaurantTableDto {
    const run = this.db.transaction(() => {
      const existing = this.listTables().find(
        (table) => table.number === number,
      );
      if (existing) {
        if (!existing.active) {
          this.db
            .prepare("UPDATE restaurant_tables SET active = 1 WHERE id = ?")
            .run(existing.id);
          this.audit({
            entityType: "RESTAURANT_TABLE",
            entityId: existing.id,
            action: "TABLE_REACTIVATED",
            after: { number },
          });
        }
        return requireRow(
          this.listTables().find((table) => table.number === number),
          "No se pudo leer la mesa.",
        );
      }
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO restaurant_tables(id, number, active, sort_order)
           VALUES (?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM restaurant_tables))`,
        )
        .run(id, number);
      this.audit({
        entityType: "RESTAURANT_TABLE",
        entityId: id,
        action: "TABLE_CREATED",
        after: { number },
      });
      this.event("RestaurantTable", id, "RestaurantTableCreated", { number });
      return requireRow(
        this.listTables().find((table) => table.id === id),
        "No se pudo leer la mesa creada.",
      );
    });
    return run();
  }

  openCashSession(input: OpenCashSessionInput): CashSessionDto {
    nonNegativeMoney(input.openingAmountMinor, "cambio inicial");
    const run = this.db.transaction(() => {
      const openCount = Number(
        (
          this.db
            .prepare(
              "SELECT COUNT(*) AS count FROM cash_sessions WHERE status = 'OPEN'",
            )
            .get() as Row
        ).count,
      );
      if (openCount >= 1) {
        throw new Error(
          "La versión local admite una sola caja abierta a la vez.",
        );
      }
      const id = randomUUID();
      const openedAt = nowIso();
      const number = this.nextSequence("cash_session");
      const businessDate = businessDateFromOpening(openedAt);
      this.db
        .prepare(
          `INSERT INTO cash_sessions(id, number, business_date, opened_at, opened_by_user_id,
            opening_amount_minor, status, note) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
        )
        .run(
          id,
          number,
          businessDate,
          openedAt,
          this.adminUserId,
          input.openingAmountMinor,
          input.note ?? null,
        );
      this.db
        .prepare(
          `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash, user_id, reason, created_at)
           VALUES (?, ?, 'OPENING', ?, 0, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          input.openingAmountMinor,
          this.adminUserId,
          input.note ?? "Apertura",
          openedAt,
        );
      this.audit({
        entityType: "CASH_SESSION",
        entityId: id,
        action: "CASH_OPENED",
        after: { number, businessDate },
      });
      this.event("CashSession", id, "CashOpened", { number, businessDate });
      return this.cashSessionDto(
        this.db
          .prepare("SELECT * FROM cash_sessions WHERE id = ?")
          .get(id) as Row,
      );
    });
    return run();
  }

  registerCashMovement(input: CashMovementInput): CashSessionDto {
    assertMoneyMinor(input.amountMinor);
    if (input.amountMinor === 0)
      throw new Error("El movimiento debe tener un importe distinto de cero.");
    if (input.type !== "ADJUSTMENT") nonNegativeMoney(input.amountMinor);
    const reason = input.reason.trim();
    if (!reason) throw new Error("El movimiento requiere un motivo.");
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "registerCashMovement",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          const session = this.requireOpenCashSessionRow();
          const currentCash = this.cashSessionDto(session);
          if (
            (["EXPENSE", "WITHDRAWAL"].includes(input.type) &&
              input.amountMinor > currentCash.expectedAmountMinor) ||
            (input.type === "ADJUSTMENT" &&
              currentCash.expectedAmountMinor + input.amountMinor < 0)
          )
            throw new Error(
              "La caja no tiene efectivo suficiente. Registrá un ingreso o corregí el importe antes de continuar.",
            );
          this.db
            .prepare(
              `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash, user_id, reason, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              session.id,
              input.type,
              input.amountMinor,
              this.adminUserId,
              reason,
              nowIso(),
            );
          this.audit({
            entityType: "CASH_SESSION",
            entityId: String(session.id),
            action: `CASH_${input.type}`,
            permission:
              input.type === "WITHDRAWAL" ? "cash.withdraw" : "cash.expense",
            reason,
            after: { amountMinor: input.amountMinor },
          });
          this.event(
            "CashSession",
            String(session.id),
            "CashMovementRecorded",
            {
              ...input,
              reason,
            },
          );
          return this.cashSessionDto(session);
        });
        return run();
      },
    );
  }

  closeCashSession(input: CloseCashSessionInput): CashSessionDto {
    nonNegativeMoney(input.countedAmountMinor, "efectivo contado");
    if (input.closingFloatAmountMinor != null)
      nonNegativeMoney(input.closingFloatAmountMinor, "cambio final");
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "closeCashSession",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          if (
            input.closingFloatAmountMinor != null &&
            input.closingFloatAmountMinor > input.countedAmountMinor
          )
            throw new Error(
              "El cambio final no puede superar el efectivo contado.",
            );
          const session = this.requireOpenCashSessionRow();
          const settings = this.getSettings();
          if (input.force && !input.reason?.trim())
            throw new Error("El cierre forzado requiere un motivo.");
          const authorizer = input.force
            ? this.authorizePin(input.authorizerPin ?? "", "cash.close")
            : null;
          const pending = this.db
            .prepare(
              `SELECT id, number FROM orders
           WHERE operational_status NOT IN ('DELIVERED','CANCELLED')`,
            )
            .all() as Row[];
          const pendingDeliveryLedger = this.db
            .prepare(
              `SELECT COUNT(*) AS count,
             COALESCE(SUM(amount_due_minor - settled_amount_minor), 0) AS balance_minor,
             COALESCE(SUM(CASE WHEN direction = 'DRIVER_OWES_BUSINESS' THEN amount_due_minor - settled_amount_minor ELSE 0 END), 0) AS driver_owes_minor,
             COALESCE(SUM(CASE WHEN direction = 'BUSINESS_OWES_DRIVER' THEN amount_due_minor - settled_amount_minor ELSE 0 END), 0) AS business_owes_minor
           FROM delivery_ledger
           WHERE status = 'PENDING' AND amount_due_minor > settled_amount_minor`,
            )
            .get() as Row;
          const pendingDeliveryDetails = this.db
            .prepare(
              `SELECT dl.id,
             dl.order_id,
             o.number AS order_number,
             dl.driver_user_id,
             u.full_name AS driver_name,
             dl.direction,
             dl.amount_due_minor - dl.settled_amount_minor AS outstanding_minor
           FROM delivery_ledger dl
           JOIN orders o ON o.id = dl.order_id
           JOIN users u ON u.id = dl.driver_user_id
           WHERE dl.status = 'PENDING'
             AND dl.amount_due_minor > dl.settled_amount_minor
           ORDER BY dl.created_at, dl.id`,
            )
            .all() as Row[];
          if (
            pending.length &&
            !settings.allowCloseWithPendingOrders &&
            !input.force
          ) {
            throw new Error(
              `No se puede cerrar la caja: hay ${pending.length} pedido(s) pendiente(s).`,
            );
          }
          if (Number(pendingDeliveryLedger.count) > 0 && !input.force) {
            throw new Error(
              `No se puede cerrar la caja: hay ${Number(pendingDeliveryLedger.count)} rendición(es) de delivery pendiente(s). Liquidá los saldos o usá un cierre forzado.`,
            );
          }
          const dtoBefore = this.cashSessionDto(session);
          const closingFloatAmountMinor =
            input.closingFloatAmountMinor ?? dtoBefore.openingAmountMinor;
          const reconciliation = calculateCashClosing(
            dtoBefore.expectedAmountMinor,
            input.countedAmountMinor,
            dtoBefore.openingAmountMinor,
            closingFloatAmountMinor,
          );
          const difference = reconciliation.differenceMinor;
          if (difference !== 0 && !input.reason?.trim())
            throw new Error(
              "Explicá la diferencia entre lo esperado y lo contado.",
            );
          const cashRemovedAmountMinor = reconciliation.cashRemovedAmountMinor;
          const floatDifferenceMinor = reconciliation.floatDifferenceMinor;
          const closedAt = nowIso();
          this.db
            .prepare(
              `UPDATE cash_sessions SET closed_at = ?, closed_by_user_id = ?, expected_amount_minor = ?,
           counted_amount_minor = ?, difference_minor = ?, closing_float_amount_minor = ?,
           cash_removed_amount_minor = ?, float_difference_minor = ?, status = 'CLOSED' WHERE id = ?`,
            )
            .run(
              closedAt,
              this.adminUserId,
              dtoBefore.expectedAmountMinor,
              input.countedAmountMinor,
              difference,
              closingFloatAmountMinor,
              cashRemovedAmountMinor,
              floatDifferenceMinor,
              session.id,
            );
          this.db
            .prepare(
              `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash, user_id, reason, created_at)
           VALUES (?, ?, 'CLOSING', ?, 0, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              session.id,
              input.countedAmountMinor,
              this.adminUserId,
              input.reason ?? null,
              closedAt,
            );
          this.audit({
            entityType: "CASH_SESSION",
            entityId: String(session.id),
            action: input.force ? "CASH_FORCE_CLOSED" : "CASH_CLOSED",
            permission: "cash.close",
            reason: input.reason,
            authorizerUserId: authorizer ? String(authorizer.id) : undefined,
            before: dtoBefore,
            after: {
              countedAmountMinor: input.countedAmountMinor,
              differenceMinor: difference,
              closingFloatAmountMinor,
              cashRemovedAmountMinor,
              floatDifferenceMinor,
              pending: pending.length,
              pendingOrders: pending.map((order) => ({
                id: String(order.id),
                number: Number(order.number),
              })),
              pendingDeliverySettlements: Number(pendingDeliveryLedger.count),
              pendingDeliveryDetails: pendingDeliveryDetails.map((entry) => ({
                id: String(entry.id),
                orderId: String(entry.order_id),
                orderNumber: Number(entry.order_number),
                driverUserId: String(entry.driver_user_id),
                driverName: String(entry.driver_name),
                direction: String(entry.direction),
                outstandingMinor: Number(entry.outstanding_minor),
              })),
              pendingDeliveryBalanceMinor: Number(
                pendingDeliveryLedger.balance_minor,
              ),
              pendingDriverOwesMinor: Number(
                pendingDeliveryLedger.driver_owes_minor,
              ),
              pendingBusinessOwesMinor: Number(
                pendingDeliveryLedger.business_owes_minor,
              ),
            },
          });
          this.event("CashSession", String(session.id), "CashClosed", {
            differenceMinor: difference,
            closingFloatAmountMinor,
            cashRemovedAmountMinor,
            floatDifferenceMinor,
          });
          return this.cashSessionDto(
            this.db
              .prepare("SELECT * FROM cash_sessions WHERE id = ?")
              .get(session.id) as Row,
          );
        });
        return run();
      },
    );
  }

  private listCategories(): CategoryDto[] {
    return (
      this.db
        .prepare("SELECT * FROM categories ORDER BY sort_order, name")
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      sortOrder: Number(row.sort_order),
      active: flag(row.active),
    }));
  }

  private listProducts(): ProductDto[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, c.name AS category_name FROM products p
         JOIN categories c ON c.id = p.category_id ORDER BY c.sort_order, p.sort_order, p.name`,
      )
      .all() as Row[];
    const pricesStatement = this.db.prepare(
      `SELECT pp.price_list_id, pl.code AS price_list_code, pp.amount_minor
       FROM product_prices pp JOIN price_lists pl ON pl.id = pp.price_list_id
       WHERE pp.product_id = ? ORDER BY pl.sort_order`,
    );
    return rows.map((row) => ({
      id: String(row.id),
      categoryId: String(row.category_id),
      categoryName: String(row.category_name),
      name: String(row.name),
      code: row.code == null ? null : String(row.code),
      sortOrder: Number(row.sort_order),
      active: flag(row.active),
      stockMinor: row.stock_minor == null ? null : Number(row.stock_minor),
      prices: (pricesStatement.all(row.id) as Row[]).map((price) => ({
        priceListId: String(price.price_list_id),
        priceListCode: String(price.price_list_code),
        amountMinor: Number(price.amount_minor),
      })),
    }));
  }

  private listPaymentMethods(): PaymentMethodDto[] {
    return (
      this.db
        .prepare("SELECT * FROM payment_methods ORDER BY sort_order, name")
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      affectsCash: flag(row.affects_cash),
      active: flag(row.active),
    }));
  }

  private listModifiers(): ModifierDto[] {
    return (
      this.db
        .prepare(
          `SELECT m.*, g.name AS group_name FROM modifiers m
      JOIN modifier_groups g ON g.id = m.group_id ORDER BY g.sort_order, m.sort_order, m.name`,
        )
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      groupId: String(row.group_id),
      groupName: String(row.group_name),
      name: String(row.name),
      priceMinor: Number(row.price_minor),
      active: flag(row.active),
    }));
  }

  private listUsers(): UserDto[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.staff_number, u.full_name, u.active, r.code AS role_code, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`,
      )
      .all() as Row[];
    const permissions = this.db
      .prepare(`SELECT rp.permission_code FROM role_permissions rp
      JOIN users u ON u.role_id = rp.role_id WHERE u.id = ? ORDER BY rp.permission_code`);
    return rows.map((row) => ({
      id: String(row.id),
      staffNumber: Number(row.staff_number),
      fullName: String(row.full_name),
      roleCode: String(row.role_code) as UserDto["roleCode"],
      roleName: String(row.role_name),
      permissions: (permissions.all(row.id) as Row[]).map((value) =>
        String(value.permission_code),
      ),
      active: flag(row.active),
    }));
  }

  private nextAvailableStaffNumber(): number {
    const used = this.db
      .prepare(
        "SELECT staff_number FROM users WHERE staff_number > 0 ORDER BY staff_number",
      )
      .all() as Row[];
    let candidate = 1;
    for (const row of used) {
      const value = Number(row.staff_number);
      if (value === candidate) candidate += 1;
      else if (value > candidate) break;
    }
    return candidate;
  }

  private assertStaffNumberAvailable(staffNumber: number, userId?: Id) {
    const duplicate = this.db
      .prepare(
        "SELECT id FROM users WHERE staff_number = ? AND (? IS NULL OR id <> ?)",
      )
      .get(staffNumber, userId ?? null, userId ?? null) as Row | undefined;
    if (duplicate)
      throw new Error(`El número de usuario ${staffNumber} ya está ocupado.`);
  }

  private listDeliveryLedger(): DeliveryLedgerDto[] {
    return (
      this.db
        .prepare(
          `SELECT dl.*, o.number AS order_number, u.full_name AS driver_name
      FROM delivery_ledger dl JOIN orders o ON o.id = dl.order_id
      JOIN users u ON u.id = dl.driver_user_id
      WHERE dl.status <> 'PENDING' OR dl.amount_due_minor > dl.settled_amount_minor
      ORDER BY dl.created_at DESC`,
        )
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      orderNumber: Number(row.order_number),
      driverUserId: String(row.driver_user_id),
      driverName: String(row.driver_name),
      restaurantAmountMinor: Number(row.restaurant_amount_minor),
      deliveryFeeMinor: Number(row.delivery_fee_minor),
      direction: String(row.direction) as DeliveryLedgerDto["direction"],
      amountDueMinor: Number(row.amount_due_minor),
      settledAmountMinor: Number(row.settled_amount_minor),
      status: String(row.status) as DeliveryLedgerDto["status"],
      createdAt: String(row.created_at),
      settledAt: row.settled_at == null ? null : String(row.settled_at),
    }));
  }

  private listDriverDeliveryActivity(): DriverDeliveryActivityDto[] {
    return (
      this.db
        .prepare(
          `SELECT driver_user_id, COUNT(*) AS delivery_count,
                  COALESCE(SUM(delivery_fee_minor), 0) AS earnings_minor,
                  MAX(updated_at) AS last_delivery_at
           FROM orders
           WHERE type = 'DELIVERY'
             AND operational_status = 'DELIVERED'
             AND driver_user_id IS NOT NULL
           GROUP BY driver_user_id
           ORDER BY last_delivery_at DESC`,
        )
        .all() as Row[]
    ).map((row) => ({
      driverUserId: String(row.driver_user_id),
      deliveryCount: Number(row.delivery_count),
      earningsMinor: Number(row.earnings_minor),
      lastDeliveryAt: String(row.last_delivery_at),
    }));
  }

  private listPrintJobs(): PrintJobDto[] {
    return (
      this.db
        .prepare(
          `WITH recent_printed AS (
             SELECT id FROM print_jobs
             WHERE status = 'PRINTED'
             ORDER BY created_at DESC LIMIT 100
           )
           SELECT pj.*, o.number AS order_number FROM print_jobs pj
           JOIN orders o ON o.id = pj.order_id
            WHERE pj.status IN ('QUEUED', 'RECOVERING', 'FAILED')
              OR pj.id IN (SELECT id FROM recent_printed)
           ORDER BY pj.created_at DESC`,
        )
        .all() as Row[]
    ).map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      orderNumber: Number(row.order_number),
      kind: String(row.kind) as PrintJobDto["kind"],
      status: String(row.status) as PrintJobDto["status"],
      printerName: row.printer_name == null ? null : String(row.printer_name),
      copies: Number(row.copies),
      attempts: Number(row.attempts),
      lastError: row.last_error == null ? null : String(row.last_error),
      createdAt: String(row.created_at),
      printedAt: row.printed_at == null ? null : String(row.printed_at),
    }));
  }

  private authorizePin(pin: string, permission: string) {
    return requireRow(
      (
        this.db
          .prepare(
            `SELECT DISTINCT u.* FROM users u
        JOIN role_permissions rp ON rp.role_id = u.role_id
        WHERE u.active = 1 AND rp.permission_code = ?`,
          )
          .all(permission) as Row[]
      ).find((row) => bcrypt.compareSync(pin, String(row.pin_hash))),
      "PIN incorrecto o usuario sin permiso.",
    );
  }

  private listTables(): RestaurantTableDto[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, o.id AS current_order_id, o.total_minor AS current_total_minor,
          o.created_at AS order_opened_at, u.full_name AS waiter_name
         FROM restaurant_tables t
         LEFT JOIN orders o ON o.table_id = t.id AND o.operational_status NOT IN ('DELIVERED','CANCELLED')
         LEFT JOIN users u ON u.id = o.waiter_user_id
         ORDER BY t.sort_order, t.number`,
      )
      .all() as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      number: Number(row.number),
      name: row.name == null ? null : String(row.name),
      active: flag(row.active),
      sortOrder: Number(row.sort_order),
      currentOrderId:
        row.current_order_id == null ? null : String(row.current_order_id),
      currentTotalMinor: Number(row.current_total_minor ?? 0),
      waiterName: row.waiter_name == null ? null : String(row.waiter_name),
      openedAt:
        row.order_opened_at == null ? null : String(row.order_opened_at),
    }));
  }

  private listBootstrapOrders(): OrderDto[] {
    return (
      this.db
        .prepare(
          `WITH actionable AS (
             SELECT o.id, o.created_at
             FROM orders o
             WHERE o.lifecycle_status = 'DRAFT'
                OR o.operational_status NOT IN ('DELIVERED', 'CANCELLED')
                OR (o.payment_status <> 'PAID' AND o.operational_status <> 'CANCELLED')
                OR EXISTS (
                  SELECT 1 FROM print_jobs pj
                  WHERE pj.order_id = o.id AND pj.status IN ('QUEUED', 'FAILED')
                )
           ),
           recent_history AS (
             SELECT o.id, o.created_at
             FROM orders o
             WHERE o.id NOT IN (SELECT id FROM actionable)
             ORDER BY o.created_at DESC LIMIT 200
           )
           SELECT id FROM (
             SELECT id, created_at FROM actionable
             UNION ALL
             SELECT id, created_at FROM recent_history
           )
           ORDER BY created_at DESC`,
        )
        .all() as Row[]
    ).map((row) => this.getOrder(String(row.id)));
  }

  getOrder(id: string): OrderDto {
    const row = requireRow(
      this.db
        .prepare(
          `SELECT o.*, t.number AS table_number, waiter.full_name AS waiter_name, driver.full_name AS driver_name
           FROM orders o
           LEFT JOIN restaurant_tables t ON t.id = o.table_id
           LEFT JOIN users waiter ON waiter.id = o.waiter_user_id
           LEFT JOIN users driver ON driver.id = o.driver_user_id
           WHERE o.id = ?`,
        )
        .get(id) as Row | undefined,
      "El pedido no existe.",
    );
    const itemRows = this.db
      .prepare(
        "SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, created_at",
      )
      .all(id) as Row[];
    const halfStatement = this.db.prepare(
      "SELECT * FROM order_item_halves WHERE order_item_id = ? ORDER BY position",
    );
    const modifierStatement = this.db.prepare(
      "SELECT * FROM order_item_modifiers WHERE order_item_id = ? ORDER BY rowid",
    );
    const items = itemRows.map((item) => {
      const halves = (halfStatement.all(item.id) as Row[]).map((half) => ({
        productId: String(half.product_id),
        nameSnapshot: String(half.product_name_snapshot),
        priceMinorSnapshot: Number(half.price_minor_snapshot),
        position: String(half.position) as "FIRST" | "SECOND",
      }));
      const modifiers = (modifierStatement.all(item.id) as Row[]).map(
        (modifier) => ({
          id: String(modifier.id),
          nameSnapshot: String(modifier.name_snapshot),
          unitPriceMinorSnapshot: Number(modifier.unit_price_minor_snapshot),
          scope: String(modifier.scope) as never,
        }),
      );
      const lineTotalMinor = calculateLineTotal({
        unitPriceMinor: Number(item.unit_price_minor_snapshot),
        quantity: Number(item.quantity),
        discountMinor: Number(item.discount_minor_snapshot),
        modifierChargesMinor: modifiers.map(
          (modifier) => modifier.unitPriceMinorSnapshot,
        ),
      });
      return {
        id: String(item.id),
        productId: item.product_id == null ? null : String(item.product_id),
        productNameSnapshot: String(item.product_name_snapshot),
        quantity: Number(item.quantity),
        unitPriceMinorSnapshot: Number(item.unit_price_minor_snapshot),
        discountMinorSnapshot: Number(item.discount_minor_snapshot),
        notes: item.notes == null ? null : String(item.notes),
        halves,
        modifiers,
        lineTotalMinor,
      };
    });
    const payments = (
      this.db
        .prepare(
          `SELECT p.*, pm.code AS method_code, pm.name AS method_name,
             COALESCE((SELECT SUM(pr.amount_minor) FROM payment_refunds pr WHERE pr.payment_id = p.id), 0) AS refunded_minor
           FROM payments p
           JOIN payment_methods pm ON pm.id = p.payment_method_id WHERE p.order_id = ? ORDER BY p.created_at`,
        )
        .all(id) as Row[]
    ).map((payment) => {
      const amountMinor = Number(payment.amount_minor);
      const refundedMinor = Number(payment.refunded_minor);
      const refundableMinor = Math.max(0, amountMinor - refundedMinor);
      return {
        id: String(payment.id),
        methodCode: String(payment.method_code),
        methodName: String(payment.method_name),
        amountMinor,
        receivedMinor:
          payment.received_minor == null
            ? null
            : Number(payment.received_minor),
        reference: payment.reference == null ? null : String(payment.reference),
        createdAt: String(payment.created_at),
        refundedMinor,
        refundableMinor,
        status:
          refundableMinor === 0
            ? ("REFUNDED" as const)
            : refundedMinor > 0
              ? ("PARTIALLY_REFUNDED" as const)
              : ("ACTIVE" as const),
      };
    });
    return {
      id: String(row.id),
      number: Number(row.number),
      type: String(row.type) as OrderDto["type"],
      operationalStatus: String(
        row.operational_status,
      ) as OrderDto["operationalStatus"],
      paymentStatus: String(row.payment_status) as OrderDto["paymentStatus"],
      lifecycleStatus: String(
        row.lifecycle_status ?? "CONFIRMED",
      ) as OrderDto["lifecycleStatus"],
      cashSessionCreatedId: String(row.cash_session_created_id),
      cashSessionPaidId:
        row.cash_session_paid_id == null
          ? null
          : String(row.cash_session_paid_id),
      tableId: row.table_id == null ? null : String(row.table_id),
      tableNumber: row.table_number == null ? null : Number(row.table_number),
      customerId: row.customer_id == null ? null : String(row.customer_id),
      customerNameSnapshot:
        row.customer_name_snapshot == null
          ? null
          : String(row.customer_name_snapshot),
      customerPhoneSnapshot:
        row.customer_phone_snapshot == null
          ? null
          : String(row.customer_phone_snapshot),
      deliveryAddressSnapshot:
        row.delivery_address_snapshot == null
          ? null
          : String(row.delivery_address_snapshot),
      deliveryAddressNotesSnapshot:
        row.delivery_address_notes_snapshot == null
          ? null
          : String(row.delivery_address_notes_snapshot),
      deliveryFeeMinor: Number(row.delivery_fee_minor),
      promisedAt: row.promised_at == null ? null : String(row.promised_at),
      scheduled: flag(row.scheduled),
      waiterUserId:
        row.waiter_user_id == null ? null : String(row.waiter_user_id),
      waiterName: row.waiter_name == null ? null : String(row.waiter_name),
      driverUserId:
        row.driver_user_id == null ? null : String(row.driver_user_id),
      driverName: row.driver_name == null ? null : String(row.driver_name),
      collectedByDriver: flag(row.collected_by_driver),
      notes: row.notes == null ? null : String(row.notes),
      subtotalMinor: Number(row.subtotal_minor),
      discountMinor: Number(row.discount_minor),
      totalMinor: Number(row.total_minor),
      paidMinor: Number(row.paid_minor),
      printedAt: row.printed_at == null ? null : String(row.printed_at),
      printCount: Number(row.print_count),
      printAttemptCount: Number(row.print_attempt_count ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      items,
      payments,
    };
  }

  private priceListCodeForOrder(type: OrderDto["type"]) {
    return type === "DINE_IN" ? "SALON" : type;
  }

  private ensureDeliveryLedger(order: OrderDto) {
    if (
      order.type !== "DELIVERY" ||
      order.paymentStatus !== "PAID" ||
      !order.driverUserId ||
      !this.getSettings().deliverySettlementEnabled
    )
      return;
    const restaurantAmount = Math.max(
      0,
      order.totalMinor - order.deliveryFeeMinor,
    );
    const direction = order.collectedByDriver
      ? "DRIVER_OWES_BUSINESS"
      : "BUSINESS_OWES_DRIVER";
    const amountDue = order.collectedByDriver
      ? restaurantAmount
      : order.deliveryFeeMinor;
    if (amountDue <= 0) return;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO delivery_ledger(id, order_id, driver_user_id, restaurant_amount_minor, delivery_fee_minor, direction, amount_due_minor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        order.id,
        order.driverUserId,
        restaurantAmount,
        order.deliveryFeeMinor,
        direction,
        amountDue,
        nowIso(),
      );
  }

  private recalculateOrder(orderId: string) {
    const itemRows = this.db
      .prepare("SELECT * FROM order_items WHERE order_id = ?")
      .all(orderId) as Row[];
    const modifierStatement = this.db.prepare(
      "SELECT unit_price_minor_snapshot FROM order_item_modifiers WHERE order_item_id = ?",
    );
    const subtotal = itemRows.reduce((total, item) => {
      const modifierCharges = (modifierStatement.all(item.id) as Row[]).map(
        (row) => Number(row.unit_price_minor_snapshot),
      );
      return (
        total +
        calculateLineTotal({
          unitPriceMinor: Number(item.unit_price_minor_snapshot),
          quantity: Number(item.quantity),
          discountMinor: Number(item.discount_minor_snapshot),
          modifierChargesMinor: modifierCharges,
        })
      );
    }, 0);
    const order = this.db
      .prepare(
        "SELECT delivery_fee_minor, discount_minor FROM orders WHERE id = ?",
      )
      .get(orderId) as Row;
    const total = Math.max(
      0,
      subtotal +
        Number(order.delivery_fee_minor) -
        Number(order.discount_minor),
    );
    this.db
      .prepare(
        "UPDATE orders SET subtotal_minor = ?, total_minor = ?, version = version + 1, updated_at = ? WHERE id = ?",
      )
      .run(subtotal, total, nowIso(), orderId);
  }

  private resolveOrderCustomer(input: CreateOrderInput) {
    let customerName = input.customerName ?? null;
    let customerPhone = input.customerPhone ?? null;
    let deliveryAddress = input.deliveryAddress ?? null;
    let deliveryAddressNotes: string | null = null;
    if (input.customerId) {
      const customer = requireRow(
        this.db
          .prepare("SELECT name, phone FROM customers WHERE id = ?")
          .get(input.customerId) as Row | undefined,
        "El cliente no existe.",
      );
      customerName = input.customerName?.trim() || String(customer.name);
      customerPhone = input.customerPhone?.trim() || String(customer.phone);
    }
    let address: Row | undefined;
    if (input.customerAddressId) {
      if (!input.customerId)
        throw new Error("La dirección seleccionada requiere un cliente.");
      address = this.db
        .prepare(
          "SELECT id, address, notes FROM customer_addresses WHERE id = ? AND customer_id = ?",
        )
        .get(input.customerAddressId, input.customerId) as Row | undefined;
      if (!address)
        throw new Error("La dirección seleccionada no pertenece al cliente.");
    } else if (input.customerId && input.deliveryAddress?.trim()) {
      address = this.db
        .prepare(
          "SELECT id, address, notes FROM customer_addresses WHERE customer_id = ? AND address = ?",
        )
        .get(input.customerId, input.deliveryAddress.trim()) as Row | undefined;
    }
    if (address) {
      deliveryAddress = String(address.address);
      deliveryAddressNotes =
        address.notes == null ? null : String(address.notes);
      if (input.type === "DELIVERY") {
        this.db
          .prepare(
            "UPDATE customer_addresses SET delivery_fee_minor = ?, updated_at = ? WHERE id = ?",
          )
          .run(input.deliveryFeeMinor ?? 0, nowIso(), address.id);
      }
    }
    return {
      customerName,
      customerPhone,
      deliveryAddress,
      deliveryAddressNotes,
    };
  }

  private requireActiveDriver(driverUserId: Id) {
    return requireRow(
      this.db
        .prepare(
          `SELECT u.id, u.full_name FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.id = ? AND u.active = 1 AND r.code = 'DELIVERY_DRIVER'`,
        )
        .get(driverUserId) as Row | undefined,
      "El repartidor no existe, está inactivo o no tiene el rol de repartidor.",
    );
  }

  createOrder(input: CreateOrderInput): OrderDto {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "createOrder",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          if (
            !Number.isSafeInteger(input.deliveryFeeMinor ?? 0) ||
            (input.deliveryFeeMinor ?? 0) < 0
          )
            throw new Error("El costo de delivery no es válido.");
          const session = this.requireOpenCashSessionRow();
          if (input.tableId) {
            const occupied = this.db
              .prepare(
                "SELECT id FROM orders WHERE table_id = ? AND operational_status NOT IN ('DELIVERED','CANCELLED')",
              )
              .get(input.tableId);
            if (occupied)
              throw new Error("La mesa ya tiene un pedido abierto.");
          }
          const {
            customerName,
            customerPhone,
            deliveryAddress,
            deliveryAddressNotes,
          } = this.resolveOrderCustomer(input);
          const id = randomUUID();
          const timestamp = nowIso();
          const number = this.nextSequence("order");
          let waiterUserId: string | null = null;
          let driverUserId: string | null = null;
          if (input.type === "DINE_IN") {
            const waiter = requireRow(
              this.db
                .prepare(
                  `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
            WHERE u.id = ? AND u.active = 1 AND r.code IN ('WAITER','MANAGER','ADMIN')`,
                )
                .get(input.waiterUserId ?? this.adminUserId) as Row | undefined,
              "El mozo seleccionado no está activo o no puede atender mesas.",
            );
            waiterUserId = String(waiter.id);
          }
          if (input.driverUserId) {
            if (input.type !== "DELIVERY")
              throw new Error("Sólo los envíos admiten repartidor.");
            driverUserId = String(
              this.requireActiveDriver(input.driverUserId).id,
            );
          }
          this.db
            .prepare(
              `INSERT INTO orders(id, number, type, operational_status, payment_status, lifecycle_status, cash_session_created_id,
            table_id, customer_id, customer_name_snapshot, customer_phone_snapshot, delivery_address_snapshot, delivery_address_notes_snapshot,
            delivery_fee_minor, promised_at, scheduled, waiter_user_id, driver_user_id, notes, created_at, updated_at)
           VALUES (?, ?, ?, 'PENDING', 'UNPAID', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              number,
              input.type,
              session.id,
              input.tableId ?? null,
              input.customerId ?? null,
              customerName,
              customerPhone,
              deliveryAddress,
              deliveryAddressNotes,
              input.deliveryFeeMinor ?? 0,
              input.promisedAt ?? null,
              input.scheduled ? 1 : 0,
              waiterUserId,
              driverUserId,
              input.notes ?? null,
              timestamp,
              timestamp,
            );
          this.audit({
            entityType: "ORDER",
            entityId: id,
            action: "ORDER_DRAFT_CREATED",
            after: { number, type: input.type, waiterUserId },
          });
          this.event("Order", id, "OrderCreated", { number, type: input.type });
          return this.getOrder(id);
        });
        return run();
      },
    );
  }

  updateDraftOrder(input: UpdateDraftOrderInput): OrderDto {
    const run = this.db.transaction(() => {
      if (
        !Number.isSafeInteger(input.deliveryFeeMinor ?? 0) ||
        (input.deliveryFeeMinor ?? 0) < 0
      )
        throw new Error("El costo de delivery no es válido.");
      const before = this.getOrder(input.orderId);
      if (before.lifecycleStatus !== "DRAFT")
        throw new Error(
          "Solo se pueden volver a editar los datos de un borrador.",
        );
      if (before.type === "DINE_IN" || input.type !== before.type)
        throw new Error("El tipo del borrador no se puede modificar.");
      if (before.paidMinor > 0)
        throw new Error("Un borrador con pagos no admite esta edición.");
      const {
        customerName,
        customerPhone,
        deliveryAddress,
        deliveryAddressNotes,
      } = this.resolveOrderCustomer(input);
      const driverUserId = input.driverUserId
        ? String(this.requireActiveDriver(input.driverUserId).id)
        : null;
      this.db
        .prepare(
          `UPDATE orders SET customer_id = ?, customer_name_snapshot = ?, customer_phone_snapshot = ?,
             delivery_address_snapshot = ?, delivery_address_notes_snapshot = ?, delivery_fee_minor = ?, promised_at = ?, scheduled = ?,
             driver_user_id = ?, notes = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.customerId ?? null,
          customerName,
          customerPhone,
          deliveryAddress,
          deliveryAddressNotes,
          input.deliveryFeeMinor ?? 0,
          input.promisedAt ?? null,
          input.scheduled ? 1 : 0,
          driverUserId,
          input.notes ?? null,
          nowIso(),
          input.orderId,
        );
      this.recalculateOrder(input.orderId);
      const after = this.getOrder(input.orderId);
      this.audit({
        entityType: "ORDER",
        entityId: input.orderId,
        action: "ORDER_DRAFT_UPDATED",
        before: {
          customerId: before.customerId,
          address: before.deliveryAddressSnapshot,
          deliveryFeeMinor: before.deliveryFeeMinor,
          promisedAt: before.promisedAt,
        },
        after: {
          customerId: after.customerId,
          address: after.deliveryAddressSnapshot,
          deliveryFeeMinor: after.deliveryFeeMinor,
          promisedAt: after.promisedAt,
        },
      });
      this.event("Order", input.orderId, "OrderDraftUpdated", {
        customerId: after.customerId,
        deliveryFeeMinor: after.deliveryFeeMinor,
      });
      return after;
    });
    return run();
  }

  confirmOrder(input: ConfirmOrderInput): OrderDto {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "confirmOrder",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          const orderId = input.orderId;
          const order = this.getOrder(orderId);
          assertOrderAction(order, "CONFIRM");
          if (this.getSettings().stockEnabled) {
            const timestamp = nowIso();
            const rows = this.db
              .prepare("SELECT * FROM order_items WHERE order_id = ?")
              .all(orderId) as Row[];
            for (const item of rows) {
              if (item.product_id) {
                const product = this.db
                  .prepare(
                    "SELECT name, stock_minor FROM products WHERE id = ?",
                  )
                  .get(item.product_id) as Row;
                const required = Number(item.quantity) * 1000;
                if (
                  product.stock_minor != null &&
                  Number(product.stock_minor) < required
                )
                  throw new Error(
                    `Stock insuficiente para ${String(product.name)}.`,
                  );
                this.db
                  .prepare(
                    "UPDATE products SET stock_minor = stock_minor - ?, updated_at = ? WHERE id = ? AND stock_minor IS NOT NULL",
                  )
                  .run(required, timestamp, item.product_id);
              } else {
                const halves = this.db
                  .prepare(
                    `SELECT h.product_id, p.name, p.stock_minor FROM order_item_halves h JOIN products p ON p.id = h.product_id WHERE h.order_item_id = ?`,
                  )
                  .all(item.id) as Row[];
                for (const half of halves) {
                  const required = Number(item.quantity) * 500;
                  if (
                    half.stock_minor != null &&
                    Number(half.stock_minor) < required
                  )
                    throw new Error(
                      `Stock insuficiente para ${String(half.name)}.`,
                    );
                  this.db
                    .prepare(
                      "UPDATE products SET stock_minor = stock_minor - ?, updated_at = ? WHERE id = ? AND stock_minor IS NOT NULL",
                    )
                    .run(required, timestamp, half.product_id);
                }
              }
            }
          }
          const timestamp = nowIso();
          this.db
            .prepare(
              `UPDATE orders SET lifecycle_status = 'CONFIRMED', operational_status = 'IN_PREPARATION', confirmed_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
            )
            .run(timestamp, timestamp, orderId);
          this.audit({
            entityType: "ORDER",
            entityId: orderId,
            action: "ORDER_CONFIRMED",
            before: { lifecycleStatus: "DRAFT" },
            after: {
              lifecycleStatus: "CONFIRMED",
              operationalStatus: "IN_PREPARATION",
            },
          });
          this.event("Order", orderId, "OrderConfirmed", {
            number: order.number,
          });
          return this.getOrder(orderId);
        });
        return run();
      },
    );
  }

  discardDraftOrder(orderId: Id): { discarded: boolean } {
    const run = this.db.transaction(() => {
      const order = this.getOrder(orderId);
      assertOrderAction(order, "DISCARD_DRAFT");
      this.db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
      this.audit({
        entityType: "ORDER",
        entityId: orderId,
        action: "ORDER_DRAFT_DISCARDED",
        before: { number: order.number, itemCount: order.items.length },
      });
      return { discarded: true };
    });
    return run();
  }

  private editableOrder(orderId: string) {
    const row = requireRow(
      this.db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId) as
        Row | undefined,
      "El pedido no existe.",
    );
    if (["CANCELLED", "DELIVERED"].includes(String(row.operational_status))) {
      throw new Error("El pedido ya no admite modificaciones.");
    }
    if (Number(row.paid_minor) > 0)
      throw new Error("Un pedido con pagos no admite edición normal.");
    return row;
  }

  addOrderItem(input: AddOrderItemInput): OrderDto {
    const run = this.db.transaction(() => {
      const order = this.editableOrder(input.orderId);
      const product = requireRow(
        this.db
          .prepare(
            `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.id = ? AND p.active = 1`,
          )
          .get(input.productId) as Row | undefined,
        "El producto no existe o está inactivo.",
      );
      const code = this.priceListCodeForOrder(
        String(order.type) as OrderDto["type"],
      );
      const price = requireRow(
        this.db
          .prepare(
            `SELECT pp.amount_minor, pp.price_list_id FROM product_prices pp
             JOIN price_lists pl ON pl.id = pp.price_list_id WHERE pp.product_id = ? AND pl.code = ?`,
          )
          .get(input.productId, code) as Row | undefined,
        `El producto no tiene precio para ${code}.`,
      );
      const catalogPriceMinor = Number(price.amount_minor);
      const unitPriceMinor = input.unitPriceMinorOverride ?? catalogPriceMinor;
      if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0)
        throw new Error("El precio manual no es válido.");
      const priceWasOverridden = unitPriceMinor !== catalogPriceMinor;
      const authorizer = priceWasOverridden
        ? this.authorizePin(input.authorizerPin ?? "", "orders.override_price")
        : null;
      const itemId = randomUUID();
      const timestamp = nowIso();
      const nextSort = Number(
        (
          this.db
            .prepare(
              "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM order_items WHERE order_id = ?",
            )
            .get(input.orderId) as Row
        ).next,
      );
      this.db
        .prepare(
          `INSERT INTO order_items(id, order_id, product_id, product_name_snapshot, category_name_snapshot, quantity,
            unit_price_minor_snapshot, price_list_id, notes, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          itemId,
          input.orderId,
          input.productId,
          product.name,
          product.category_name,
          input.quantity ?? 1,
          unitPriceMinor,
          price.price_list_id,
          input.notes ?? null,
          nextSort,
          timestamp,
          timestamp,
        );
      if (
        String(order.lifecycle_status) === "CONFIRMED" &&
        this.getSettings().stockEnabled &&
        product.stock_minor != null
      ) {
        const required = (input.quantity ?? 1) * 1000;
        if (Number(product.stock_minor) < required)
          throw new Error(`Stock insuficiente para ${String(product.name)}.`);
        this.db
          .prepare(
            "UPDATE products SET stock_minor = stock_minor - ?, updated_at = ? WHERE id = ?",
          )
          .run(required, timestamp, input.productId);
      }
      this.recalculateOrder(input.orderId);
      if (priceWasOverridden) {
        this.audit({
          entityType: "ORDER",
          entityId: input.orderId,
          action: "ORDER_ITEM_PRICE_OVERRIDDEN",
          permission: "orders.override_price",
          reason: "Precio manual al cargar el producto en la mesa",
          before: {
            itemId,
            productId: input.productId,
            unitPriceMinor: catalogPriceMinor,
          },
          after: { itemId, unitPriceMinor },
          authorizerUserId: String(authorizer!.id),
        });
      }
      if (order.printed_at) {
        this.audit({
          entityType: "ORDER",
          entityId: input.orderId,
          action: "ORDER_EDITED_AFTER_PRINT",
          reason: "Producto agregado después de imprimir",
          after: { itemId, productId: input.productId },
        });
      }
      this.event("Order", input.orderId, "OrderUpdated", {
        itemId,
        action: "ITEM_ADDED",
        priceWasOverridden,
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  updateOrderItemNotes(input: {
    orderId: Id;
    itemId: Id;
    notes: string | null;
  }): OrderDto {
    const run = this.db.transaction(() => {
      this.editableOrder(input.orderId);
      const item = requireRow(
        this.db
          .prepare(
            "SELECT id, notes FROM order_items WHERE id = ? AND order_id = ?",
          )
          .get(input.itemId, input.orderId) as Row | undefined,
        "No se encontró el producto del pedido.",
      );
      const notes = input.notes?.trim() || null;
      if (notes && notes.length > 500)
        throw new Error("Las observaciones admiten hasta 500 caracteres.");
      const before = item.notes == null ? null : String(item.notes);
      this.db
        .prepare(
          "UPDATE order_items SET notes = ?, updated_at = ? WHERE id = ? AND order_id = ?",
        )
        .run(notes, nowIso(), input.itemId, input.orderId);
      this.db
        .prepare(
          "UPDATE orders SET version = version + 1, updated_at = ? WHERE id = ?",
        )
        .run(nowIso(), input.orderId);
      this.audit({
        entityType: "ORDER_ITEM",
        entityId: input.itemId,
        action: "ORDER_ITEM_NOTES_UPDATED",
        before: { orderId: input.orderId, notes: before },
        after: { orderId: input.orderId, notes },
      });
      this.event("Order", input.orderId, "OrderItemNotesUpdated", {
        itemId: input.itemId,
        notes,
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  addHalfAndHalfItem(input: AddHalfAndHalfItemInput): OrderDto {
    const run = this.db.transaction(() => {
      const order = this.editableOrder(input.orderId);
      const code = this.priceListCodeForOrder(
        String(order.type) as OrderDto["type"],
      );
      const productStatement = this.db.prepare(
        `SELECT p.id, p.name, c.name AS category_name, pp.amount_minor, pp.price_list_id FROM products p
         JOIN categories c ON c.id = p.category_id
         JOIN product_prices pp ON pp.product_id = p.id
         JOIN price_lists pl ON pl.id = pp.price_list_id
         WHERE p.id = ? AND p.active = 1 AND pl.code = ?`,
      );
      const first = requireRow(
        productStatement.get(input.firstProductId, code) as Row | undefined,
        "La primera variedad no tiene un precio válido.",
      );
      const second = requireRow(
        productStatement.get(input.secondProductId, code) as Row | undefined,
        "La segunda variedad no tiene un precio válido.",
      );
      const settings = this.getSettings();
      const basePrice = calculateHalfAndHalfBase(
        Number(first.amount_minor),
        Number(second.amount_minor),
        settings.halfAndHalfPricingMode,
      );
      const itemId = randomUUID();
      const timestamp = nowIso();
      const nextSort = Number(
        (
          this.db
            .prepare(
              "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM order_items WHERE order_id = ?",
            )
            .get(input.orderId) as Row
        ).next,
      );
      this.db
        .prepare(
          `INSERT INTO order_items(id, order_id, product_id, product_name_snapshot, category_name_snapshot, quantity,
            unit_price_minor_snapshot, price_list_id, notes, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          itemId,
          input.orderId,
          `Pizza mitad ${String(first.name)} / mitad ${String(second.name)}`,
          first.category_name,
          input.quantity ?? 1,
          basePrice,
          first.price_list_id,
          input.notes ?? null,
          nextSort,
          timestamp,
          timestamp,
        );
      const insertHalf = this.db.prepare(
        `INSERT INTO order_item_halves(id, order_item_id, product_id, position, product_name_snapshot, price_minor_snapshot)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insertHalf.run(
        randomUUID(),
        itemId,
        first.id,
        "FIRST",
        first.name,
        first.amount_minor,
      );
      insertHalf.run(
        randomUUID(),
        itemId,
        second.id,
        "SECOND",
        second.name,
        second.amount_minor,
      );
      if (
        String(order.lifecycle_status) === "CONFIRMED" &&
        this.getSettings().stockEnabled
      ) {
        const requiredPerHalf = (input.quantity ?? 1) * 500;
        for (const half of [first, second]) {
          const stock = (
            this.db
              .prepare("SELECT stock_minor FROM products WHERE id = ?")
              .get(half.id) as Row
          ).stock_minor;
          if (stock != null) {
            if (Number(stock) < requiredPerHalf)
              throw new Error(`Stock insuficiente para ${String(half.name)}.`);
            this.db
              .prepare(
                "UPDATE products SET stock_minor = stock_minor - ?, updated_at = ? WHERE id = ?",
              )
              .run(requiredPerHalf, timestamp, half.id);
          }
        }
      }
      this.recalculateOrder(input.orderId);
      this.audit({
        entityType: "ORDER",
        entityId: input.orderId,
        action: order.printed_at
          ? "ORDER_EDITED_AFTER_PRINT"
          : "HALF_AND_HALF_ADDED",
        after: { itemId, mode: settings.halfAndHalfPricingMode, basePrice },
      });
      this.event("Order", input.orderId, "OrderUpdated", {
        itemId,
        action: "HALF_AND_HALF_ADDED",
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  removeOrderItem(orderId: Id, itemId: Id): OrderDto {
    const run = this.db.transaction(() => {
      const order = this.editableOrder(orderId);
      const item = this.db
        .prepare("SELECT * FROM order_items WHERE id = ? AND order_id = ?")
        .get(itemId, orderId) as Row | undefined;
      if (String(order.lifecycle_status) === "CONFIRMED") {
        const count = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?",
              )
              .get(orderId) as Row
          ).count,
        );
        if (count <= 1)
          throw new Error(
            "Un pedido confirmado no puede quedar vacío. Cancelalo si ya no corresponde.",
          );
      }
      if (
        item &&
        String(order.lifecycle_status) === "CONFIRMED" &&
        this.getSettings().stockEnabled
      ) {
        if (item.product_id) {
          this.db
            .prepare(
              "UPDATE products SET stock_minor = stock_minor + ?, updated_at = ? WHERE id = ? AND stock_minor IS NOT NULL",
            )
            .run(Number(item.quantity) * 1000, nowIso(), item.product_id);
        } else {
          const halves = this.db
            .prepare(
              "SELECT product_id FROM order_item_halves WHERE order_item_id = ?",
            )
            .all(itemId) as Row[];
          for (const half of halves)
            this.db
              .prepare(
                "UPDATE products SET stock_minor = stock_minor + ?, updated_at = ? WHERE id = ? AND stock_minor IS NOT NULL",
              )
              .run(Number(item.quantity) * 500, nowIso(), half.product_id);
        }
      }
      const result = this.db
        .prepare("DELETE FROM order_items WHERE id = ? AND order_id = ?")
        .run(itemId, orderId);
      if (!result.changes) throw new Error("La línea del pedido no existe.");
      this.recalculateOrder(orderId);
      this.audit({
        entityType: "ORDER",
        entityId: orderId,
        action: order.printed_at
          ? "ORDER_EDITED_AFTER_PRINT"
          : "ORDER_ITEM_REMOVED",
        reason: order.printed_at
          ? "Producto eliminado después de imprimir"
          : undefined,
        before: { itemId },
      });
      this.event("Order", orderId, "OrderUpdated", {
        itemId,
        action: "ITEM_REMOVED",
      });
      return this.getOrder(orderId);
    });
    return run();
  }

  addOrderItemModifier(input: {
    orderId: Id;
    itemId: Id;
    modifierId: Id;
    scope: "FULL_PIZZA" | "FIRST_HALF" | "SECOND_HALF";
  }): OrderDto {
    const run = this.db.transaction(() => {
      const order = this.editableOrder(input.orderId);
      requireRow(
        this.db
          .prepare("SELECT id FROM order_items WHERE id = ? AND order_id = ?")
          .get(input.itemId, input.orderId),
        "La línea no existe.",
      );
      const modifier = requireRow(
        this.db
          .prepare(`SELECT * FROM modifiers WHERE id = ? AND active = 1`)
          .get(input.modifierId) as Row | undefined,
        "El modificador no existe.",
      );
      const charged = calculateModifierCharge(
        Number(modifier.price_minor),
        input.scope,
      );
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO order_item_modifiers(id, order_item_id, modifier_id, name_snapshot, unit_price_minor_snapshot, scope)
        VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.itemId,
          input.modifierId,
          modifier.name,
          charged,
          input.scope,
        );
      this.recalculateOrder(input.orderId);
      this.audit({
        entityType: "ORDER",
        entityId: input.orderId,
        action: order.printed_at
          ? "ORDER_EDITED_AFTER_PRINT"
          : "ORDER_MODIFIER_ADDED",
        after: { modifierId: id, scope: input.scope, charged },
      });
      this.event("Order", input.orderId, "OrderUpdated", {
        action: "MODIFIER_ADDED",
        modifierId: id,
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  removeOrderItemModifier(orderId: Id, modifierId: Id): OrderDto {
    const run = this.db.transaction(() => {
      this.editableOrder(orderId);
      const result = this.db
        .prepare(
          `DELETE FROM order_item_modifiers WHERE id = ? AND order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)`,
        )
        .run(modifierId, orderId);
      if (!result.changes) throw new Error("El modificador no existe.");
      this.recalculateOrder(orderId);
      this.audit({
        entityType: "ORDER",
        entityId: orderId,
        action: "ORDER_MODIFIER_REMOVED",
        before: { modifierId },
      });
      return this.getOrder(orderId);
    });
    return run();
  }

  applyOrderDiscount(input: {
    orderId: Id;
    mode: "PERCENTAGE" | "FIXED";
    value: number;
    reason: string;
    authorizerPin: string;
  }): OrderDto {
    const run = this.db.transaction(() => {
      const order = this.editableOrder(input.orderId);
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "orders.discount",
      );
      const base =
        Number(order.subtotal_minor) + Number(order.delivery_fee_minor);
      const valueMinor =
        input.mode === "FIXED" ? Math.round(input.value) : input.value;
      const discount = calculateDiscountMinor(base, input.mode, valueMinor);
      this.db
        .prepare(
          `UPDATE orders SET discount_minor = ?, total_minor = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(discount, base - discount, nowIso(), input.orderId);
      this.audit({
        entityType: "ORDER",
        entityId: input.orderId,
        action: "ORDER_DISCOUNT_APPLIED",
        permission: "orders.discount",
        reason: input.reason,
        before: { discountMinor: order.discount_minor },
        after: {
          discountMinor: discount,
          mode: input.mode,
          value: input.value,
        },
        authorizerUserId: String(authorizer.id),
      });
      this.event("Order", input.orderId, "OrderUpdated", {
        action: "DISCOUNT_APPLIED",
        discountMinor: discount,
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  updateOrderStatus(orderId: Id, status: OrderOperationalStatus): OrderDto {
    const run = this.db.transaction(() => {
      const order = this.getOrder(orderId);
      assertOperationalTransition(order, status);
      if (
        order.type === "DELIVERY" &&
        ["OUT_FOR_DELIVERY", "DELIVERED"].includes(status)
      )
        this.requireActiveDriver(order.driverUserId ?? "");
      assertOrderTransition(order.operationalStatus, status);
      this.db
        .prepare(
          "UPDATE orders SET operational_status = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .run(status, nowIso(), orderId);
      if (status === "DELIVERED")
        this.ensureDeliveryLedger(this.getOrder(orderId));
      this.audit({
        entityType: "ORDER",
        entityId: orderId,
        action: "ORDER_STATUS_CHANGED",
        before: { status: order.operationalStatus },
        after: { status },
      });
      this.event("Order", orderId, "OrderUpdated", {
        operationalStatus: status,
      });
      return this.getOrder(orderId);
    });
    return run();
  }

  assignDeliveryDriver(input: {
    orderId: Id;
    driverUserId: Id | null;
  }): OrderDto {
    const run = this.db.transaction(() => {
      const before = this.getOrder(input.orderId);
      if (before.type !== "DELIVERY")
        throw new Error("Sólo los envíos admiten repartidor.");
      if (["DELIVERED", "CANCELLED"].includes(before.operationalStatus))
        throw new Error(
          "No se puede cambiar el repartidor de un pedido finalizado.",
        );
      if (
        !input.driverUserId &&
        before.operationalStatus === "OUT_FOR_DELIVERY"
      )
        throw new Error(
          "Un pedido en reparto debe conservar un repartidor asignado.",
        );
      if (input.driverUserId) {
        this.requireActiveDriver(input.driverUserId);
      }
      if (before.driverUserId === input.driverUserId) return before;
      this.db
        .prepare(
          "UPDATE orders SET driver_user_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .run(input.driverUserId, nowIso(), input.orderId);
      this.audit({
        entityType: "ORDER",
        entityId: input.orderId,
        action: input.driverUserId
          ? "DELIVERY_DRIVER_ASSIGNED"
          : "DELIVERY_DRIVER_UNASSIGNED",
        before: { driverUserId: before.driverUserId },
        after: { driverUserId: input.driverUserId },
      });
      this.event("Order", input.orderId, "OrderUpdated", {
        driverUserId: input.driverUserId,
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  payOrder(input: PayOrderInput): OrderDto {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "payOrder",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          const session = this.requireOpenCashSessionRow();
          const order = requireRow(
            this.db
              .prepare("SELECT * FROM orders WHERE id = ?")
              .get(input.orderId) as Row | undefined,
            "El pedido no existe.",
          );
          assertOrderAction(this.getOrder(input.orderId), "PAY");
          if (!input.payments.length)
            throw new Error("Agregá al menos un medio de pago.");
          for (const payment of input.payments) {
            nonNegativeMoney(payment.amountMinor, "pago");
            if (payment.amountMinor === 0)
              throw new Error(
                "Cada pago debe tener un importe mayor que cero.",
              );
            if (payment.receivedMinor != null)
              nonNegativeMoney(payment.receivedMinor, "efectivo recibido");
          }
          const allocation = input.payments.reduce(
            (total, payment) => total + payment.amountMinor,
            0,
          );
          assertPaymentAllocation(
            Number(order.total_minor),
            Number(order.paid_minor),
            allocation,
          );
          const methodStatement = this.db.prepare(
            "SELECT * FROM payment_methods WHERE code = ? AND active = 1",
          );
          const insertPayment = this.db.prepare(
            `INSERT INTO payments(id, order_id, cash_session_id, payment_method_id, amount_minor,
          received_minor, reference, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          const insertMovement = this.db.prepare(
            `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash,
          payment_method_id, order_id, user_id, reason, created_at)
         VALUES (?, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const payment of input.payments) {
            if (
              payment.methodCode === "CASH" &&
              payment.receivedMinor != null &&
              payment.receivedMinor < payment.amountMinor
            ) {
              throw new Error(
                "El efectivo recibido no alcanza para el importe en efectivo.",
              );
            }
            if (payment.methodCode !== "CASH" && payment.receivedMinor != null)
              throw new Error("Sólo el efectivo admite importe recibido.");
            const method = requireRow(
              methodStatement.get(payment.methodCode) as Row | undefined,
              `El medio de pago ${payment.methodCode} no está disponible.`,
            );
            const paymentId = randomUUID();
            const timestamp = nowIso();
            insertPayment.run(
              paymentId,
              input.orderId,
              session.id,
              method.id,
              payment.amountMinor,
              payment.receivedMinor ?? null,
              payment.reference ?? null,
              this.adminUserId,
              timestamp,
            );
            insertMovement.run(
              randomUUID(),
              session.id,
              payment.amountMinor,
              input.collectedByDriver ? 0 : method.affects_cash,
              method.id,
              input.orderId,
              this.adminUserId,
              `Cobro pedido #${String(order.number)}`,
              timestamp,
            );
          }
          const paidMinor = Number(order.paid_minor) + allocation;
          const paymentStatus = paymentStatusFor(
            Number(order.total_minor),
            paidMinor,
          );
          this.db
            .prepare(
              `UPDATE orders SET paid_minor = ?, payment_status = ?, cash_session_paid_id = ?, collected_by_driver = ?,
           version = version + 1, updated_at = ? WHERE id = ?`,
            )
            .run(
              paidMinor,
              paymentStatus,
              session.id,
              input.collectedByDriver ? 1 : 0,
              nowIso(),
              input.orderId,
            );
          if (
            paymentStatus === "PAID" &&
            String(order.type) === "DELIVERY" &&
            String(order.operational_status) === "DELIVERED" &&
            order.driver_user_id &&
            this.getSettings().deliverySettlementEnabled
          ) {
            const driverCollected = input.collectedByDriver === true;
            const restaurantAmount = Math.max(
              0,
              Number(order.total_minor) - Number(order.delivery_fee_minor),
            );
            const direction = driverCollected
              ? "DRIVER_OWES_BUSINESS"
              : "BUSINESS_OWES_DRIVER";
            const amountDue = driverCollected
              ? restaurantAmount
              : Number(order.delivery_fee_minor);
            this.db
              .prepare(
                `INSERT OR IGNORE INTO delivery_ledger(
          id, order_id, driver_user_id, restaurant_amount_minor, delivery_fee_minor,
          direction, amount_due_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                randomUUID(),
                input.orderId,
                order.driver_user_id,
                restaurantAmount,
                order.delivery_fee_minor,
                direction,
                amountDue,
                nowIso(),
              );
          }
          this.audit({
            entityType: "ORDER",
            entityId: input.orderId,
            action: "ORDER_PAID",
            after: {
              paidMinor,
              paymentStatus,
              payments: input.payments.map((payment) => payment.methodCode),
            },
          });
          this.event("Order", input.orderId, "OrderPaid", {
            paidMinor,
            paymentStatus,
          });
          return this.getOrder(input.orderId);
        });
        return run();
      },
    );
  }

  refundPayment(input: RefundPaymentInput): OrderDto {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "refundPayment",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          const session = this.requireOpenCashSessionRow();
          const order = requireRow(
            this.db
              .prepare("SELECT * FROM orders WHERE id = ?")
              .get(input.orderId) as Row | undefined,
            "El pedido no existe.",
          );
          if (String(order.operational_status) === "CANCELLED")
            throw new Error(
              "No se puede devolver un pago de un pedido cancelado.",
            );
          const deliveryLedger = this.db
            .prepare("SELECT id FROM delivery_ledger WHERE order_id = ?")
            .get(input.orderId) as Row | undefined;
          if (deliveryLedger) {
            throw new Error(
              "No se puede devolver este pago porque el envío ya generó una rendición; su anulación todavía no está disponible.",
            );
          }
          const payment = requireRow(
            this.db
              .prepare(
                `SELECT p.*, pm.code AS method_code, pm.affects_cash,
              COALESCE((SELECT SUM(pr.amount_minor) FROM payment_refunds pr WHERE pr.payment_id = p.id), 0) AS refunded_minor
             FROM payments p JOIN payment_methods pm ON pm.id = p.payment_method_id
             WHERE p.id = ? AND p.order_id = ?`,
              )
              .get(input.paymentId, input.orderId) as Row | undefined,
            "El pago no existe o no pertenece al pedido.",
          );
          const amountMinor =
            Number(payment.amount_minor) - Number(payment.refunded_minor);
          if (amountMinor <= 0) throw new Error("El pago ya fue devuelto.");
          if (
            flag(payment.affects_cash) &&
            !flag(order.collected_by_driver) &&
            amountMinor > this.cashSessionDto(session).expectedAmountMinor
          )
            throw new Error(
              "La caja no tiene efectivo suficiente para esta devolución. Registrá un ingreso de fondos antes de continuar.",
            );
          const authorizer = this.authorizePin(
            input.authorizerPin,
            "payments.refund",
          );
          const timestamp = nowIso();
          const refundId = randomUUID();
          this.db
            .prepare(
              `INSERT INTO payment_refunds(id, payment_id, order_id, cash_session_id, amount_minor,
            reason, created_by_user_id, authorized_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              refundId,
              input.paymentId,
              input.orderId,
              session.id,
              amountMinor,
              input.reason,
              this.adminUserId,
              authorizer.id,
              timestamp,
            );
          this.db
            .prepare(
              `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash,
            payment_method_id, order_id, user_id, reason, created_at)
           VALUES (?, ?, 'REFUND', ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              session.id,
              amountMinor,
              flag(order.collected_by_driver) ? 0 : payment.affects_cash,
              payment.payment_method_id,
              input.orderId,
              this.adminUserId,
              `Devolución pedido #${String(order.number)}: ${input.reason}`,
              timestamp,
            );
          const paidMinor = Math.max(0, Number(order.paid_minor) - amountMinor);
          const paymentStatus = paymentStatusFor(
            Number(order.total_minor),
            paidMinor,
          );
          this.db
            .prepare(
              `UPDATE orders SET paid_minor = ?, payment_status = ?, version = version + 1,
           updated_at = ? WHERE id = ?`,
            )
            .run(paidMinor, paymentStatus, timestamp, input.orderId);
          this.audit({
            entityType: "PAYMENT",
            entityId: input.paymentId,
            action: "PAYMENT_REFUNDED",
            permission: "payments.refund",
            reason: input.reason,
            before: {
              amountMinor: Number(payment.amount_minor),
              refundedMinor: Number(payment.refunded_minor),
              orderPaidMinor: Number(order.paid_minor),
            },
            after: {
              refundId,
              refundedMinor: Number(payment.refunded_minor) + amountMinor,
              orderPaidMinor: paidMinor,
              paymentStatus,
            },
            authorizerUserId: String(authorizer.id),
          });
          this.event("Payment", input.paymentId, "PaymentRefunded", {
            refundId,
            orderId: input.orderId,
            amountMinor,
          });
          return this.getOrder(input.orderId);
        });
        return run();
      },
    );
  }

  completeOrder(input: PayOrderInput & { finalStatus: "DELIVERED" }): OrderDto {
    const run = this.db.transaction(() => {
      let order = this.getOrder(input.orderId);
      let paymentInput = input;
      if (order.type === "DELIVERY" && order.paymentStatus !== "PAID") {
        const cashMinor = input.payments
          .filter((payment) => payment.methodCode === "CASH")
          .reduce((sum, payment) => sum + payment.amountMinor, 0);
        const nonCashMinor = input.payments
          .filter((payment) => payment.methodCode !== "CASH")
          .reduce((sum, payment) => sum + payment.amountMinor, 0);
        if (cashMinor > 0 && nonCashMinor > 0) {
          throw new Error(
            "Para cobrar y entregar un envío, elegí efectivo contra entrega o un medio anticipado, sin combinarlos.",
          );
        }
        paymentInput = { ...input, collectedByDriver: cashMinor > 0 };
      }
      if (order.lifecycleStatus === "DRAFT")
        order = this.confirmOrder({ orderId: input.orderId });
      if (order.paymentStatus !== "PAID") order = this.payOrder(paymentInput);
      assertOrderAction(order, "DELIVER");
      return this.updateOrderStatus(input.orderId, input.finalStatus);
    });
    return run();
  }

  cancelOrder(input: CancelOrderInput): OrderDto {
    const run = this.db.transaction(() => {
      const order = requireRow(
        this.db
          .prepare("SELECT * FROM orders WHERE id = ?")
          .get(input.orderId) as Row | undefined,
        "El pedido no existe.",
      );
      assertOrderAction(this.getOrder(input.orderId), "CANCEL");
      if (Number(order.paid_minor) > 0) {
        throw new Error(
          "El pedido tiene pagos; registrá una devolución antes de cancelarlo.",
        );
      }
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "orders.cancel",
      );
      if (this.getSettings().stockEnabled) {
        const items = this.db
          .prepare("SELECT * FROM order_items WHERE order_id = ?")
          .all(input.orderId) as Row[];
        for (const item of items) {
          if (item.product_id) {
            this.db
              .prepare(
                "UPDATE products SET stock_minor = stock_minor + ?, updated_at = ? WHERE id = ? AND stock_minor IS NOT NULL",
              )
              .run(Number(item.quantity) * 1000, nowIso(), item.product_id);
          } else {
            const halves = this.db
              .prepare(
                "SELECT product_id FROM order_item_halves WHERE order_item_id = ?",
              )
              .all(item.id) as Row[];
            for (const half of halves)
              this.db
                .prepare(
                  "UPDATE products SET stock_minor = stock_minor + ?, updated_at = ? WHERE id = ? AND stock_minor IS NOT NULL",
                )
                .run(Number(item.quantity) * 500, nowIso(), half.product_id);
          }
        }
      }
      this.db
        .prepare(
          `UPDATE orders SET operational_status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?,
           version = version + 1, updated_at = ? WHERE id = ?`,
        )
        .run(nowIso(), input.reason, nowIso(), input.orderId);
      this.audit({
        entityType: "ORDER",
        entityId: input.orderId,
        action: "ORDER_CANCELLED",
        permission: "orders.cancel",
        reason: input.reason,
        before: { status: order.operational_status },
        after: { status: "CANCELLED" },
        authorizerUserId: String(authorizer.id),
      });
      this.event("Order", input.orderId, "OrderCancelled", {
        reason: input.reason,
      });
      return this.getOrder(input.orderId);
    });
    return run();
  }

  queuePrint(orderId: Id, kind: "KITCHEN_ORDER" | "CUSTOMER_BILL") {
    const run = this.db.transaction(() => {
      const order = this.getOrder(orderId);
      assertOrderAction(
        order,
        kind === "KITCHEN_ORDER" ? "PRINT_KITCHEN" : "PRINT_BILL",
      );
      const activeJob = this.db
        .prepare(
          `SELECT id FROM print_jobs
           WHERE order_id = ? AND kind = ? AND status IN ('QUEUED','RECOVERING')
           LIMIT 1`,
        )
        .get(orderId, kind) as Row | undefined;
      if (activeJob)
        throw new Error(
          "Ya hay una impresión de este tipo en curso. Esperá el resultado o reanudá el trabajo pendiente.",
        );
      const jobId = randomUUID();
      const settings = this.getSettings();
      const profile =
        kind === "KITCHEN_ORDER"
          ? settings.printing.kitchen
          : settings.printing.bill;
      this.db
        .prepare(
          `INSERT INTO print_jobs(id, order_id, kind, status, printer_name, copies, created_at)
           VALUES (?, ?, ?, 'QUEUED', ?, ?, ?)`,
        )
        .run(
          jobId,
          orderId,
          kind,
          profile.deviceName || null,
          profile.copies,
          nowIso(),
        );
      this.audit({
        entityType: "ORDER",
        entityId: orderId,
        action:
          order.printCount > 0 ? "ORDER_REPRINT_QUEUED" : "ORDER_PRINT_QUEUED",
        permission: order.printCount > 0 ? "orders.reprint" : undefined,
        after: {
          jobId,
          kind,
          successfulPrintsBefore: order.printCount,
          attemptNumber: (order.printAttemptCount ?? 0) + 1,
          printerName: profile.deviceName || null,
          copies: profile.copies,
        },
      });
      return { jobId, status: "QUEUED" };
    });
    return run();
  }

  markPrintJob(jobId: Id, status: "PRINTED" | "FAILED", error?: string) {
    const run = this.db.transaction(() => {
      const job = requireRow(
        this.db.prepare("SELECT * FROM print_jobs WHERE id = ?").get(jobId) as
          Row | undefined,
        "El trabajo de impresión no existe.",
      );
      if (!["QUEUED", "RECOVERING"].includes(String(job.status)))
        throw new Error("El intento de impresión ya fue resuelto.");
      const timestamp = nowIso();
      this.db
        .prepare(
          `UPDATE print_jobs SET status = ?, attempts = attempts + 1, last_error = ?,
           printed_at = CASE WHEN ? = 'PRINTED' THEN ? ELSE NULL END WHERE id = ?`,
        )
        .run(status, error ?? null, status, timestamp, jobId);
      this.db
        .prepare(
          `UPDATE orders
           SET print_attempt_count = print_attempt_count + 1,
               print_count = print_count + CASE WHEN ? = 'PRINTED' THEN 1 ELSE 0 END,
               printed_at = CASE
                 WHEN ? = 'PRINTED' THEN COALESCE(printed_at, ?)
                 ELSE printed_at
               END
           WHERE id = ?`,
        )
        .run(status, status, timestamp, job.order_id);
      this.audit({
        entityType: "PRINT_JOB",
        entityId: jobId,
        action: status === "PRINTED" ? "PRINT_SUCCEEDED" : "PRINT_FAILED",
        after: {
          orderId: job.order_id,
          kind: job.kind,
          attempt: Number(job.attempts) + 1,
          error: error ?? null,
        },
      });
      this.event("PrintJob", jobId, "PrintAttemptResolved", {
        orderId: job.order_id,
        status,
        attempt: Number(job.attempts) + 1,
      });
    });
    run();
  }

  discardPrintJob(jobId: Id) {
    const result = this.db
      .prepare(
        `DELETE FROM print_jobs
         WHERE id = ? AND status IN ('QUEUED','RECOVERING')`,
      )
      .run(jobId);
    if (result.changes !== 1)
      throw new Error("El intento de impresión ya fue resuelto.");
  }

  preparePrintRetry(jobId: Id) {
    const run = this.db.transaction(() => {
      const job = requireRow(
        this.db.prepare("SELECT * FROM print_jobs WHERE id = ?").get(jobId) as
          Row | undefined,
        "El trabajo de impresión no existe.",
      );
      if (!["FAILED", "QUEUED"].includes(String(job.status)))
        throw new Error(
          "Sólo se puede reintentar una impresión fallida o pendiente.",
        );
      const claimed = this.db
        .prepare(
          `UPDATE print_jobs SET status = 'RECOVERING', last_error = NULL
           WHERE id = ? AND status IN ('FAILED','QUEUED')`,
        )
        .run(jobId);
      if (claimed.changes !== 1)
        throw new Error(
          "Otro proceso ya está reanudando esta impresión. Esperá su resultado.",
        );
      this.audit({
        entityType: "PRINT_JOB",
        entityId: jobId,
        action:
          String(job.status) === "QUEUED"
            ? "PRINT_QUEUED_RECOVERED"
            : "PRINT_RETRY_QUEUED",
        permission: "orders.reprint",
        after: {
          orderId: job.order_id,
          kind: job.kind,
          attempt: Number(job.attempts) + 1,
        },
      });
      return {
        jobId,
        orderId: String(job.order_id),
        kind: String(job.kind) as PrintJobDto["kind"],
        status: "RECOVERING",
      };
    });
    return run();
  }

  private customerDtos(rows: Row[]): CustomerDto[] {
    if (!rows.length) return [];
    const ids = rows.map((row) => String(row.id));
    const addresses = this.db
      .prepare(
        `SELECT * FROM customer_addresses
         WHERE customer_id IN (${ids.map(() => "?").join(",")})
         ORDER BY is_default DESC, created_at`,
      )
      .all(...ids) as Row[];
    const addressesByCustomer = new Map<string, Row[]>();
    for (const address of addresses) {
      const customerId = String(address.customer_id);
      const current = addressesByCustomer.get(customerId) ?? [];
      current.push(address);
      addressesByCustomer.set(customerId, current);
    }
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      phone: String(row.phone),
      notes: row.notes == null ? null : String(row.notes),
      preferences: row.preferences == null ? null : String(row.preferences),
      tags: jsonStringArray(row.tags_json),
      preferredPaymentMethodCode:
        row.preferred_payment_method_code == null
          ? null
          : String(row.preferred_payment_method_code),
      active: row.active == null ? true : flag(row.active),
      mergedIntoCustomerId:
        row.merged_into_customer_id == null
          ? null
          : String(row.merged_into_customer_id),
      updatedAt: String(row.updated_at),
      addresses: (addressesByCustomer.get(String(row.id)) ?? []).map(
        (address) => ({
          id: String(address.id),
          label: String(address.label),
          address: String(address.address),
          notes: address.notes == null ? null : String(address.notes),
          deliveryFeeMinor: Number(address.delivery_fee_minor),
        }),
      ),
    }));
  }

  private customerDto(row: Row): CustomerDto {
    return this.customerDtos([row])[0]!;
  }

  private validateCustomerInput(input: {
    name: string;
    phone: string;
    notes?: string | null;
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
    expectedUpdatedAt?: string;
    addresses?: Array<{
      label: string;
      address: string;
      notes?: string | null;
      deliveryFeeMinor?: number;
    }>;
  }) {
    const name = input.name.trim();
    const phone = input.phone.trim();
    if (name.length < 2 || name.length > 120)
      throw new Error("El nombre debe tener entre 2 y 120 caracteres.");
    if (phone.length > 40 || normalizePhone(phone).length < 6)
      throw new Error("Ingresá un teléfono válido de hasta 40 caracteres.");
    if ((input.notes?.trim().length ?? 0) > 1_000)
      throw new Error("Las notas del cliente admiten hasta 1000 caracteres.");
    if ((input.preferences?.trim().length ?? 0) > 1_000)
      throw new Error("Las preferencias admiten hasta 1000 caracteres.");
    const tags = [
      ...new Set((input.tags ?? []).map((tag) => tag.trim())),
    ].filter(Boolean);
    if (tags.length > 12 || tags.some((tag) => tag.length > 30))
      throw new Error("Usá hasta 12 etiquetas de 30 caracteres como máximo.");
    if (input.preferredPaymentMethodCode) {
      const method = this.db
        .prepare("SELECT 1 FROM payment_methods WHERE code = ? AND active = 1")
        .get(input.preferredPaymentMethodCode);
      if (!method)
        throw new Error("El medio de pago preferido no está activo.");
    }
    if ((input.addresses?.length ?? 0) > 20)
      throw new Error("Un cliente puede tener hasta 20 direcciones.");
    for (const address of input.addresses ?? []) {
      if (
        address.label.trim().length > 60 ||
        address.address.trim().length > 240 ||
        (address.notes?.trim().length ?? 0) > 500
      )
        throw new Error(
          "Revisá las direcciones: etiqueta 60, dirección 240 y referencia 500 caracteres como máximo.",
        );
      if (
        !Number.isSafeInteger(address.deliveryFeeMinor ?? 0) ||
        (address.deliveryFeeMinor ?? 0) < 0
      )
        throw new Error("El valor de envío de una dirección no es válido.");
    }
  }

  searchCustomers(query: string): CustomerDto[] {
    return this.searchCustomersPage({
      query,
      page: 1,
      pageSize: query.trim() ? 50 : 200,
    }).items;
  }

  searchCustomersPage(
    input: SearchCustomersPageInput,
  ): import("@gastronomy/contracts").CustomerSearchPageDto {
    const query = input.query.trim();
    const requestedPage = Number.isFinite(input.page)
      ? Math.max(1, Math.trunc(input.page))
      : 1;
    const pageSize = Number.isFinite(input.pageSize)
      ? Math.min(200, Math.max(1, Math.trunc(input.pageSize)))
      : 24;
    const normalizedQuery = query.trim().toLocaleLowerCase("es-AR");
    const term = `%${normalizedQuery}%`;
    const normalizedDigits = normalizePhone(query);
    const hasPhoneQuery =
      normalizedDigits.length > 0 && !/[a-záéíóúñü]/i.test(query);
    const digits = `%${normalizedDigits}%`;
    const clauses: string[] = [];
    const filterArguments: unknown[] = [];
    const status = input.status ?? "ACTIVE";
    if (status === "ACTIVE") clauses.push("c.active = 1");
    if (status === "ARCHIVED") clauses.push("c.active = 0");
    if (normalizedQuery) {
      clauses.push(`(lower(c.name) LIKE ?
           OR (? = 1 AND c.phone_normalized LIKE ?)
           OR EXISTS (
             SELECT 1 FROM customer_addresses ca
             WHERE ca.customer_id = c.id
               AND (lower(ca.address) LIKE ? OR lower(COALESCE(ca.notes, '')) LIKE ?)
           ))`);
      filterArguments.push(term, hasPhoneQuery ? 1 : 0, digits, term, term);
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM customers c ${whereSql}`)
      .get(...filterArguments) as Row;
    const total = Number(countRow.total ?? 0);
    const pageCount = total ? Math.ceil(total / pageSize) : 0;
    const page = pageCount ? Math.min(requestedPage, pageCount) : 1;
    const orderSql = normalizedQuery
      ? `ORDER BY CASE WHEN ? = 1 AND c.phone_normalized LIKE ? THEN 0 ELSE 1 END,
           c.name COLLATE NOCASE, c.id`
      : "ORDER BY c.name COLLATE NOCASE, c.id";
    const orderArguments = normalizedQuery
      ? [hasPhoneQuery ? 1 : 0, digits]
      : [];
    const rows = this.db
      .prepare(
        `SELECT c.* FROM customers c
         ${whereSql}
         ${orderSql}
         LIMIT ? OFFSET ?`,
      )
      .all(
        ...filterArguments,
        ...orderArguments,
        pageSize,
        (page - 1) * pageSize,
      ) as Row[];
    return {
      items: this.customerDtos(rows),
      total,
      page,
      pageSize,
      pageCount,
    };
  }

  createCustomer(input: {
    name: string;
    phone: string;
    notes?: string | null;
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
    address?: string | null;
    addresses?: Array<{
      id?: string;
      label: string;
      address: string;
      notes?: string | null;
      deliveryFeeMinor?: number;
    }>;
  }): CustomerDto {
    const run = this.db.transaction(() => {
      this.validateCustomerInput(input);
      const duplicate = this.db
        .prepare(
          `SELECT name FROM customers
           WHERE phone_normalized = ? AND lower(trim(name)) = lower(trim(?))
           LIMIT 1`,
        )
        .get(normalizePhone(input.phone), input.name) as Row | undefined;
      if (duplicate)
        throw new Error(
          `Ya existe una ficha de ${String(duplicate.name)} con ese teléfono. Abrila en lugar de crear un duplicado exacto.`,
        );
      const id = randomUUID();
      const timestamp = nowIso();
      this.db
        .prepare(
          `INSERT INTO customers(id, name, phone, phone_normalized, notes, preferences,
             tags_json, preferred_payment_method_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name.trim(),
          input.phone.trim(),
          normalizePhone(input.phone),
          input.notes?.trim() || null,
          input.preferences?.trim() || null,
          json(
            [...new Set((input.tags ?? []).map((tag) => tag.trim()))].filter(
              Boolean,
            ),
          ),
          input.preferredPaymentMethodCode ?? null,
          timestamp,
          timestamp,
        );
      const addresses = input.addresses?.length
        ? input.addresses
        : input.address?.trim()
          ? [{ label: "Principal", address: input.address }]
          : [];
      const insertAddress = this.db.prepare(
        `INSERT INTO customer_addresses(id, customer_id, label, address, notes, delivery_fee_minor, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      addresses.forEach((address, index) => {
        if (!address.address.trim()) return;
        if (!address.label.trim())
          throw new Error("Cada dirección debe tener una etiqueta.");
        insertAddress.run(
          randomUUID(),
          id,
          address.label.trim(),
          address.address.trim(),
          address.notes?.trim() || null,
          address.deliveryFeeMinor ?? 0,
          index === 0 ? 1 : 0,
          timestamp,
          timestamp,
        );
      });
      this.audit({
        entityType: "CUSTOMER",
        entityId: id,
        action: "CUSTOMER_CREATED",
      });
      return this.customerDto(
        this.db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Row,
      );
    });
    return run();
  }

  updateCustomer(input: {
    customerId: string;
    name: string;
    phone: string;
    notes?: string | null;
    preferences?: string | null;
    tags?: string[];
    preferredPaymentMethodCode?: string | null;
    expectedUpdatedAt: string;
    addresses: Array<{
      id?: string;
      label: string;
      address: string;
      notes?: string | null;
      deliveryFeeMinor?: number;
    }>;
  }): CustomerDto {
    const run = this.db.transaction(() => {
      this.validateCustomerInput(input);
      const row = requireRow(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(input.customerId) as Row | undefined,
        "El cliente no existe.",
      );
      if (input.expectedUpdatedAt !== String(row.updated_at))
        throw new Error(
          "El cliente fue modificado en otra ventana. Recargá la ficha antes de guardar para no pisar cambios.",
        );
      const before = this.customerDto(row);
      const duplicate = this.db
        .prepare(
          `SELECT name FROM customers
           WHERE phone_normalized = ? AND lower(trim(name)) = lower(trim(?))
             AND id <> ? LIMIT 1`,
        )
        .get(normalizePhone(input.phone), input.name, input.customerId) as
        Row | undefined;
      if (duplicate)
        throw new Error(
          `Ya existe otra ficha de ${String(duplicate.name)} con ese teléfono. Revisá o fusioná el duplicado exacto antes de guardar.`,
        );
      const timestamp = new Date(
        Math.max(Date.now(), Date.parse(String(row.updated_at)) + 1),
      ).toISOString();
      this.db
        .prepare(
          `UPDATE customers SET name = ?, phone = ?, phone_normalized = ?, notes = ?,
             preferences = ?, tags_json = ?, preferred_payment_method_code = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name.trim(),
          input.phone.trim(),
          normalizePhone(input.phone),
          input.notes?.trim() || null,
          input.preferences?.trim() || null,
          json(
            [...new Set((input.tags ?? []).map((tag) => tag.trim()))].filter(
              Boolean,
            ),
          ),
          input.preferredPaymentMethodCode ?? null,
          timestamp,
          input.customerId,
        );
      const existingAddresses = this.db
        .prepare("SELECT id FROM customer_addresses WHERE customer_id = ?")
        .all(input.customerId) as Row[];
      const existingAddressIds = new Set(
        existingAddresses.map((address) => String(address.id)),
      );
      const retainedAddressIds = new Set<string>();
      const insertAddress = this.db.prepare(
        `INSERT INTO customer_addresses(id, customer_id, label, address, notes, delivery_fee_minor, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const updateAddress = this.db.prepare(
        `UPDATE customer_addresses
         SET label = ?, address = ?, notes = ?, delivery_fee_minor = ?, is_default = ?, updated_at = ?
         WHERE id = ? AND customer_id = ?`,
      );
      input.addresses.forEach((address, index) => {
        if (!address.address.trim()) return;
        if (!address.label.trim())
          throw new Error("Cada dirección debe tener una etiqueta.");
        if (address.id && !existingAddressIds.has(address.id))
          throw new Error(
            "Una dirección cambió desde que abriste la ficha. Recargá el cliente antes de guardar.",
          );
        const addressId = address.id ?? randomUUID();
        retainedAddressIds.add(addressId);
        if (address.id) {
          updateAddress.run(
            address.label.trim(),
            address.address.trim(),
            address.notes?.trim() || null,
            address.deliveryFeeMinor ?? 0,
            index === 0 ? 1 : 0,
            timestamp,
            addressId,
            input.customerId,
          );
          return;
        }
        insertAddress.run(
          addressId,
          input.customerId,
          address.label.trim(),
          address.address.trim(),
          address.notes?.trim() || null,
          address.deliveryFeeMinor ?? 0,
          index === 0 ? 1 : 0,
          timestamp,
          timestamp,
        );
      });
      const deleteAddress = this.db.prepare(
        "DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?",
      );
      for (const addressId of existingAddressIds)
        if (!retainedAddressIds.has(addressId))
          deleteAddress.run(addressId, input.customerId);
      const after = this.customerDto(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(input.customerId) as Row,
      );
      this.audit({
        entityType: "CUSTOMER",
        entityId: input.customerId,
        action: "CUSTOMER_UPDATED",
        before,
        after,
      });
      return after;
    });
    return run();
  }

  getCustomerProfile(input: {
    customerId: string;
    page: number;
    pageSize: number;
  }): CustomerProfileDto {
    const customerRow = requireRow(
      this.db
        .prepare("SELECT * FROM customers WHERE id = ?")
        .get(input.customerId) as Row | undefined,
      "El cliente no existe.",
    );
    const metricRows = this.db
      .prepare(
        `SELECT created_at, total_minor, paid_minor
         FROM orders
         WHERE customer_id = ? AND lifecycle_status = 'CONFIRMED'
           AND operational_status <> 'CANCELLED'
         ORDER BY created_at`,
      )
      .all(input.customerId) as Row[];
    const orderCount = metricRows.length;
    const totalSpentMinor = metricRows.reduce(
      (total, row) => total + Number(row.total_minor),
      0,
    );
    const outstandingMinor = metricRows.reduce(
      (total, row) =>
        total + Math.max(0, Number(row.total_minor) - Number(row.paid_minor)),
      0,
    );
    const gaps = metricRows
      .slice(1)
      .map((row, index) =>
        Math.max(
          0,
          Date.parse(String(row.created_at)) -
            Date.parse(String(metricRows[index]!.created_at)),
        ),
      );
    const frequencyDays = gaps.length
      ? Math.round(
          (gaps.reduce((total, gap) => total + gap, 0) /
            gaps.length /
            86_400_000) *
            10,
        ) / 10
      : null;
    const payment = this.db
      .prepare(
        `SELECT pm.code, pm.name, COUNT(*) AS uses,
           SUM(p.amount_minor - COALESCE((
             SELECT SUM(pr.amount_minor) FROM payment_refunds pr WHERE pr.payment_id = p.id
           ), 0)) AS net_minor
         FROM payments p
         JOIN payment_methods pm ON pm.id = p.payment_method_id
         JOIN orders o ON o.id = p.order_id
         WHERE o.customer_id = ?
         GROUP BY pm.id, pm.code, pm.name
         ORDER BY uses DESC, net_minor DESC, pm.name COLLATE NOCASE
         LIMIT 1`,
      )
      .get(input.customerId) as Row | undefined;
    const products = this.db
      .prepare(
        `SELECT oi.product_id, oi.product_name_snapshot AS name,
           SUM(oi.quantity) AS quantity,
           SUM(oi.unit_price_minor_snapshot * oi.quantity - oi.discount_minor_snapshot) AS total_minor
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.customer_id = ? AND o.lifecycle_status = 'CONFIRMED'
           AND o.operational_status <> 'CANCELLED'
         GROUP BY oi.product_id, oi.product_name_snapshot
         ORDER BY quantity DESC, total_minor DESC, name COLLATE NOCASE
         LIMIT 8`,
      )
      .all(input.customerId) as Row[];
    const addresses = this.db
      .prepare(
        `SELECT o.delivery_address_snapshot AS address,
           (SELECT ca.id FROM customer_addresses ca
            WHERE ca.customer_id = o.customer_id
              AND lower(trim(ca.address)) = lower(trim(o.delivery_address_snapshot))
            LIMIT 1) AS address_id,
           COUNT(*) AS order_count, MAX(o.created_at) AS last_used_at
         FROM orders o
         WHERE o.customer_id = ? AND o.delivery_address_snapshot IS NOT NULL
           AND trim(o.delivery_address_snapshot) <> ''
           AND o.operational_status <> 'CANCELLED'
         GROUP BY lower(trim(o.delivery_address_snapshot))
         ORDER BY order_count DESC, last_used_at DESC
         LIMIT 8`,
      )
      .all(input.customerId) as Row[];
    const historyTotal = Number(
      (
        this.db
          .prepare("SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?")
          .get(input.customerId) as Row
      ).total,
    );
    const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize)));
    const pageCount = historyTotal ? Math.ceil(historyTotal / pageSize) : 0;
    const page = pageCount
      ? Math.min(Math.max(1, Math.trunc(input.page)), pageCount)
      : 1;
    const orderIds = (
      this.db
        .prepare(
          `SELECT id FROM orders WHERE customer_id = ?
           ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(input.customerId, pageSize, (page - 1) * pageSize) as Row[]
    ).map((row) => String(row.id));
    return {
      customer: this.customerDto(customerRow),
      metrics: {
        orderCount,
        totalSpentMinor,
        averageTicketMinor: orderCount
          ? Math.round(totalSpentMinor / orderCount)
          : 0,
        outstandingMinor,
        frequencyDays,
        lastOrderAt: metricRows.length
          ? String(metricRows[metricRows.length - 1]!.created_at)
          : null,
        usualPaymentMethodCode: payment ? String(payment.code) : null,
        usualPaymentMethodName: payment ? String(payment.name) : null,
      },
      topProducts: products.map((row) => ({
        productId: row.product_id == null ? null : String(row.product_id),
        name: String(row.name),
        quantity: Number(row.quantity),
        totalMinor: Number(row.total_minor),
      })),
      topAddresses: addresses.map((row) => ({
        addressId: row.address_id == null ? null : String(row.address_id),
        address: String(row.address),
        orderCount: Number(row.order_count),
        lastUsedAt: String(row.last_used_at),
      })),
      history: {
        items: orderIds.map((id) => this.getOrder(id)),
        total: historyTotal,
        page,
        pageSize,
        pageCount,
      },
    };
  }

  setCustomerActive(input: {
    customerId: string;
    active: boolean;
    reason: string;
    authorizerPin: string;
  }): CustomerDto {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "customers.manage",
      );
      const row = requireRow(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(input.customerId) as Row | undefined,
        "El cliente no existe.",
      );
      if (input.active && row.merged_into_customer_id != null)
        throw new Error(
          "Una ficha fusionada no se puede reactivar; abrí la ficha receptora.",
        );
      if (!input.active) {
        const pending = this.db
          .prepare(
            `SELECT number FROM orders WHERE customer_id = ?
             AND (lifecycle_status = 'DRAFT' OR operational_status NOT IN ('DELIVERED','CANCELLED'))
             LIMIT 1`,
          )
          .get(input.customerId) as Row | undefined;
        if (pending)
          throw new Error(
            `El cliente tiene el pedido #${Number(pending.number)} pendiente. Cerralo antes de archivar.`,
          );
      }
      const before = this.customerDto(row);
      const timestamp = nowIso();
      this.db
        .prepare("UPDATE customers SET active = ?, updated_at = ? WHERE id = ?")
        .run(input.active ? 1 : 0, timestamp, input.customerId);
      const after = this.customerDto(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(input.customerId) as Row,
      );
      this.audit({
        entityType: "CUSTOMER",
        entityId: input.customerId,
        action: input.active ? "CUSTOMER_REACTIVATED" : "CUSTOMER_ARCHIVED",
        permission: "customers.manage",
        reason: input.reason,
        authorizerUserId: String(authorizer.id),
        before,
        after,
      });
      return after;
    });
    return run();
  }

  mergeCustomers(input: {
    sourceCustomerId: string;
    targetCustomerId: string;
    reason: string;
    authorizerPin: string;
  }): CustomerDto {
    const run = this.db.transaction(() => {
      if (input.sourceCustomerId === input.targetCustomerId)
        throw new Error("Elegí dos fichas distintas para fusionar.");
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "customers.manage",
      );
      const sourceRow = requireRow(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(input.sourceCustomerId) as Row | undefined,
        "La ficha de origen no existe.",
      );
      const targetRow = requireRow(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(input.targetCustomerId) as Row | undefined,
        "La ficha receptora no existe.",
      );
      if (!flag(sourceRow.active) || !flag(targetRow.active))
        throw new Error("Sólo se pueden fusionar fichas activas.");
      const source = this.customerDto(sourceRow);
      const target = this.customerDto(targetRow);
      const timestamp = nowIso();
      const targetAddresses = new Map(
        target.addresses.map((address) => [
          address.address.trim().toLocaleLowerCase("es-AR"),
          address,
        ]),
      );
      const insertAddress = this.db.prepare(
        `INSERT INTO customer_addresses(id, customer_id, label, address, notes,
           delivery_fee_minor, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      );
      const updateDuplicate = this.db.prepare(
        `UPDATE customer_addresses SET delivery_fee_minor = MAX(delivery_fee_minor, ?),
           notes = COALESCE(notes, ?), updated_at = ? WHERE id = ?`,
      );
      for (const address of source.addresses) {
        const key = address.address.trim().toLocaleLowerCase("es-AR");
        const duplicate = targetAddresses.get(key);
        if (duplicate) {
          updateDuplicate.run(
            address.deliveryFeeMinor,
            address.notes,
            timestamp,
            duplicate.id,
          );
          continue;
        }
        insertAddress.run(
          randomUUID(),
          target.id,
          address.label,
          address.address,
          address.notes,
          address.deliveryFeeMinor,
          timestamp,
          timestamp,
        );
      }
      this.db
        .prepare(
          "UPDATE orders SET customer_id = ?, updated_at = ? WHERE customer_id = ?",
        )
        .run(target.id, timestamp, source.id);
      const combinedTags = [...new Set([...target.tags, ...source.tags])];
      const combinedNotes =
        [
          target.notes,
          source.notes
            ? `Ficha fusionada de ${source.name}: ${source.notes}`
            : null,
        ]
          .filter(Boolean)
          .join("\n") || null;
      const combinedPreferences =
        [target.preferences, source.preferences]
          .filter(Boolean)
          .filter((value, index, values) => values.indexOf(value) === index)
          .join("\n") || null;
      this.db
        .prepare(
          `UPDATE customers SET notes = ?, preferences = ?, tags_json = ?,
             preferred_payment_method_code = COALESCE(preferred_payment_method_code, ?),
             updated_at = ? WHERE id = ?`,
        )
        .run(
          combinedNotes,
          combinedPreferences,
          json(combinedTags),
          source.preferredPaymentMethodCode,
          timestamp,
          target.id,
        );
      this.db
        .prepare(
          `UPDATE customers SET active = 0, merged_into_customer_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(target.id, timestamp, source.id);
      const mergedTarget = this.customerDto(
        this.db
          .prepare("SELECT * FROM customers WHERE id = ?")
          .get(target.id) as Row,
      );
      this.audit({
        entityType: "CUSTOMER",
        entityId: source.id,
        action: "CUSTOMER_MERGED",
        permission: "customers.manage",
        reason: input.reason,
        authorizerUserId: String(authorizer.id),
        before: source,
        after: { mergedIntoCustomerId: target.id },
      });
      this.audit({
        entityType: "CUSTOMER",
        entityId: target.id,
        action: "CUSTOMER_MERGE_RECEIVED",
        permission: "customers.manage",
        reason: input.reason,
        authorizerUserId: String(authorizer.id),
        before: target,
        after: mergedTarget,
      });
      return mergedTarget;
    });
    return run();
  }

  createCategory(input: { name: string }): CategoryDto {
    const run = this.db.transaction(() => {
      const name = input.name.trim();
      const existing = this.db
        .prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE")
        .get(name);
      if (existing) throw new Error("Ya existe una categoría con ese nombre.");
      const id = randomUUID();
      const timestamp = nowIso();
      const sortOrder = Number(
        (
          this.db
            .prepare(
              "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories",
            )
            .get() as Row
        ).next,
      );
      this.db
        .prepare(
          "INSERT INTO categories(id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, name, sortOrder, timestamp, timestamp);
      this.audit({
        entityType: "CATEGORY",
        entityId: id,
        action: "CATEGORY_CREATED",
      });
      return { id, name, sortOrder, active: true };
    });
    return run();
  }

  updateCategory(input: {
    categoryId: Id;
    name: string;
    active: boolean;
    sortOrder: number;
    reason: string;
    authorizerPin: string;
  }): CategoryDto {
    const run = this.db.transaction(() => {
      const before = requireRow(
        this.listCategories().find(
          (category) => category.id === input.categoryId,
        ),
        "La categoría no existe.",
      );
      const duplicate = this.db
        .prepare(
          "SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?",
        )
        .get(input.name.trim(), input.categoryId);
      if (duplicate) throw new Error("Ya existe una categoría con ese nombre.");
      if (!input.active) {
        const activeProducts = this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM products WHERE category_id = ? AND active = 1",
          )
          .get(input.categoryId) as Row;
        if (Number(activeProducts.count) > 0)
          throw new Error(
            `La categoría tiene ${Number(activeProducts.count)} producto(s) activo(s). Reasignalos o desactivalos antes.`,
          );
      }
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "prices.bulk_update",
      );
      this.db
        .prepare(
          "UPDATE categories SET name = ?, active = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          input.name.trim(),
          input.active ? 1 : 0,
          input.sortOrder,
          nowIso(),
          input.categoryId,
        );
      const after = requireRow(
        this.listCategories().find(
          (category) => category.id === input.categoryId,
        ),
        "No se pudo leer la categoría actualizada.",
      );
      this.audit({
        entityType: "CATEGORY",
        entityId: input.categoryId,
        action: "CATEGORY_UPDATED",
        permission: "prices.bulk_update",
        reason: input.reason.trim(),
        before,
        after,
        authorizerUserId: String(authorizer.id),
      });
      this.event("Category", input.categoryId, "CategoryUpdated", after);
      return after;
    });
    return run();
  }

  deleteCategory(input: {
    categoryId: Id;
    reason: string;
    authorizerPin: string;
  }): { deleted: true } {
    const run = this.db.transaction(() => {
      const before = requireRow(
        this.listCategories().find(
          (category) => category.id === input.categoryId,
        ),
        "La categoría no existe.",
      );
      const references = this.db
        .prepare("SELECT COUNT(*) AS count FROM products WHERE category_id = ?")
        .get(input.categoryId) as Row;
      if (Number(references.count) > 0)
        throw new Error(
          "La categoría tiene productos o historial asociado. Podés desactivarla desde Editar.",
        );
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "prices.bulk_update",
      );
      const result = this.db
        .prepare("DELETE FROM categories WHERE id = ?")
        .run(input.categoryId);
      if (!result.changes) throw new Error("La categoría no existe.");
      this.audit({
        entityType: "CATEGORY",
        entityId: input.categoryId,
        action: "CATEGORY_DELETED",
        permission: "prices.bulk_update",
        reason: input.reason.trim(),
        before,
        authorizerUserId: String(authorizer.id),
      });
      return { deleted: true as const };
    });
    return run();
  }

  createProduct(input: {
    categoryId: Id;
    name: string;
    code?: string | null;
    stockMinor?: number | null;
    prices: Array<{
      priceListCode: "SALON" | "TAKEAWAY" | "DELIVERY";
      amountMinor: number;
    }>;
  }): ProductDto {
    const run = this.db.transaction(() => {
      const category = requireRow(
        this.db
          .prepare("SELECT id FROM categories WHERE id = ? AND active = 1")
          .get(input.categoryId),
        "La categoría no existe.",
      );
      void category;
      const id = randomUUID();
      const timestamp = nowIso();
      const sortOrder = Number(
        (
          this.db
            .prepare(
              "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM products WHERE category_id = ?",
            )
            .get(input.categoryId) as Row
        ).next,
      );
      this.db
        .prepare(
          `INSERT INTO products(id, category_id, name, code, sort_order, stock_minor, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.categoryId,
          input.name.trim(),
          input.code?.trim() || null,
          sortOrder,
          input.stockMinor ?? null,
          timestamp,
          timestamp,
        );
      const insertPrice = this.db.prepare(
        `INSERT INTO product_prices(product_id, price_list_id, amount_minor, updated_at)
         SELECT ?, id, ?, ? FROM price_lists WHERE code = ?`,
      );
      for (const price of input.prices) {
        const result = insertPrice.run(
          id,
          price.amountMinor,
          timestamp,
          price.priceListCode,
        );
        if (!result.changes)
          throw new Error(`No existe la lista ${price.priceListCode}.`);
      }
      this.audit({
        entityType: "PRODUCT",
        entityId: id,
        action: "PRODUCT_CREATED",
      });
      return requireRow(
        this.listProducts().find((product) => product.id === id),
        "No se pudo leer el producto creado.",
      );
    });
    return run();
  }

  updateProduct(input: UpdateProductInput): ProductDto {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "prices.bulk_update",
      );
      const before = requireRow(
        this.listProducts().find((product) => product.id === input.productId),
        "El producto no existe.",
      );
      requireRow(
        this.db
          .prepare("SELECT id FROM categories WHERE id = ? AND active = 1")
          .get(input.categoryId),
        "La categoría no existe.",
      );
      const timestamp = nowIso();
      this.db
        .prepare(
          `UPDATE products SET category_id = ?, name = ?, code = ?, active = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.categoryId,
          input.name.trim(),
          input.code?.trim() || null,
          input.active ? 1 : 0,
          timestamp,
          input.productId,
        );
      const upsertPrice = this.db
        .prepare(`INSERT INTO product_prices(product_id, price_list_id, amount_minor, updated_at)
        SELECT ?, id, ?, ? FROM price_lists WHERE code = ?
        ON CONFLICT(product_id, price_list_id) DO UPDATE SET amount_minor = excluded.amount_minor, updated_at = excluded.updated_at`);
      for (const price of input.prices) {
        const result = upsertPrice.run(
          input.productId,
          price.amountMinor,
          timestamp,
          price.priceListCode,
        );
        if (!result.changes)
          throw new Error(`No existe la lista ${price.priceListCode}.`);
      }
      const after = requireRow(
        this.listProducts().find((product) => product.id === input.productId),
        "No se pudo leer el producto actualizado.",
      );
      this.audit({
        entityType: "PRODUCT",
        entityId: input.productId,
        action: "PRODUCT_UPDATED",
        permission: "prices.bulk_update",
        reason: input.reason.trim(),
        before,
        after,
        authorizerUserId: String(authorizer.id),
      });
      this.event("Product", input.productId, "ProductUpdated", {
        prices: after.prices,
      });
      return after;
    });
    return run();
  }

  bulkUpdateProducts(input: BulkUpdateProductsInput): ProductDto[] {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(
        input.authorizerPin,
        "prices.bulk_update",
      );
      const requestedIds = [...new Set(input.productIds)];
      const before = this.listProducts().filter((product) =>
        requestedIds.includes(product.id),
      );
      if (before.length !== requestedIds.length)
        throw new Error("Uno o más productos seleccionados ya no existen.");
      if (input.categoryId != null) {
        requireRow(
          this.db
            .prepare("SELECT id FROM categories WHERE id = ? AND active = 1")
            .get(input.categoryId),
          "La categoría elegida no existe o está inactiva.",
        );
      }
      const timestamp = nowIso();
      const updateCategory = this.db.prepare(
        "UPDATE products SET category_id = ?, updated_at = ? WHERE id = ?",
      );
      const updateActive = this.db.prepare(
        "UPDATE products SET active = ?, updated_at = ? WHERE id = ?",
      );
      for (const productId of requestedIds) {
        if (input.categoryId != null)
          updateCategory.run(input.categoryId, timestamp, productId);
        if (input.active != null)
          updateActive.run(input.active ? 1 : 0, timestamp, productId);
      }

      let changedPrices = 0;
      if (input.priceAdjustment) {
        const getPrice = this.db.prepare(
          `SELECT pp.amount_minor, pl.id AS price_list_id, pl.name AS price_list_name
           FROM price_lists pl LEFT JOIN product_prices pp
             ON pp.price_list_id = pl.id AND pp.product_id = ?
           WHERE pl.code = ? AND pl.active = 1`,
        );
        const upsertPrice = this.db.prepare(
          `INSERT INTO product_prices(product_id, price_list_id, amount_minor, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(product_id, price_list_id) DO UPDATE SET
             amount_minor = excluded.amount_minor, updated_at = excluded.updated_at`,
        );
        for (const product of before) {
          for (const code of input.priceAdjustment.priceListCodes) {
            const price = requireRow(
              getPrice.get(product.id, code) as Row | undefined,
              `No existe la lista de precios ${code}.`,
            );
            const current = Number(price.amount_minor ?? 0);
            const next =
              input.priceAdjustment.mode === "PERCENTAGE"
                ? Math.round(current * (1 + input.priceAdjustment.value / 100))
                : current + input.priceAdjustment.value;
            if (!Number.isSafeInteger(next))
              throw new Error(
                `El ajuste deja un precio fuera del rango válido en ${product.name}.`,
              );
            if (next < 0) {
              throw new Error(
                `El ajuste dejaría con precio negativo a ${product.name} en ${String(price.price_list_name)}.`,
              );
            }
            upsertPrice.run(product.id, price.price_list_id, next, timestamp);
            changedPrices += 1;
          }
        }
      }

      const after = this.listProducts().filter((product) =>
        requestedIds.includes(product.id),
      );
      const batchId = randomUUID();
      this.audit({
        entityType: "PRODUCT_BATCH",
        entityId: batchId,
        action: "PRODUCTS_BULK_UPDATED",
        permission: "prices.bulk_update",
        reason: input.reason,
        before: {
          productIds: requestedIds,
          count: before.length,
          categories: [...new Set(before.map((product) => product.categoryId))],
          activeCount: before.filter((product) => product.active).length,
        },
        after: {
          categoryId: input.categoryId ?? null,
          active: input.active ?? null,
          priceAdjustment: input.priceAdjustment ?? null,
          changedPrices,
        },
        authorizerUserId: String(authorizer.id),
      });
      this.event("ProductBatch", batchId, "ProductsBulkUpdated", {
        productIds: requestedIds,
        categoryId: input.categoryId ?? null,
        active: input.active ?? null,
        priceAdjustment: input.priceAdjustment ?? null,
      });
      return after;
    });
    return run();
  }

  createModifier(input: {
    groupName: string;
    name: string;
    priceMinor: number;
  }): ModifierDto {
    const run = this.db.transaction(() => {
      const timestamp = nowIso();
      let group = this.db
        .prepare("SELECT id FROM modifier_groups WHERE name = ? COLLATE NOCASE")
        .get(input.groupName.trim()) as Row | undefined;
      if (!group) {
        group = { id: randomUUID() };
        this.db
          .prepare(
            `INSERT INTO modifier_groups(id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM modifier_groups))`,
          )
          .run(group.id, input.groupName.trim());
      }
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO modifiers(id, group_id, name, price_minor, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM modifiers WHERE group_id = ?), ?, ?)`,
        )
        .run(
          id,
          group.id,
          input.name.trim(),
          input.priceMinor,
          group.id,
          timestamp,
          timestamp,
        );
      this.audit({
        entityType: "MODIFIER",
        entityId: id,
        action: "MODIFIER_CREATED",
      });
      return requireRow(
        this.listModifiers().find((modifier) => modifier.id === id),
        "No se pudo leer el modificador.",
      );
    });
    return run();
  }

  adjustStock(input: {
    productId: Id;
    newStockMinor: number;
    reason: string;
    authorizerPin: string;
  }): ProductDto {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(input.authorizerPin, "stock.adjust");
      const product = requireRow(
        this.db
          .prepare("SELECT * FROM products WHERE id = ?")
          .get(input.productId) as Row | undefined,
        "El producto no existe.",
      );
      this.db
        .prepare(
          "UPDATE products SET stock_minor = ?, updated_at = ? WHERE id = ?",
        )
        .run(input.newStockMinor, nowIso(), input.productId);
      this.audit({
        entityType: "PRODUCT",
        entityId: input.productId,
        action: "STOCK_ADJUSTED",
        permission: "stock.adjust",
        reason: input.reason,
        before: { stockMinor: product.stock_minor },
        after: { stockMinor: input.newStockMinor },
        authorizerUserId: String(authorizer.id),
      });
      return requireRow(
        this.listProducts().find(
          (candidate) => candidate.id === input.productId,
        ),
        "No se pudo leer el producto.",
      );
    });
    return run();
  }

  createUser(input: {
    staffNumber?: number;
    fullName: string;
    roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
    pin: string;
    authorizerPin: string;
  }): UserDto {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(input.authorizerPin, "users.manage");
      const role = requireRow(
        this.db
          .prepare("SELECT id FROM roles WHERE code = ?")
          .get(input.roleCode) as Row | undefined,
        "El rol no existe.",
      );
      const id = randomUUID();
      const timestamp = nowIso();
      const staffNumber = input.staffNumber ?? this.nextAvailableStaffNumber();
      this.assertStaffNumberAvailable(staffNumber);
      this.db
        .prepare(
          `INSERT INTO users(id, staff_number, full_name, role_id, pin_hash, must_change_pin, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        )
        .run(
          id,
          staffNumber,
          input.fullName.trim(),
          role.id,
          bcrypt.hashSync(input.pin, 12),
          timestamp,
          timestamp,
        );
      this.audit({
        entityType: "USER",
        entityId: id,
        action: "USER_CREATED",
        permission: "users.manage",
        after: { roleCode: input.roleCode, staffNumber },
        authorizerUserId: String(authorizer.id),
      });
      return requireRow(
        this.listUsers().find((user) => user.id === id),
        "No se pudo leer el usuario.",
      );
    });
    return run();
  }

  createDriver(input: { fullName: string; authorizerPin: string }): UserDto {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(input.authorizerPin, "users.manage");
      const role = requireRow(
        this.db
          .prepare("SELECT id FROM roles WHERE code = 'DELIVERY_DRIVER'")
          .get() as Row | undefined,
        "El rol de repartidor no existe.",
      );
      const id = randomUUID();
      const timestamp = nowIso();
      const staffNumber = this.nextAvailableStaffNumber();
      // El hash usa un secreto no numérico e irrecuperable: este registro es una
      // identidad operativa para asignaciones, no una cuenta con acceso al POS.
      this.db
        .prepare(
          `INSERT INTO users(id, staff_number, full_name, role_id, pin_hash, must_change_pin, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        )
        .run(
          id,
          staffNumber,
          input.fullName.trim(),
          role.id,
          bcrypt.hashSync(randomUUID(), 12),
          timestamp,
          timestamp,
        );
      this.audit({
        entityType: "USER",
        entityId: id,
        action: "DRIVER_CREATED",
        permission: "users.manage",
        after: { roleCode: "DELIVERY_DRIVER", loginEnabled: false },
        authorizerUserId: String(authorizer.id),
      });
      return requireRow(
        this.listUsers().find((user) => user.id === id),
        "No se pudo leer el repartidor.",
      );
    });
    return run();
  }

  updateUser(input: {
    userId: Id;
    staffNumber?: number;
    roleCode: "ADMIN" | "MANAGER" | "CASHIER" | "WAITER" | "DELIVERY_DRIVER";
    active: boolean;
    newPin?: string | null;
    reason: string;
    authorizerPin: string;
  }): UserDto {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(input.authorizerPin, "users.manage");
      const before = requireRow(
        this.listUsers().find((user) => user.id === input.userId),
        "El usuario no existe.",
      );
      if (
        input.userId === this.adminUserId &&
        (!input.active || input.roleCode !== "ADMIN")
      ) {
        throw new Error(
          "El administrador operativo inicial debe permanecer activo con rol ADMIN.",
        );
      }
      if (
        before.roleCode === "DELIVERY_DRIVER" &&
        (!input.active || input.roleCode !== "DELIVERY_DRIVER")
      ) {
        const activeDeliveries = this.db
          .prepare(
            `SELECT number FROM orders
             WHERE driver_user_id = ? AND type = 'DELIVERY'
               AND operational_status NOT IN ('DELIVERED','CANCELLED')
             ORDER BY number LIMIT 10`,
          )
          .all(input.userId) as Row[];
        if (activeDeliveries.length)
          throw new Error(
            `El repartidor tiene ${activeDeliveries.length} envío(s) activo(s): ${activeDeliveries.map((order) => `#${String(order.number)}`).join(", ")}. Reasignalos antes de desactivarlo o cambiar su rol.`,
          );
      }
      const role = requireRow(
        this.db
          .prepare("SELECT id FROM roles WHERE code = ?")
          .get(input.roleCode) as Row | undefined,
        "El rol no existe.",
      );
      const staffNumber = input.staffNumber ?? before.staffNumber;
      this.assertStaffNumberAvailable(staffNumber, input.userId);
      if (input.newPin) {
        this.db
          .prepare(
            "UPDATE users SET staff_number = ?, role_id = ?, active = ?, pin_hash = ?, must_change_pin = 0, updated_at = ? WHERE id = ?",
          )
          .run(
            staffNumber,
            role.id,
            input.active ? 1 : 0,
            bcrypt.hashSync(input.newPin, 12),
            nowIso(),
            input.userId,
          );
      } else {
        this.db
          .prepare(
            "UPDATE users SET staff_number = ?, role_id = ?, active = ?, updated_at = ? WHERE id = ?",
          )
          .run(
            staffNumber,
            role.id,
            input.active ? 1 : 0,
            nowIso(),
            input.userId,
          );
      }
      const after = requireRow(
        this.listUsers().find((user) => user.id === input.userId),
        "No se pudo leer el usuario.",
      );
      this.audit({
        entityType: "USER",
        entityId: input.userId,
        action: "USER_UPDATED",
        permission: "users.manage",
        reason: input.reason,
        before: {
          staffNumber: before.staffNumber,
          roleCode: before.roleCode,
          active: before.active,
        },
        after: {
          staffNumber: after.staffNumber,
          roleCode: after.roleCode,
          active: after.active,
          pinChanged: Boolean(input.newPin),
        },
        authorizerUserId: String(authorizer.id),
      });
      return after;
    });
    return run();
  }

  deleteUser(input: { userId: Id; reason: string; authorizerPin: string }): {
    deleted: true;
  } {
    const run = this.db.transaction(() => {
      const authorizer = this.authorizePin(input.authorizerPin, "users.manage");
      const before = requireRow(
        this.listUsers().find((user) => user.id === input.userId),
        "El usuario no existe.",
      );
      if (input.userId === this.adminUserId)
        throw new Error(
          "El administrador operativo inicial no puede eliminarse.",
        );
      if (String(authorizer.id) === input.userId)
        throw new Error(
          "No podés eliminar el usuario que autoriza la operación.",
        );
      const references = [
        ["cash_sessions", "opened_by_user_id"],
        ["cash_sessions", "closed_by_user_id"],
        ["cash_movements", "user_id"],
        ["orders", "waiter_user_id"],
        ["orders", "driver_user_id"],
        ["payments", "created_by_user_id"],
        ["audit_log", "operator_user_id"],
        ["audit_log", "authorizer_user_id"],
        ["delivery_ledger", "driver_user_id"],
        ["delivery_ledger", "settled_by_user_id"],
        ["payment_refunds", "created_by_user_id"],
        ["payment_refunds", "authorized_by_user_id"],
      ] as const;
      const hasHistory = references.some(([table, column]) =>
        this.db
          .prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`)
          .get(input.userId),
      );
      if (hasHistory)
        throw new Error(
          "El usuario tiene actividad o historial asociado. Podés marcarlo inactivo desde Editar.",
        );
      const result = this.db
        .prepare("DELETE FROM users WHERE id = ?")
        .run(input.userId);
      if (!result.changes) throw new Error("El usuario no existe.");
      this.audit({
        entityType: "USER",
        entityId: input.userId,
        action: "USER_DELETED",
        permission: "users.manage",
        reason: input.reason.trim(),
        before,
        authorizerUserId: String(authorizer.id),
      });
      return { deleted: true as const };
    });
    return run();
  }

  settleDelivery(input: SettleDeliveryInput): DeliveryLedgerDto[] {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "settleDelivery",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          if (!input.ledgerIds.length)
            throw new Error("Seleccioná al menos una liquidación.");
          const requestedIds = [...new Set(input.ledgerIds)];
          if (requestedIds.length !== input.ledgerIds.length)
            throw new Error("La selección contiene liquidaciones repetidas.");
          const reason = input.reason.trim();
          if (!reason) throw new Error("La liquidación requiere un motivo.");
          const session = this.requireOpenCashSessionRow();
          const authorizer = this.authorizePin(
            input.authorizerPin,
            "cash.expense",
          );
          const timestamp = nowIso();
          const rows = requestedIds.map((id) =>
            requireRow(
              this.db
                .prepare(
                  `SELECT * FROM delivery_ledger
               WHERE id = ? AND status = 'PENDING'
                 AND amount_due_minor > settled_amount_minor`,
                )
                .get(id) as Row | undefined,
              "La liquidación ya no está pendiente.",
            ),
          );
          if (new Set(rows.map((row) => String(row.driver_user_id))).size !== 1)
            throw new Error(
              "Liquidá un repartidor por vez para conservar una rendición clara y auditable.",
            );
          const incomingMinor = rows
            .filter((row) => String(row.direction) === "DRIVER_OWES_BUSINESS")
            .reduce((total, row) => total + Number(row.amount_due_minor), 0);
          const outgoingMinor = rows
            .filter((row) => String(row.direction) === "BUSINESS_OWES_DRIVER")
            .reduce((total, row) => total + Number(row.amount_due_minor), 0);
          if (
            outgoingMinor >
            this.cashSessionDto(session).expectedAmountMinor + incomingMinor
          )
            throw new Error(
              "La caja no tiene efectivo suficiente para pagar esta rendición.",
            );
          for (const row of rows) {
            const id = String(row.id);
            const movementType =
              String(row.direction) === "DRIVER_OWES_BUSINESS"
                ? "INCOME"
                : "EXPENSE";
            this.db
              .prepare(
                `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash, user_id, reason, created_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
              )
              .run(
                randomUUID(),
                session.id,
                movementType,
                row.amount_due_minor,
                this.adminUserId,
                `Liquidación de reparto: ${reason}`,
                timestamp,
              );
            this.db
              .prepare(
                `UPDATE delivery_ledger SET settled_amount_minor = amount_due_minor, status = 'SETTLED', settled_at = ?, settled_by_user_id = ?, settlement_reason = ? WHERE id = ?`,
              )
              .run(timestamp, authorizer.id, reason, id);
            this.audit({
              entityType: "DELIVERY_LEDGER",
              entityId: id,
              action: "DELIVERY_SETTLED",
              permission: "cash.expense",
              reason,
              after: { amountMinor: row.amount_due_minor },
              authorizerUserId: String(authorizer.id),
            });
            this.event("DeliveryLedger", id, "DeliverySettled", {
              amountMinor: row.amount_due_minor,
            });
          }
          return this.listDeliveryLedger().filter((row) =>
            requestedIds.includes(row.id),
          );
        });
        return run();
      },
    );
  }

  reverseCashMovement(input: ReverseCashMovementInput): CashSessionDto {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "reverseCashMovement",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          const session = this.requireOpenCashSessionRow();
          const authorizer = this.authorizePin(
            input.authorizerPin,
            "cash.expense",
          );
          const original = requireRow(
            this.db
              .prepare("SELECT * FROM cash_movements WHERE id = ?")
              .get(input.movementId) as Row | undefined,
            "El movimiento no existe.",
          );
          const existingReversal = this.db
            .prepare("SELECT id FROM cash_movements WHERE reference_id = ?")
            .get(input.movementId);
          if (existingReversal)
            throw new Error("Este movimiento ya fue anulado.");

          const originalType = String(original.type);
          if (
            originalType === "OPENING" ||
            originalType === "CLOSING" ||
            originalType === "SALE" ||
            originalType === "REFUND"
          ) {
            throw new Error(
              "No podés anular este tipo de movimiento directamente. Revertí el pedido o el pago.",
            );
          }

          const reversedType =
            originalType === "INCOME"
              ? "EXPENSE"
              : originalType === "EXPENSE"
                ? "INCOME"
                : originalType === "WITHDRAWAL"
                  ? "INCOME"
                  : "EXPENSE";

          const timestamp = nowIso();
          const newId = randomUUID();
          this.db
            .prepare(
              `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash, payment_method_id, order_id, user_id, reason, created_at, reference_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              newId,
              session.id,
              reversedType,
              original.amount_minor,
              original.affects_cash,
              original.payment_method_id,
              original.order_id,
              authorizer.id,
              `Anulación: ${input.reason.trim()}`,
              timestamp,
              input.movementId,
            );
          this.audit({
            entityType: "CASH_MOVEMENT",
            entityId: newId,
            action: "CASH_REVERSED",
            permission: "cash.expense",
            reason: input.reason.trim(),
            before: { originalId: input.movementId },
            authorizerUserId: String(authorizer.id),
          });
          return this.cashSessionDto(session);
        });
        return run();
      },
    );
  }

  reverseDeliverySettlement(
    input: ReverseDeliverySettlementInput,
  ): DeliveryLedgerDto {
    return this.idempotentTransaction(
      input.idempotencyKey,
      input.terminalId,
      "reverseDeliverySettlement",
      undefined,
      input,
      () => {
        const run = this.db.transaction(() => {
          const session = this.requireOpenCashSessionRow();
          const authorizer = this.authorizePin(
            input.authorizerPin,
            "cash.expense",
          );
          const timestamp = nowIso();

          const row = requireRow(
            this.db
              .prepare("SELECT * FROM delivery_ledger WHERE id = ?")
              .get(input.ledgerId) as Row | undefined,
            "La liquidación no existe.",
          );
          if (String(row.status) !== "SETTLED") {
            throw new Error("La liquidación no está rendida.");
          }

          const movementType =
            String(row.direction) === "DRIVER_OWES_BUSINESS"
              ? "EXPENSE"
              : "INCOME";

          this.db
            .prepare(
              `INSERT INTO cash_movements(id, cash_session_id, type, amount_minor, affects_cash, user_id, reason, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              session.id,
              movementType,
              row.settled_amount_minor,
              authorizer.id,
              `Anulación de liquidación: ${input.reason.trim()}`,
              timestamp,
            );

          this.db
            .prepare(
              `UPDATE delivery_ledger SET status = 'PENDING', settled_amount_minor = 0, settled_at = NULL, settled_by_user_id = NULL, settlement_reason = NULL WHERE id = ?`,
            )
            .run(input.ledgerId);

          this.audit({
            entityType: "DELIVERY_LEDGER",
            entityId: input.ledgerId,
            action: "DELIVERY_SETTLEMENT_REVERSED",
            permission: "cash.expense",
            reason: input.reason.trim(),
            before: { status: "SETTLED" },
            after: { status: "PENDING" },
            authorizerUserId: String(authorizer.id),
          });

          return this.listDeliveryLedger().find(
            (r) => r.id === input.ledgerId,
          )!;
        });
        return run();
      },
    );
  }

  configureTables(count: number): RestaurantTableDto[] {
    const run = this.db.transaction(() => {
      if (!Number.isInteger(count) || count < 1 || count > 200)
        throw new Error("La cantidad de mesas debe estar entre 1 y 200.");
      for (let number = 1; number <= count; number += 1)
        this.ensureTable(number);
      const candidates = this.listTables().filter(
        (table) => table.active && table.number > count,
      );
      let protectedCount = 0;
      for (const table of candidates) {
        if (table.currentOrderId) {
          protectedCount += 1;
          continue;
        }
        this.db
          .prepare("UPDATE restaurant_tables SET active = 0 WHERE id = ?")
          .run(table.id);
      }
      this.audit({
        entityType: "RESTAURANT_TABLE",
        entityId: "configuration",
        action: "TABLES_CONFIGURED",
        after: {
          requestedCount: count,
          protectedOccupiedTables: protectedCount,
        },
      });
      return this.listTables();
    });
    return run();
  }

  updateTable(input: {
    tableId: Id;
    number: number;
    name?: string | null;
    active: boolean;
    sortOrder?: number;
  }): RestaurantTableDto {
    const run = this.db.transaction(() => {
      const before = requireRow(
        this.listTables().find((table) => table.id === input.tableId),
        "La mesa no existe.",
      );
      if (
        !Number.isInteger(input.number) ||
        input.number < 1 ||
        input.number > 9999
      )
        throw new Error("Ingresá un número de mesa válido.");
      if (!input.active && before.currentOrderId)
        throw new Error(
          "No se puede desactivar una mesa ocupada. Cerrá primero su pedido.",
        );
      const duplicate = this.db
        .prepare(
          "SELECT id FROM restaurant_tables WHERE number = ? AND id <> ?",
        )
        .get(input.number, input.tableId);
      if (duplicate) throw new Error("Ya existe otra mesa con ese número.");
      this.db
        .prepare(
          "UPDATE restaurant_tables SET number = ?, name = ?, active = ?, sort_order = ? WHERE id = ?",
        )
        .run(
          input.number,
          input.name?.trim() || null,
          input.active ? 1 : 0,
          input.sortOrder ?? before.sortOrder,
          input.tableId,
        );
      this.audit({
        entityType: "RESTAURANT_TABLE",
        entityId: input.tableId,
        action: "TABLE_UPDATED",
        before,
        after: input,
      });
      return requireRow(
        this.listTables().find((table) => table.id === input.tableId),
        "No se pudo leer la mesa.",
      );
    });
    return run();
  }

  deleteTable(input: { tableId: Id }): { deleted: true } {
    const run = this.db.transaction(() => {
      const table = requireRow(
        this.listTables().find((candidate) => candidate.id === input.tableId),
        "La mesa no existe.",
      );
      assertPermission(this.currentUser().permissions, "tables.manage");
      const order = table.currentOrderId
        ? (this.db
            .prepare("SELECT * FROM orders WHERE id = ?")
            .get(table.currentOrderId) as Row | undefined)
        : undefined;
      if (order) {
        const itemCount = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?",
              )
              .get(order.id) as Row
          ).count,
        );
        const paymentCount = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) AS count FROM payments WHERE order_id = ?",
              )
              .get(order.id) as Row
          ).count,
        );
        const printCount = Number(
          (
            this.db
              .prepare(
                "SELECT COUNT(*) AS count FROM print_jobs WHERE order_id = ?",
              )
              .get(order.id) as Row
          ).count,
        );
        if (
          itemCount > 0 ||
          paymentCount > 0 ||
          printCount > 0 ||
          Number(order.paid_minor) > 0
        )
          throw new Error(
            "No se puede eliminar una mesa con consumo, pagos o impresiones. Cerrá el pedido y conservá su historial.",
          );
        const timestamp = nowIso();
        this.db
          .prepare(
            "UPDATE orders SET operational_status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?, version = version + 1, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, "Mesa eliminada sin consumo", timestamp, order.id);
        this.audit({
          entityType: "ORDER",
          entityId: String(order.id),
          action: "ORDER_EMPTY_CANCELLED",
          permission: "tables.manage",
          reason: "Mesa eliminada sin consumo",
          before: { status: order.operational_status },
          after: { status: "CANCELLED" },
        });
      }
      this.db
        .prepare("UPDATE restaurant_tables SET active = 0 WHERE id = ?")
        .run(input.tableId);
      this.audit({
        entityType: "RESTAURANT_TABLE",
        entityId: input.tableId,
        action: "TABLE_DELETED",
        permission: "tables.manage",
        before: table,
        after: { active: false },
      });
      this.event("RestaurantTable", input.tableId, "RestaurantTableDeleted", {
        active: false,
      });
      return { deleted: true as const };
    });
    return run();
  }

  exportSalesCsv(): string {
    const rows = this.db
      .prepare(
        `SELECT o.number, cs.business_date, o.created_at, o.type, o.operational_status,
      o.payment_status, o.customer_name_snapshot, o.customer_phone_snapshot, o.subtotal_minor,
      o.discount_minor, o.delivery_fee_minor, o.total_minor, o.paid_minor
      FROM orders o JOIN cash_sessions cs ON cs.id = o.cash_session_created_id WHERE o.lifecycle_status = 'CONFIRMED' ORDER BY o.created_at`,
      )
      .all() as Row[];
    const headers = [
      "pedido",
      "dia_comercial",
      "creado",
      "tipo",
      "estado",
      "pago",
      "cliente",
      "telefono",
      "subtotal",
      "descuento",
      "envio",
      "total",
      "pagado",
    ];
    const cell = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    return [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.number,
          row.business_date,
          row.created_at,
          (
            {
              DINE_IN: "Salón",
              TAKEAWAY: "Para retirar",
              DELIVERY: "Envío",
            } as Record<string, string>
          )[String(row.type)] ?? row.type,
          (
            {
              PENDING: "Pendiente",
              IN_PREPARATION: "En preparación",
              READY: "Listo",
              OUT_FOR_DELIVERY: "En reparto",
              DELIVERED: "Entregado",
              CANCELLED: "Cancelado",
            } as Record<string, string>
          )[String(row.operational_status)] ?? row.operational_status,
          (
            {
              UNPAID: "Impago",
              PARTIALLY_PAID: "Pago parcial",
              PAID: "Pagado",
            } as Record<string, string>
          )[String(row.payment_status)] ?? row.payment_status,
          row.customer_name_snapshot,
          row.customer_phone_snapshot,
          row.subtotal_minor,
          row.discount_minor,
          row.delivery_fee_minor,
          row.total_minor,
          row.paid_minor,
        ]
          .map(cell)
          .join(","),
      ),
    ].join("\r\n");
  }

  listCashSessionHistory(): CashSessionHistoryItemDto[] {
    const cutoff = new Date();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - 2);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    return (
      this.db
        .prepare(
          "SELECT * FROM cash_sessions WHERE status = 'CLOSED' ORDER BY closed_at DESC, opened_at DESC",
        )
        .all() as Row[]
    ).map((row) => ({
      session: this.cashSessionDto(row),
      detailAvailable:
        String(row.closed_at ?? row.opened_at).slice(0, 10) >= cutoffDate,
    }));
  }

  getCashSessionReport(
    filters: CashSessionReportFilters,
  ): CashSessionReportDto {
    const sessionRow = requireRow(
      this.db
        .prepare("SELECT * FROM cash_sessions WHERE id = ?")
        .get(filters.cashSessionId) as Row | undefined,
      "La caja no existe.",
    );
    const session = this.cashSessionDto(sessionRow);
    const cutoff = new Date();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - 2);
    const retentionCutoff = cutoff.toISOString().slice(0, 10);
    const detailAvailable =
      String(sessionRow.closed_at ?? sessionRow.opened_at).slice(0, 10) >=
        retentionCutoff || session.status === "OPEN";
    const effectiveFilters = { ...filters };
    if (!detailAvailable) {
      for (const key of [
        "tableId",
        "waiterUserId",
        "productId",
        "categoryName",
        "orderType",
        "paymentMethodCode",
        "operationalStatus",
      ] as const)
        delete (effectiveFilters as Record<string, unknown>)[key];
    }
    const paidRows = this.db
      .prepare(
        `SELECT o.id FROM orders o WHERE o.cash_session_paid_id = ? AND o.lifecycle_status = 'CONFIRMED' AND o.operational_status <> 'CANCELLED' AND o.paid_minor > 0`,
      )
      .all(session.id) as Row[];
    const paidIds = paidRows.map((r) => String(r.id));
    const allRows = detailAvailable
      ? (this.db
          .prepare(
            "SELECT id FROM orders WHERE cash_session_created_id = ? OR cash_session_paid_id = ? ORDER BY created_at",
          )
          .all(session.id, session.id) as Row[])
      : [];
    const allOrders = allRows.map((r) => this.getOrder(String(r.id)));
    const paidOrders = paidIds.map((id) => this.getOrder(id));
    const matches = (o: OrderDto) => {
      if (effectiveFilters.tableId && o.tableId !== effectiveFilters.tableId)
        return false;
      if (
        effectiveFilters.waiterUserId &&
        o.waiterUserId !== effectiveFilters.waiterUserId
      )
        return false;
      if (effectiveFilters.orderType && o.type !== effectiveFilters.orderType)
        return false;
      if (
        effectiveFilters.operationalStatus &&
        o.operationalStatus !== effectiveFilters.operationalStatus
      )
        return false;
      if (
        effectiveFilters.productId &&
        !o.items.some(
          (i) =>
            i.productId === effectiveFilters.productId ||
            i.halves.some((h) => h.productId === effectiveFilters.productId),
        )
      )
        return false;
      if (
        effectiveFilters.categoryName &&
        !o.items.some((i) => {
          const row = this.db
            .prepare(
              "SELECT category_name_snapshot FROM order_items WHERE id = ?",
            )
            .get(i.id) as Row | undefined;
          return (
            String(row?.category_name_snapshot ?? "Sin categoría") ===
            effectiveFilters.categoryName
          );
        })
      )
        return false;
      if (
        effectiveFilters.paymentMethodCode &&
        !o.payments.some(
          (p) =>
            p.methodCode === effectiveFilters.paymentMethodCode &&
            o.cashSessionPaidId === session.id,
        )
      )
        return false;
      return true;
    };
    const selected = paidOrders.filter(matches);
    const total = selected.reduce((n, o) => n + o.paidMinor, 0);
    const refunds = selected.reduce(
      (n, o) =>
        n +
        o.payments
          .filter((p) => o.cashSessionPaidId === session.id)
          .reduce((x, p) => x + p.refundedMinor, 0),
      0,
    );
    const byTable = new Map<
      string,
      {
        tableId: Id | null;
        name: string;
        orderCount: number;
        amountMinor: number;
      }
    >();
    const byWaiter = new Map<
      string,
      {
        waiterUserId: Id | null;
        name: string;
        orderCount: number;
        amountMinor: number;
      }
    >();
    const byType = new Map<
      string,
      { type: OrderType; orderCount: number; amountMinor: number }
    >();
    const byPayment = new Map<
      string,
      { code: string; name: string; amountMinor: number }
    >();
    const byProduct = new Map<
      string,
      {
        productId: Id | null;
        name: string;
        quantity: number;
        amountMinor: number;
      }
    >();
    const byCategory = new Map<
      string,
      { name: string; quantity: number; amountMinor: number }
    >();
    for (const o of selected) {
      const tableKey = o.tableId ?? "none";
      const t = byTable.get(tableKey) ?? {
        tableId: o.tableId,
        name: o.tableNumber == null ? "Sin mesa" : `Mesa ${o.tableNumber}`,
        orderCount: 0,
        amountMinor: 0,
      };
      t.orderCount++;
      t.amountMinor += o.paidMinor;
      byTable.set(tableKey, t);
      const waiterKey = o.waiterUserId ?? "none";
      const w = byWaiter.get(waiterKey) ?? {
        waiterUserId: o.waiterUserId,
        name: o.waiterName ?? "Sin asignar",
        orderCount: 0,
        amountMinor: 0,
      };
      w.orderCount++;
      w.amountMinor += o.paidMinor;
      byWaiter.set(waiterKey, w);
      const ty = byType.get(o.type) ?? {
        type: o.type,
        orderCount: 0,
        amountMinor: 0,
      };
      ty.orderCount++;
      ty.amountMinor += o.paidMinor;
      byType.set(o.type, ty);
      for (const p of o.payments.filter(
        (p) => o.cashSessionPaidId === session.id,
      )) {
        const x = byPayment.get(p.methodCode) ?? {
          code: p.methodCode,
          name: p.methodName,
          amountMinor: 0,
        };
        x.amountMinor += p.amountMinor - p.refundedMinor;
        byPayment.set(p.methodCode, x);
      }
      for (const i of o.items) {
        const name = i.productNameSnapshot;
        const x = byProduct.get(i.productId ?? name) ?? {
          productId: i.productId,
          name,
          quantity: 0,
          amountMinor: 0,
        };
        x.quantity += i.quantity;
        x.amountMinor += Math.round(
          (i.lineTotalMinor * o.paidMinor) / Math.max(o.totalMinor, 1),
        );
        byProduct.set(i.productId ?? name, x);
        const catRow = this.db
          .prepare(
            "SELECT category_name_snapshot FROM order_items WHERE id = ?",
          )
          .get(i.id) as Row | undefined;
        const cat = String(catRow?.category_name_snapshot ?? "Sin categoría");
        const c = byCategory.get(cat) ?? {
          name: cat,
          quantity: 0,
          amountMinor: 0,
        };
        c.quantity += i.quantity;
        c.amountMinor += Math.round(
          (i.lineTotalMinor * o.paidMinor) / Math.max(o.totalMinor, 1),
        );
        byCategory.set(cat, c);
      }
    }
    const movements = (
      this.db
        .prepare(
          `SELECT cm.*, pm.code AS payment_method_code FROM cash_movements cm LEFT JOIN payment_methods pm ON pm.id = cm.payment_method_id WHERE cm.cash_session_id = ? ORDER BY cm.created_at`,
        )
        .all(session.id) as Row[]
    ).map((m) => ({
      id: String(m.id),
      type: String(m.type) as CashMovementType,
      amountMinor: Number(m.amount_minor),
      affectsCash: flag(m.affects_cash),
      paymentMethodCode:
        m.payment_method_code == null ? null : String(m.payment_method_code),
      orderId: m.order_id == null ? null : String(m.order_id),
      userId: String(m.user_id),
      reason: m.reason == null ? null : String(m.reason),
      createdAt: String(m.created_at),
    }));
    return {
      session,
      detailAvailable,
      retentionCutoff,
      totals: {
        salesMinor: total,
        orderCount: selected.length,
        averageTicketMinor: selected.length
          ? Math.round(total / selected.length)
          : 0,
        discountsMinor: selected.reduce((n, o) => n + o.discountMinor, 0),
        refundsMinor: refunds,
      },
      byTable: detailAvailable ? [...byTable.values()] : [],
      byWaiter: detailAvailable ? [...byWaiter.values()] : [],
      byProduct: detailAvailable ? [...byProduct.values()] : [],
      byCategory: detailAvailable ? [...byCategory.values()] : [],
      byType: detailAvailable ? [...byType.values()] : [],
      byPaymentMethod: detailAvailable ? [...byPayment.values()] : [],
      orders: detailAvailable ? allOrders.filter(matches) : [],
      movements: detailAvailable ? movements : [],
      filters: effectiveFilters,
    };
  }
  getDetailedReport(filters: ReportFilters): DetailedReportDto {
    const params = [filters.dateFrom, filters.dateTo];
    const baseOrders = `FROM orders o JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id, o.cash_session_created_id)
      WHERE cs.business_date BETWEEN ? AND ? AND o.operational_status <> 'CANCELLED' AND o.paid_minor > 0`;
    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS order_count, COALESCE(SUM(o.paid_minor),0) AS total ${baseOrders}`,
      )
      .get(...params) as Row;
    const byType = this.db
      .prepare(
        `SELECT o.type, COUNT(*) AS order_count, COALESCE(SUM(o.paid_minor),0) AS amount_minor ${baseOrders} GROUP BY o.type ORDER BY o.type`,
      )
      .all(...params) as Row[];
    const byPaymentMethod = this.db
      .prepare(
        `SELECT pm.code, pm.name,
          COALESCE(SUM(p.amount_minor - COALESCE(refunds.refunded_minor, 0)),0) AS amount_minor
      FROM payments p JOIN payment_methods pm ON pm.id = p.payment_method_id
      JOIN cash_sessions cs ON cs.id = p.cash_session_id
      LEFT JOIN (
        SELECT payment_id, SUM(amount_minor) AS refunded_minor
        FROM payment_refunds GROUP BY payment_id
      ) refunds ON refunds.payment_id = p.id
      WHERE cs.business_date BETWEEN ? AND ?
      GROUP BY pm.id ORDER BY pm.sort_order`,
      )
      .all(...params) as Row[];
    const byProduct = this.db
      .prepare(
        `SELECT name, ROUND(SUM(quantity),2) AS quantity, ROUND(SUM(amount_minor)) AS amount_minor FROM (
      SELECT oi.product_name_snapshot AS name, oi.quantity AS quantity,
        (oi.unit_price_minor_snapshot * oi.quantity + COALESCE((SELECT SUM(m.unit_price_minor_snapshot) FROM order_item_modifiers m WHERE m.order_item_id = oi.id),0) * oi.quantity - oi.discount_minor_snapshot)
          * o.paid_minor / NULLIF(o.total_minor, 0) AS amount_minor
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id,o.cash_session_created_id)
      WHERE cs.business_date BETWEEN ? AND ? AND o.operational_status <> 'CANCELLED' AND o.paid_minor > 0 AND oi.product_id IS NOT NULL
      UNION ALL
      SELECT h.product_name_snapshot AS name, oi.quantity * 0.5 AS quantity,
        h.price_minor_snapshot * oi.quantity * 0.5 * o.paid_minor / NULLIF(o.total_minor, 0) AS amount_minor
      FROM order_item_halves h JOIN order_items oi ON oi.id = h.order_item_id JOIN orders o ON o.id = oi.order_id
      JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id,o.cash_session_created_id)
      WHERE cs.business_date BETWEEN ? AND ? AND o.operational_status <> 'CANCELLED' AND o.paid_minor > 0
    ) GROUP BY name ORDER BY quantity DESC, amount_minor DESC LIMIT 50`,
      )
      .all(...params, ...params) as Row[];
    const byCategory = this.db
      .prepare(
        `SELECT COALESCE(oi.category_name_snapshot,'Sin categoría') AS name,
      ROUND(SUM(oi.quantity),2) AS quantity, COALESCE(SUM((oi.unit_price_minor_snapshot * oi.quantity +
        COALESCE((SELECT SUM(m.unit_price_minor_snapshot) FROM order_item_modifiers m WHERE m.order_item_id = oi.id),0) * oi.quantity - oi.discount_minor_snapshot)
        * o.paid_minor / NULLIF(o.total_minor, 0)),0) AS amount_minor
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id,o.cash_session_created_id)
      WHERE cs.business_date BETWEEN ? AND ? AND o.operational_status <> 'CANCELLED' AND o.paid_minor > 0
      GROUP BY COALESCE(oi.category_name_snapshot,'Sin categoría') ORDER BY amount_minor DESC`,
      )
      .all(...params) as Row[];
    const byHour = this.db
      .prepare(
        `SELECT CAST(strftime('%H', o.created_at, 'localtime') AS INTEGER) AS hour,
      COUNT(*) AS order_count, COALESCE(SUM(o.paid_minor),0) AS amount_minor ${baseOrders} GROUP BY hour ORDER BY hour`,
      )
      .all(...params) as Row[];
    const byWaiter = this.db
      .prepare(
        `SELECT COALESCE(u.full_name,'Sin asignar') AS name, COUNT(*) AS order_count,
      COALESCE(SUM(o.paid_minor),0) AS amount_minor ${baseOrders.replace("WHERE", "LEFT JOIN users u ON u.id = o.waiter_user_id WHERE")}
      GROUP BY COALESCE(u.full_name,'Sin asignar') ORDER BY amount_minor DESC`,
      )
      .all(...params) as Row[];
    const cashSessions = this.db
      .prepare(
        `SELECT COALESCE(SUM(opening_amount_minor),0) AS opening_minor,
      COALESCE(SUM(difference_minor),0) AS differences_minor FROM cash_sessions WHERE business_date BETWEEN ? AND ?`,
      )
      .get(...params) as Row;
    const movements = this.db
      .prepare(
        `SELECT
      COALESCE(SUM(CASE WHEN cm.type='INCOME' THEN cm.amount_minor ELSE 0 END),0) AS income_minor,
      COALESCE(SUM(CASE WHEN cm.type='EXPENSE' THEN cm.amount_minor ELSE 0 END),0) AS expense_minor,
      COALESCE(SUM(CASE WHEN cm.type='WITHDRAWAL' THEN cm.amount_minor ELSE 0 END),0) AS withdrawal_minor,
      COALESCE(SUM(CASE WHEN cm.type='REFUND' AND cm.affects_cash=1 THEN cm.amount_minor ELSE 0 END),0) AS refund_minor
      FROM cash_movements cm JOIN cash_sessions cs ON cs.id = cm.cash_session_id WHERE cs.business_date BETWEEN ? AND ?`,
      )
      .get(...params) as Row;
    const delivery = this.db
      .prepare(
        `SELECT COUNT(*) AS order_count, COALESCE(SUM(o.delivery_fee_minor),0) AS fees_minor,
      COALESCE(SUM(CASE WHEN dl.status='PENDING' AND dl.direction='DRIVER_OWES_BUSINESS' THEN dl.amount_due_minor ELSE 0 END),0) AS pending_driver_owes_minor,
      COALESCE(SUM(CASE WHEN dl.status='PENDING' AND dl.direction='BUSINESS_OWES_DRIVER' THEN dl.amount_due_minor ELSE 0 END),0) AS pending_business_owes_minor
      FROM orders o JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id,o.cash_session_created_id)
      LEFT JOIN delivery_ledger dl ON dl.order_id = o.id WHERE cs.business_date BETWEEN ? AND ? AND o.type='DELIVERY' AND o.operational_status <> 'CANCELLED' AND o.payment_status = 'PAID'`,
      )
      .get(...params) as Row;
    const total = Number(summary.total);
    const orderCount = Number(summary.order_count);
    return {
      filters,
      salesTotalMinor: total,
      orderCount,
      averageTicketMinor: orderCount ? Math.round(total / orderCount) : 0,
      byType: byType.map((row) => ({
        type: String(row.type) as OrderDto["type"],
        amountMinor: Number(row.amount_minor),
        orderCount: Number(row.order_count),
      })),
      byPaymentMethod: byPaymentMethod.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        amountMinor: Number(row.amount_minor),
      })),
      byProduct: byProduct.map((row) => ({
        name: String(row.name),
        quantity: Number(row.quantity),
        amountMinor: Number(row.amount_minor),
      })),
      byCategory: byCategory.map((row) => ({
        name: String(row.name),
        quantity: Number(row.quantity),
        amountMinor: Number(row.amount_minor),
      })),
      byHour: byHour.map((row) => ({
        hour: Number(row.hour),
        orderCount: Number(row.order_count),
        amountMinor: Number(row.amount_minor),
      })),
      byWaiter: byWaiter.map((row) => ({
        name: String(row.name),
        orderCount: Number(row.order_count),
        amountMinor: Number(row.amount_minor),
      })),
      cash: {
        openingMinor: Number(cashSessions.opening_minor),
        incomeMinor: Number(movements.income_minor),
        expenseMinor: Number(movements.expense_minor),
        withdrawalMinor: Number(movements.withdrawal_minor),
        refundMinor: Number(movements.refund_minor),
        differencesMinor: Number(cashSessions.differences_minor),
      },
      delivery: {
        orderCount: Number(delivery.order_count),
        feesMinor: Number(delivery.fees_minor),
        pendingDriverOwesMinor: Number(delivery.pending_driver_owes_minor),
        pendingBusinessOwesMinor: Number(delivery.pending_business_owes_minor),
      },
    };
  }

  getAuditLog(input: {
    dateFrom?: BusinessDate;
    dateTo?: BusinessDate;
    action?: string;
    limit?: number;
  }): AuditEntryDto[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (input.dateFrom) {
      where.push("a.business_date >= ?");
      params.push(input.dateFrom);
    }
    if (input.dateTo) {
      where.push("a.business_date <= ?");
      params.push(input.dateTo);
    }
    if (input.action?.trim()) {
      where.push("a.action = ?");
      params.push(input.action.trim());
    }
    params.push(Math.min(Math.max(input.limit ?? 200, 1), 1000));
    const rows = this.db
      .prepare(
        `SELECT a.*, operator.full_name AS operator_name, authorizer.full_name AS authorizer_name
      FROM audit_log a LEFT JOIN users operator ON operator.id = a.operator_user_id
      LEFT JOIN users authorizer ON authorizer.id = a.authorizer_user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.timestamp DESC LIMIT ?`,
      )
      .all(...params) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      timestamp: String(row.timestamp),
      businessDate:
        row.business_date == null ? null : String(row.business_date),
      operatorName:
        row.operator_name == null ? null : String(row.operator_name),
      authorizerName:
        row.authorizer_name == null ? null : String(row.authorizer_name),
      permissionUsed:
        row.permission_used == null ? null : String(row.permission_used),
      entityType: String(row.entity_type),
      entityId: String(row.entity_id),
      action: String(row.action),
      reason: row.reason == null ? null : String(row.reason),
      beforeJson: row.before_json == null ? null : String(row.before_json),
      afterJson: row.after_json == null ? null : String(row.after_json),
    }));
  }

  saveSettings(settings: AppSettingsDto): AppSettingsDto {
    assertAppSettings(settings);
    const run = this.db.transaction(() => {
      const before = this.getSettings();
      this.db
        .prepare(
          "UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'app'",
        )
        .run(json(settings), nowIso());
      this.audit({
        entityType: "SETTINGS",
        entityId: "app",
        action: "SETTINGS_UPDATED",
        permission: "settings.manage",
        before,
        after: settings,
      });
      this.event("Settings", "app", "SettingsUpdated", settings);
      return this.getSettings();
    });
    return run();
  }

  getDashboard(businessDate?: BusinessDate): DashboardSummaryDto {
    const selectedDate =
      businessDate ??
      String(
        (
          this.db
            .prepare(
              "SELECT business_date FROM cash_sessions ORDER BY opened_at DESC LIMIT 1",
            )
            .get() as Row | undefined
        )?.business_date ?? businessDateFromOpening(nowIso()),
      );
    const orders = this.db
      .prepare(
        `SELECT o.* FROM orders o JOIN cash_sessions cs ON cs.id = COALESCE(o.cash_session_paid_id, o.cash_session_created_id)
         WHERE cs.business_date = ? AND o.lifecycle_status = 'CONFIRMED'
           AND o.operational_status <> 'CANCELLED' AND o.paid_minor > 0`,
      )
      .all(selectedDate) as Row[];
    const total = orders.reduce(
      (sum, order) => sum + Number(order.paid_minor),
      0,
    );
    const byType = {
      DINE_IN: 0,
      TAKEAWAY: 0,
      DELIVERY: 0,
    } as DashboardSummaryDto["byType"];
    for (const order of orders)
      byType[String(order.type) as keyof typeof byType] += Number(
        order.paid_minor,
      );
    const payments = this.db
      .prepare(
        `SELECT pm.code, pm.name,
          COALESCE(SUM(CASE WHEN cs.business_date = ?
            THEN p.amount_minor - COALESCE(refunds.refunded_minor, 0)
            ELSE 0 END), 0) AS amount_minor
         FROM payment_methods pm
         LEFT JOIN payments p ON p.payment_method_id = pm.id
         LEFT JOIN cash_sessions cs ON cs.id = p.cash_session_id
         LEFT JOIN (
           SELECT payment_id, SUM(amount_minor) AS refunded_minor
           FROM payment_refunds GROUP BY payment_id
         ) refunds ON refunds.payment_id = p.id
         WHERE pm.active = 1 GROUP BY pm.id ORDER BY pm.sort_order`,
      )
      .all(selectedDate) as Row[];
    return {
      orderCount: orders.length,
      openOrderCount: orders.filter(
        (order) =>
          !["DELIVERED", "CANCELLED"].includes(
            String(order.operational_status),
          ),
      ).length,
      salesTotalMinor: total,
      averageTicketMinor: orders.length ? Math.round(total / orders.length) : 0,
      byType,
      byPaymentMethod: payments.map((payment) => ({
        code: String(payment.code),
        name: String(payment.name),
        amountMinor: Number(payment.amount_minor),
      })),
    };
  }
}
