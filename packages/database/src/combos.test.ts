import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteGastronomyRepository } from "./sqlite-repository";

test("createCombo atomically creates prices and definition, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-create-combo-"));
  const repo = new SqliteGastronomyRepository(join(dir, "test.sqlite"), {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    const input = {
      categoryId: "category-1",
      name: "Combo atómico",
      prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
        priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
        amountMinor: 12500,
      })),
      definition: { slots: [{ id: "main", name: "Principal", quantity: 1, productIds: ["starter-muzza-grande"] }] },
      reason: "Alta combo",
      authorizerPin: "2468",
      idempotencyKey: "create-combo-once",
    };
    const created = repo.createCombo(input);
    assert.deepEqual(created.comboDefinition, input.definition);
    assert.equal(created.prices.find((price) => price.priceListCode === "SALON")?.amountMinor, 12500);
    assert.deepEqual(repo.createCombo(input), created);
    assert.equal(repo.bootstrap().products.filter((product) => product.name === input.name).length, 1);

    assert.throws(() => repo.createCombo({ ...input, idempotencyKey: "bad-definition", definition: { slots: [{ id: "bad", name: "Mala", quantity: 1, productIds: ["missing-product"] }] } }));
    assert.throws(() => repo.createCombo({ ...input, idempotencyKey: "bad-pin", authorizerPin: "0000" }), /PIN incorrecto/i);
    assert.equal(repo.bootstrap().products.some((product) => product.name === input.name && product.id !== created.id), false);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combo configuration and item preserve component snapshots and calculate the configured price", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-combo-"));
  const repo = new SqliteGastronomyRepository(join(dir, "test.sqlite"), {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    repo.openCashSession({ openingAmountMinor: 0 });
    repo.saveSettings({ ...repo.bootstrap().settings, stockEnabled: true });
    const combo = repo.createProduct({
      categoryId: "category-1",
      name: "Combo de prueba",
      prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
        priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
        amountMinor: 10000,
      })),
    });
    assert.equal(
      Number(
        (
          repo.db
            .prepare("SELECT MAX(version) AS version FROM schema_migrations")
            .get() as { version: number }
        ).version,
      ),
      40,
    );
    const definition = {
      slots: [
        {
          id: "main",
          name: "Principal",
          quantity: 2,
          productIds: ["starter-muzza-grande"],
        },
      ],
    };
    const componentName = repo
      .bootstrap()
      .products.find((product) => product.id === "starter-muzza-grande")!.name;
    repo.configureProductCombo({
      productId: combo.id,
      definition,
      reason: "Alta combo",
      authorizerPin: "2468",
      idempotencyKey: "configure-key",
    });
    const order = repo.createOrder({ type: "TAKEAWAY" });
    const addInput = {
      orderId: order.id,
      comboProductId: combo.id,
      selections: [{ slotId: "main", productId: "starter-muzza-grande" }],
      idempotencyKey: "combo-add",
    };
    const added = repo.addComboItem(addInput);
    assert.equal(added.items[0]!.unitPriceMinorSnapshot, 10000);
    assert.equal(added.items[0]!.comboComponents?.[0]?.quantity, 2);
    repo.db
      .prepare("UPDATE products SET name='renamed' WHERE id=?")
      .run("starter-muzza-grande");
    assert.equal(
      repo.getOrder(order.id).items[0]!.comboComponents?.[0]?.nameSnapshot,
      componentName,
    );
    assert.deepEqual(repo.addComboItem(addInput), added);
    const beforeUnsafe = repo.getOrder(order.id);
    repo.db
      .prepare(
        "UPDATE product_prices SET amount_minor=100000000000000 WHERE product_id=?",
      )
      .run(combo.id);
    assert.throws(
      () =>
        repo.addComboItem({
          ...addInput,
          idempotencyKey: "unsafe-line",
          quantity: 99,
        }),
      /rango seguro/,
    );
    assert.throws(
      () =>
        repo.updateOrderItemQuantity({
          orderId: order.id,
          itemId: added.items[0]!.id,
          quantity: Number.MAX_SAFE_INTEGER,
        }),
      /rango seguro/,
    );
    assert.deepEqual(repo.getOrder(order.id), beforeUnsafe);
    assert.throws(
      () => repo.addOrderItem({ orderId: order.id, productId: combo.id }),
      /addComboItem/,
    );
    const role = repo.db
      .prepare("SELECT role_id FROM users WHERE id=?")
      .get(repo.bootstrap().currentUser.id) as { role_id: string };
    repo.db
      .prepare(
        "DELETE FROM role_permissions WHERE role_id=? AND permission_code='orders.edit'",
      )
      .run(role.role_id);
    assert.throws(() => repo.addComboItem(addInput), /permiso/i);
    repo.db
      .prepare(
        "DELETE FROM role_permissions WHERE role_id=? AND permission_code='prices.bulk_update'",
      )
      .run(role.role_id);
    assert.throws(
      () =>
        repo.configureProductCombo({
          productId: combo.id,
          definition,
          reason: "Alta combo",
          authorizerPin: "2468",
          idempotencyKey: "configure-key",
        }),
      /PIN incorrecto|permiso/i,
    );
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("combo stock follows component quantity through confirm, add, quantity, remove and cancel; extras and COGS are snapshotted", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-combo-stock-"));
  const repo = new SqliteGastronomyRepository(join(dir, "test.sqlite"), {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    repo.openCashSession({ openingAmountMinor: 0 });
    repo.saveSettings({ ...repo.bootstrap().settings, stockEnabled: true });
    const combo = repo.createProduct({
      categoryId: "category-1",
      name: "Combo stock",
      prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
        priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
        amountMinor: 10000,
      })),
    });
    const componentId = "starter-muzza-grande";
    const componentName = repo
      .bootstrap()
      .products.find((product) => product.id === componentId)!.name;
    repo.db
      .prepare("UPDATE products SET stock_minor=10000 WHERE id=?")
      .run(componentId);
    repo.setFinanceProductCost({ productId: componentId, unitCostMinor: 700 });
    const extra = repo.createModifier({
      groupName: "Global Extras",
      name: "Extra global",
      priceMinor: 2000,
    });
    const definition = {
      slots: [
        {
          id: "main",
          name: "Principal",
          quantity: 2,
          productIds: [componentId],
        },
      ],
    };
    repo.configureProductCombo({
      productId: combo.id,
      definition,
      reason: "Config stock",
      authorizerPin: "2468",
    });
    const order = repo.createOrder({
      type: "DINE_IN",
      tableId: repo.ensureTable(1).id,
    });
    const draft = repo.addComboItem({
      orderId: order.id,
      comboProductId: combo.id,
      selections: [
        { slotId: "main", productId: componentId, modifierIds: [extra.id] },
      ],
    });
    assert.equal(draft.items[0]!.unitPriceMinorSnapshot, 14000);
    const confirmed = repo.confirmOrder({ orderId: order.id });
    assert.equal(
      Number(
        (
          repo.db
            .prepare("SELECT stock_minor FROM products WHERE id=?")
            .get(componentId) as { stock_minor: number }
        ).stock_minor,
      ),
      8000,
    );
    assert.equal(
      Number(
        (
          repo.db
            .prepare(
              "SELECT unit_cost_minor FROM finance_order_item_costs WHERE order_item_id=?",
            )
            .get(confirmed.items[0]!.id) as { unit_cost_minor: number }
        ).unit_cost_minor,
      ),
      1400,
    );
    const second = repo.addComboItem({
      orderId: order.id,
      comboProductId: combo.id,
      selections: [{ slotId: "main", productId: componentId }],
    });
    const firstId = draft.items[0]!.id;
    repo.updateOrderItemQuantity({
      orderId: order.id,
      itemId: firstId,
      quantity: 2,
    });
    assert.equal(
      Number(
        (
          repo.db
            .prepare("SELECT stock_minor FROM products WHERE id=?")
            .get(componentId) as { stock_minor: number }
        ).stock_minor,
      ),
      4000,
    );
    repo.updateOrderItemQuantity({
      orderId: order.id,
      itemId: firstId,
      quantity: 1,
    });
    repo.removeOrderItem(order.id, firstId);
    assert.equal(
      Number(
        (
          repo.db
            .prepare("SELECT stock_minor FROM products WHERE id=?")
            .get(componentId) as { stock_minor: number }
        ).stock_minor,
      ),
      8000,
    );
    repo.cancelOrder({
      orderId: order.id,
      reason: "Cancel test",
      authorizerPin: "2468",
    });
    assert.equal(
      Number(
        (
          repo.db
            .prepare("SELECT stock_minor FROM products WHERE id=?")
            .get(componentId) as { stock_minor: number }
        ).stock_minor,
      ),
      10000,
    );
    repo.configureProductCombo({
      productId: combo.id,
      definition: null,
      reason: "Desactivar",
      authorizerPin: "2468",
    });
    assert.equal(
      repo
        .getOrder(order.id)
        .items.find((i) => i.id === second.items.at(-1)!.id)
        ?.comboComponents?.[0]?.nameSnapshot,
      componentName,
    );
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("insufficient component stock rolls back confirmation and nested/half-and-half combo routes are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "gastronomy-combo-rollback-"));
  const repo = new SqliteGastronomyRepository(join(dir, "test.sqlite"), {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    repo.openCashSession({ openingAmountMinor: 0 });
    repo.saveSettings({ ...repo.bootstrap().settings, stockEnabled: true });
    const createCombo = (name: string) =>
      repo.createProduct({
        categoryId: "category-1",
        name,
        prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
          priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
          amountMinor: 5000,
        })),
      });
    const combo = createCombo("No nested");
    const nested = createCombo("Nested attempt");
    const definition = {
      slots: [
        {
          id: "main",
          name: "Principal",
          quantity: 2,
          productIds: ["starter-muzza-grande"],
        },
      ],
    };
    repo.configureProductCombo({
      productId: combo.id,
      definition,
      reason: "Config",
      authorizerPin: "2468",
    });
    assert.throws(
      () =>
        repo.adjustStock({
          productId: combo.id,
          newStockMinor: 4000,
          reason: "no parent stock",
          authorizerPin: "2468",
        }),
      /no puede tener stock propio/i,
    );
    assert.throws(
      () =>
        repo.createPurchase({
          supplierName: "Proveedor",
          items: [
            { productId: combo.id, quantityMinor: 1000, unitCostMinor: 100 },
          ],
          authorizerPin: "2468",
        }),
      /compra de los componentes/,
    );
    assert.throws(
      () =>
        repo.configureProductCombo({
          productId: nested.id,
          definition: {
            slots: [
              {
                id: "inner",
                name: "Interior",
                quantity: 1,
                productIds: [combo.id],
              },
            ],
          },
          reason: "No",
          authorizerPin: "2468",
        }),
      /no se permiten combos anidados/i,
    );
    const order = repo.createOrder({
      type: "DINE_IN",
      tableId: repo.ensureTable(1).id,
    });
    assert.throws(
      () =>
        repo.addHalfAndHalfItem({
          orderId: order.id,
          firstProductId: combo.id,
          secondProductId: "starter-muzza-grande",
        }),
      /combos no pueden/i,
    );
    repo.db
      .prepare(
        "UPDATE products SET stock_minor=1000 WHERE id='starter-muzza-grande'",
      )
      .run();
    repo.addComboItem({
      orderId: order.id,
      comboProductId: combo.id,
      selections: [{ slotId: "main", productId: "starter-muzza-grande" }],
    });
    repo.db
      .prepare("UPDATE products SET active=0 WHERE id='starter-muzza-grande'")
      .run();
    assert.throws(
      () =>
        repo.addComboItem({
          orderId: order.id,
          comboProductId: combo.id,
          selections: [{ slotId: "main", productId: "starter-muzza-grande" }],
        }),
      /activos/i,
    );
    repo.db
      .prepare("UPDATE products SET active=1 WHERE id='starter-muzza-grande'")
      .run();
    assert.throws(
      () => repo.confirmOrder({ orderId: order.id }),
      /stock insuficiente/i,
    );
    assert.equal(repo.getOrder(order.id).lifecycleStatus, "DRAFT");
    assert.equal(
      Number(
        (
          repo.db
            .prepare(
              "SELECT stock_minor FROM products WHERE id='starter-muzza-grande'",
            )
            .get() as { stock_minor: number }
        ).stock_minor,
      ),
      1000,
    );
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
