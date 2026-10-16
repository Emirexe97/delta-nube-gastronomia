import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SqliteGastronomyRepository } from "./sqlite-repository";

function fixture(run: (repo: SqliteGastronomyRepository) => void) {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-repeat-"));
  const repo = new SqliteGastronomyRepository(join(dir, "test.sqlite"), {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    run(repo);
  } finally {
    repo.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("gastronomy-repeat-"));
    rmSync(dir, { recursive: true, force: true });
  }
}

function seed(repo: SqliteGastronomyRepository) {
  repo.openCashSession({ openingAmountMinor: 0 });
  const customer = repo.createCustomer({
    name: "Antes",
    phone: "1155000707",
    addresses: [
      { label: "Casa", address: "Dirección actual", deliveryFeeMinor: 50000 },
    ],
  });
  const draft = repo.createOrder({
    type: "TAKEAWAY",
    customerId: customer.id,
    notes: "NO COPIAR",
    scheduled: true,
    promisedAt: "2030-01-01T15:00:00Z",
  });
  repo.addOrderItem({
    orderId: draft.id,
    productId: "starter-gaseosa",
    quantity: 2,
  });
  const extra = repo.createModifier({
    groupName: "Extras",
    name: "Extra vigente",
    priceMinor: 1000,
  });
  repo.addOrderItemModifier({
    orderId: draft.id,
    itemId: repo.getOrder(draft.id).items[0]!.id,
    modifierId: extra.id,
    scope: "FULL_PIZZA",
  });
  const source = repo.confirmOrder({ orderId: draft.id });
  return {
    customer,
    source,
    extra,
    input: {
      sourceOrderId: source.id,
      customerId: customer.id,
      type: "TAKEAWAY" as const,
      idempotencyKey: "repeat-test",
    },
  };
}

test("repeat uses current prices/extras/customer and creates one fresh unpaid draft, with stable replay", () =>
  fixture((repo) => {
    const { customer, source, extra, input } = seed(repo);
    repo.db
      .prepare("UPDATE customers SET name='Ahora' WHERE id=?")
      .run(customer.id);
    repo.db
      .prepare(
        "UPDATE product_prices SET amount_minor=10000 WHERE product_id=?",
      )
      .run("starter-gaseosa");
    repo.db
      .prepare("UPDATE modifiers SET price_minor=2000 WHERE id=?")
      .run(extra.id);
    const before = repo.getOrder(source.id);
    const products = repo.db
      .prepare("SELECT id,stock_minor FROM products ORDER BY id")
      .all();
    const result = repo.repeatOrder(input);
    assert.notEqual(result.id, source.id);
    assert.equal(result.lifecycleStatus, "DRAFT");
    assert.equal(result.paymentStatus, "UNPAID");
    assert.equal(result.operationalStatus, "PENDING");
    assert.equal(result.customerNameSnapshot, "Ahora");
    assert.equal(result.totalMinor, 24000);
    assert.equal(result.items[0]!.quantity, 2);
    assert.equal(result.items[0]!.unitPriceMinorSnapshot, 10000);
    assert.equal(result.items[0]!.modifiers[0]!.unitPriceMinorSnapshot, 2000);
    assert.equal(result.paidMinor, 0);
    assert.equal(result.discountMinor, 0);
    assert.equal(result.depositMinor, 0);
    assert.equal(result.deliveryFeeMinor, 0);
    assert.equal(result.tableId, null);
    assert.equal(result.driverUserId, null);
    assert.equal(result.promisedAt, null);
    assert.equal(result.scheduled, false);
    assert.equal(result.notes, null);
    assert.deepEqual(result.payments, []);
    assert.deepEqual(repo.getOrder(source.id), before);
    assert.deepEqual(
      repo.db.prepare("SELECT id,stock_minor FROM products ORDER BY id").all(),
      products,
    );
    assert.deepEqual(repo.repeatOrder(input), result);
    assert.throws(
      () => repo.repeatOrder({ ...input, type: "DELIVERY" }),
      /idempotencia|datos diferentes/i,
    );
  }));

test("repeat delivery resolves current saved address and fee without modifying the customer's address", () =>
  fixture((repo) => {
    const { customer, input } = seed(repo);
    const result = repo.repeatOrder({
      ...input,
      type: "DELIVERY",
      customerAddressId: customer.addresses[0]!.id,
    });
    assert.equal(result.deliveryAddressSnapshot, "Dirección actual");
    assert.equal(result.deliveryFeeMinor, 50000);
    assert.equal(result.driverUserId, null);
    assert.equal(
      repo.getCustomerProfile({ customerId: customer.id, page: 1, pageSize: 1 })
        .customer.addresses[0]!.deliveryFeeMinor,
      50000,
    );
  }));

test("repeat rejects missing current product/extra/address and leaves no orphan, events or receipt", () =>
  fixture((repo) => {
    const { input, extra } = seed(repo);
    const tables = [
      "orders",
      "order_items",
      "order_item_modifiers",
      "command_receipts",
      "audit_log",
    ];
    const snapshot = () =>
      Object.fromEntries(
        tables.map((table) => [
          table,
          repo.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    let before = snapshot();
    assert.throws(
      () =>
        repo.repeatOrder({
          ...input,
          type: "DELIVERY",
          customerAddressId: "stale",
        }),
      /dirección vigente/,
    );
    assert.deepEqual(snapshot(), before);
    repo.db.prepare("UPDATE modifiers SET active=0 WHERE id=?").run(extra.id);
    before = snapshot();
    assert.throws(() => repo.repeatOrder(input), /extra.*referencia vigente/i);
    assert.deepEqual(snapshot(), before);
    repo.db.prepare("UPDATE modifiers SET active=1 WHERE id=?").run(extra.id);
    repo.db
      .prepare("UPDATE products SET active=0 WHERE id=?")
      .run("starter-gaseosa");
    before = snapshot();
    assert.throws(() => repo.repeatOrder(input), /no está disponible/);
    assert.deepEqual(snapshot(), before);
  }));

test("repeat fails atomically on a later insertion error and rejects permission before receipt replay", () =>
  fixture((repo) => {
    const { input } = seed(repo);
    const count = () =>
      (repo.db.prepare("SELECT count(*) n FROM orders").get() as { n: number })
        .n;
    const before = count();
    repo.db.exec(
      "CREATE TEMP TRIGGER repeat_test_fail BEFORE INSERT ON order_item_modifiers BEGIN SELECT RAISE(ABORT, 'injected modifier failure'); END",
    );
    assert.throws(() => repo.repeatOrder(input), /injected modifier failure/);
    assert.equal(count(), before);
    repo.db.exec("DROP TRIGGER repeat_test_fail");
    repo.repeatOrder(input);
    repo.db
      .prepare(
        "DELETE FROM role_permissions WHERE permission_code='orders.create'",
      )
      .run();
    assert.throws(() => repo.repeatOrder(input), /permiso/);
  }));

test("repeat respects disabled halves and reconstructs current selections when reenabled", () =>
  fixture((repo) => {
    const { source, customer } = seed(repo);
    const fresh = repo.createOrder({
      type: "TAKEAWAY",
      customerId: customer.id,
    });
    repo.addHalfAndHalfItem({
      orderId: fresh.id,
      firstProductId: "starter-muzza-grande",
      secondProductId: "starter-napo-grande",
      quantity: 2,
    });
    repo.confirmOrder({ orderId: fresh.id });
    const settings = repo.bootstrap().settings;
    repo.saveSettings({ ...settings, halfAndHalfEnabled: false });
    const input = {
      sourceOrderId: fresh.id,
      customerId: customer.id,
      type: "TAKEAWAY" as const,
    };
    assert.throws(() => repo.repeatOrder(input), /deshabilitadas/);
    repo.saveSettings({
      ...settings,
      halfAndHalfEnabled: true,
      halfAndHalfPricingMode: "MOST_EXPENSIVE",
    });
    const repeated = repo.repeatOrder(input);
    assert.equal(repeated.items[0]!.halves.length, 2);
    assert.equal(repeated.totalMinor, 2 * 1800000);
    assert.equal(repo.getOrder(source.id).lifecycleStatus, "CONFIRMED");
  }));
