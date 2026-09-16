import { describe, expect, it } from "vitest";
import {
  createDemoApi,
  DEMO_STORAGE_KEY,
  resetDemoData,
  type DemoStorage,
} from "./demo-api";

class MemoryStorage implements DemoStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("API de demostración", () => {
  it("crea pedidos para retirar y clientes nuevos sin dirección", async () => {
    const api = createDemoApi(new MemoryStorage());
    const customer = await api.createCustomer({
      name: "Cliente sin domicilio",
      phone: "11 5555-0101",
      addresses: [],
    });
    expect(customer.addresses).toEqual([]);

    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: null,
    });
    expect(order.deliveryAddressSnapshot).toBeNull();
  });

  it("conserva cierres y expone informe filtrable por sesión", async () => {
    const api = createDemoApi(new MemoryStorage());
    const current = (await api.bootstrap()).cashSession!;
    const report = await api.getCashSessionReport({
      cashSessionId: current.id,
      orderType: "DELIVERY",
    });
    expect(report).toMatchObject({
      session: { id: current.id },
      detailAvailable: true,
      filters: { cashSessionId: current.id, orderType: "DELIVERY" },
    });
    const fullReport = await api.getCashSessionReport({
      cashSessionId: current.id,
    });
    expect(fullReport.byWaiter.length).toBeGreaterThan(0);
    expect(Array.isArray(fullReport.byWaiter[0]!.tables)).toBe(true);
    await api.closeCashSession({
      countedAmountMinor: current.expectedAmountMinor,
      force: true,
      reason: "Cierre demo",
      authorizerPin: "1234",
    });
    expect(
      (await api.listCashSessionHistory()).some(
        (item) => item.session.id === current.id,
      ),
    ).toBe(true);
    expect((await api.bootstrap()).orders).toEqual([]);
    await api.openCashSession({ openingAmountMinor: 0 });
    expect((await api.bootstrap()).orders).toEqual([]);
  });

  it("audita sólo acciones sensibles y no altas operativas", async () => {
    const api = createDemoApi(new MemoryStorage());
    await api.ensureTable({ number: 51 });
    await api.createCustomer({
      name: "Cliente operativo",
      phone: "11 5555-5151",
    });
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente pedido",
      customerPhone: "11 5555-5252",
      deliveryAddress: "Calle Prueba 5252",
    });
    const populated = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
    });
    await api.removeOrderItem({
      orderId: order.id,
      itemId: populated.items[0]!.id,
    });

    const audit = await api.getAuditLog({ limit: 200 });
    expect(audit.map((entry) => entry.action)).toContain("PRODUCTO_QUITADO");
    expect(audit.map((entry) => entry.action)).not.toContain("MESA_CREADA");
    expect(audit.map((entry) => entry.action)).not.toContain(
      "CUSTOMER_CREATED",
    );
    expect(audit.map((entry) => entry.action)).not.toContain("PEDIDO_CREADO");
  });

  it("mantiene resumen de cajas antiguas sin detalle", async () => {
    const api = createDemoApi(new MemoryStorage());
    const old = (await api.listCashSessionHistory()).find(
      (item) => item.session.id === "cash-demo-old",
    )!;
    expect(old.detailAvailable).toBe(false);
    const report = await api.getCashSessionReport({
      cashSessionId: old.session.id,
      productId: "inexistente",
    });
    expect(report).toMatchObject({
      detailAvailable: false,
      orders: [],
      movements: [],
      totals: { salesMinor: 8_000_000 },
    });
  });

  it("elimina mesa libre, conserva id al reactivar y permite repetir", async () => {
    const api = createDemoApi(new MemoryStorage());
    const table = await api.ensureTable({ number: 51 });
    await expect(api.deleteTable({ tableId: table.id })).resolves.toEqual({
      deleted: true,
    });
    const again = await api.ensureTable({ number: 51 });
    expect(again.id).toBe(table.id);
    await expect(api.deleteTable({ tableId: table.id })).resolves.toEqual({
      deleted: true,
    });
  });

  it("crea sectores y persiste el plano editable de mesas", async () => {
    const api = createDemoApi(new MemoryStorage());
    const terrace = await api.createTableSector({ name: "Patio" });
    const table = await api.ensureTable({ number: 81 });
    const updated = await api.updateTable({
      tableId: table.id,
      number: table.number,
      name: "Ventana",
      active: true,
      sectorId: terrace.id,
      layoutX: 22,
      layoutY: 31,
      layoutWidth: 23,
      layoutHeight: 12,
      shape: "RECTANGLE",
    });
    expect(updated).toMatchObject({
      sectorId: terrace.id,
      layoutX: 22,
      layoutY: 31,
      layoutWidth: 23,
      layoutHeight: 12,
      shape: "RECTANGLE",
    });
    await api.updateTableSector({ sectorId: terrace.id, name: "Galería" });
    const deleted = await api.deleteTableSector({ sectorId: terrace.id });
    expect(
      (await api.bootstrap()).tables.find((item) => item.id === table.id)
        ?.sectorId,
    ).toBe(deleted.fallbackSectorId);
    expect(
      (await api.getAuditLog({ limit: 200 })).map((entry) => entry.action),
    ).toContain("SECTOR_ELIMINADO");
  });

  it("crea, modifica y elimina figuras decorativas del plano", async () => {
    const api = createDemoApi(new MemoryStorage());
    const sector = (await api.bootstrap()).tableSectors[0]!;
    const created = await api.createFloorPlanShape({
      sectorId: sector.id,
      kind: "LINE",
      label: "Pared norte",
      color: "#64748B",
      layoutX: 5,
      layoutY: 8,
      layoutWidth: 45,
      layoutHeight: 3,
    });
    const updated = await api.updateFloorPlanShape({
      ...created,
      shapeId: created.id,
      kind: "RECTANGLE",
      label: "Barra",
      color: "#EA580C",
      layoutWidth: 32,
      layoutHeight: 10,
    });
    expect(updated).toMatchObject({
      kind: "RECTANGLE",
      label: "Barra",
      color: "#EA580C",
      layoutWidth: 32,
      layoutHeight: 10,
    });
    await api.deleteFloorPlanShape({ shapeId: created.id });
    expect((await api.bootstrap()).floorPlanShapes).toEqual([]);
  });

  it("persiste figuras vectoriales y valida la cantidad de nodos", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const sector = (await api.bootstrap()).tableSectors[0]!;
    const polygon = await api.createFloorPlanShape({
      sectorId: sector.id,
      kind: "POLYGON",
      label: "Área irregular",
      color: "#FDBA74",
      strokeColor: "#C2410C",
      strokeWidth: 3,
      fillOpacity: 0.4,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 10 },
        { x: 80, y: 100 },
      ],
      layoutX: 12,
      layoutY: 14,
      layoutWidth: 44,
      layoutHeight: 30,
    });
    expect(polygon).toMatchObject({
      kind: "POLYGON",
      strokeColor: "#C2410C",
      strokeWidth: 3,
      fillOpacity: 0.4,
    });
    await expect(createDemoApi(storage).bootstrap()).resolves.toMatchObject({
      floorPlanShapes: [
        expect.objectContaining({
          id: polygon.id,
          points: polygon.points,
        }),
      ],
    });
    await expect(
      api.createFloorPlanShape({
        sectorId: sector.id,
        kind: "POLYLINE",
        color: "#64748B",
        points: [{ x: 0, y: 0 }],
        layoutX: 5,
        layoutY: 5,
        layoutWidth: 20,
        layoutHeight: 20,
      }),
    ).rejects.toThrow("cantidad de nodos");
  });

  it("cancela pedido vacío y bloquea pedido con consumo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const table = await api.ensureTable({ number: 52 });
    const order = await api.createOrder({ type: "DINE_IN", tableId: table.id });
    await api.deleteTable({ tableId: table.id });
    expect(
      (await api.bootstrap()).orders.find((item) => item.id === order.id)
        ?.operationalStatus,
    ).toBe("CANCELLED");
    const occupied = await api.ensureTable({ number: 53 });
    const occupiedOrder = await api.createOrder({
      type: "DINE_IN",
      tableId: occupied.id,
    });
    await api.addOrderItem({
      orderId: occupiedOrder.id,
      productId: "prod-muzza",
    });
    await expect(api.deleteTable({ tableId: occupied.id })).rejects.toThrow(
      /consumo/,
    );
  });

  it("rechaza eliminación sin tables.manage", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const table = await api.ensureTable({ number: 54 });
    const persisted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    persisted.data.currentUser.permissions = ["orders.create", "orders.edit"];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(persisted));
    const restricted = createDemoApi(storage);
    await expect(restricted.deleteTable({ tableId: table.id })).rejects.toThrow(
      /permiso/,
    );
  });
  it("entrega un escenario inicial completo y en español", async () => {
    const api = createDemoApi(new MemoryStorage());
    const data = await api.bootstrap();

    expect(data.settings.businessName).toContain("Local demo");
    expect(data.tables).toHaveLength(12);
    expect(data.orders.some((order) => order.paymentStatus === "UNPAID")).toBe(
      true,
    );
    expect(data.currentUser.roleName).toBe("Administrador");
  });

  it("crea una mesa una sola vez y persiste al reconstruir la API", async () => {
    const storage = new MemoryStorage();
    const firstApi = createDemoApi(storage);
    const created = await firstApi.ensureTable({ number: 25 });
    const repeated = await firstApi.ensureTable({ number: 25 });
    const secondApi = createDemoApi(storage);

    expect(repeated.id).toBe(created.id);
    expect(
      (await secondApi.bootstrap()).tables.filter(
        (table) => table.number === 25,
      ),
    ).toHaveLength(1);
  });

  it("mantiene las mesas ordenadas por número al cargarlas fuera de secuencia", async () => {
    const api = createDemoApi(new MemoryStorage());
    await api.ensureTable({ number: 30 });
    await api.ensureTable({ number: 20 });

    const numbers = (await api.bootstrap()).tables.map((table) => table.number);
    expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
  });

  it("migra sólo el stock seed legado y conserva ajustes previos en milésimas", async () => {
    const storage = new MemoryStorage();
    const firstApi = createDemoApi(storage);
    const initial = await firstApi.bootstrap();
    await firstApi.saveSettings(initial.settings);
    const persisted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!) as {
      version: number;
      data: {
        products: Array<{ id: string; stockMinor: number | null }>;
      };
    };
    persisted.version = 5;
    persisted.data.products.find(
      (product) => product.id === "prod-muzza",
    )!.stockMinor = 35;
    persisted.data.products.find(
      (product) => product.id === "prod-napo",
    )!.stockMinor = 500;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(persisted));

    const migrated = await createDemoApi(storage).bootstrap();
    expect(
      migrated.products.find((product) => product.id === "prod-muzza")
        ?.stockMinor,
    ).toBe(35_000);
    expect(
      migrated.products.find((product) => product.id === "prod-napo")
        ?.stockMinor,
    ).toBe(500);
  });

  it("migra clientes demo v6 sin fecha y permite editarlos", async () => {
    const storage = new MemoryStorage();
    const firstApi = createDemoApi(storage);
    const initial = await firstApi.bootstrap();
    await firstApi.saveSettings(initial.settings);
    const persisted = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!) as {
      version: number;
      customers: Array<{ updatedAt?: string }>;
    };
    persisted.version = 6;
    delete persisted.customers[0]!.updatedAt;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(persisted));

    const migratedApi = createDemoApi(storage);
    const customer = (await migratedApi.searchCustomers("Ana"))[0]!;
    expect(customer.updatedAt).toBeTruthy();
    await expect(
      migratedApi.updateCustomer({
        customerId: customer.id,
        expectedUpdatedAt: customer.updatedAt,
        name: customer.name,
        phone: customer.phone,
        notes: customer.notes,
        addresses: customer.addresses,
      }),
    ).resolves.toMatchObject({ id: customer.id });
  });

  it("permite abrir un pedido, agregar productos y cobrarlo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const data = await api.bootstrap();
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-3",
      waiterUserId: "user-waiter",
    });
    const withItem = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
      quantity: 2,
    });
    await api.confirmOrder({ orderId: order.id });
    const paid = await api.payOrder({
      orderId: order.id,
      payments: [
        {
          methodCode: "CASH",
          amountMinor: withItem.totalMinor,
          receivedMinor: withItem.totalMinor,
        },
      ],
    });

    expect(data.cashSession).not.toBeNull();
    expect(withItem.totalMinor).toBe(3_000_000);
    expect(paid.paymentStatus).toBe("PAID");
    expect(
      (await api.bootstrap()).tables.find((table) => table.id === "table-3")
        ?.currentOrderId,
    ).toBe(order.id);
    const after = await api.bootstrap();
    expect(after.dashboard.orderCount).toBeGreaterThanOrEqual(1);
    expect(after.dashboard.byType.DINE_IN).toBeGreaterThanOrEqual(
      withItem.totalMinor,
    );
    expect(after.cashSession?.cashSalesMinor).toBeGreaterThanOrEqual(
      withItem.totalMinor,
    );
    expect(after.cashSession?.expectedAmountMinor).toBeGreaterThan(
      after.cashSession?.openingAmountMinor ?? 0,
    );
  });

  it("edita y quita la observación de comanda de un producto", async () => {
    const api = createDemoApi(new MemoryStorage());
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-3",
      waiterUserId: "user-waiter",
    });
    const populated = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
    });
    const itemId = populated.items[0]!.id;

    await expect(
      api.updateOrderItemNotes({
        orderId: order.id,
        itemId,
        notes: "  Sin queso · alergia  ",
      }),
    ).resolves.toMatchObject({
      items: [{ id: itemId, notes: "Sin queso · alergia" }],
    });
    await expect(
      api.updateOrderItemNotes({
        orderId: order.id,
        itemId,
        notes: "x".repeat(501),
      }),
    ).rejects.toThrow(/500 caracteres/);
    await expect(
      api.updateOrderItemNotes({ orderId: order.id, itemId, notes: "   " }),
    ).resolves.toMatchObject({ items: [{ id: itemId, notes: null }] });
  });

  it("registra cobro no efectivo en resumen sin aumentar efectivo esperado", async () => {
    const api = createDemoApi(new MemoryStorage());
    const before = await api.bootstrap();
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-4",
      waiterUserId: "user-waiter",
    });
    const withItem = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
      quantity: 1,
    });
    await api.confirmOrder({ orderId: order.id });
    await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: withItem.totalMinor }],
    });
    const after = await api.bootstrap();
    expect(after.dashboard.orderCount).toBe(before.dashboard.orderCount + 1);
    expect(after.dashboard.byType.DINE_IN).toBe(
      before.dashboard.byType.DINE_IN + withItem.totalMinor,
    );
    expect(after.cashSession?.expectedAmountMinor).toBe(
      before.cashSession?.expectedAmountMinor,
    );
    expect(after.cashSession?.cashSalesMinor).toBe(
      before.cashSession?.cashSalesMinor,
    );
  });

  it.each([
    ["DINE_IN", "CASH"],
    ["DINE_IN", "TRANSFER"],
    ["TAKEAWAY", "CASH"],
    ["TAKEAWAY", "TRANSFER"],
    ["DELIVERY", "CASH"],
    ["DELIVERY", "TRANSFER"],
  ] as const)(
    "refleja %s cobrado con %s en resumen y caja",
    async (type, methodCode) => {
      const api = createDemoApi(new MemoryStorage());
      const before = await api.bootstrap();
      const order = await api.createOrder({
        type,
        ...(type === "DINE_IN"
          ? { tableId: "table-3", waiterUserId: "user-waiter" }
          : {
              customerName: `Cliente ${type}`,
              customerPhone: "11 5555-0101",
              deliveryAddress: "Calle Matriz 123",
            }),
      });
      const populated = await api.addOrderItem({
        orderId: order.id,
        productId: "prod-muzza",
      });
      await api.confirmOrder({ orderId: order.id });
      await api.payOrder({
        orderId: order.id,
        payments: [
          {
            methodCode,
            amountMinor: populated.totalMinor,
            ...(methodCode === "CASH"
              ? { receivedMinor: populated.totalMinor }
              : {}),
          },
        ],
      });

      const after = await api.bootstrap();
      expect(after.dashboard.salesTotalMinor).toBe(
        before.dashboard.salesTotalMinor + populated.totalMinor,
      );
      expect(after.dashboard.byType[type]).toBe(
        before.dashboard.byType[type] + populated.totalMinor,
      );
      expect(
        after.dashboard.byPaymentMethod.find(
          (method) => method.code === methodCode,
        )?.amountMinor,
      ).toBe(
        (before.dashboard.byPaymentMethod.find(
          (method) => method.code === methodCode,
        )?.amountMinor ?? 0) + populated.totalMinor,
      );
      expect(after.cashSession?.salesTotalMinor).toBe(
        (before.cashSession?.salesTotalMinor ?? 0) + populated.totalMinor,
      );
      expect(after.cashSession?.salesByType?.[type]).toBe(
        (before.cashSession?.salesByType?.[type] ?? 0) + populated.totalMinor,
      );
      expect(
        after.cashSession?.salesByPaymentMethod?.find(
          (method) => method.code === methodCode,
        )?.amountMinor,
      ).toBe(
        (before.cashSession?.salesByPaymentMethod?.find(
          (method) => method.code === methodCode,
        )?.amountMinor ?? 0) + populated.totalMinor,
      );
      const expectedCashDelta =
        methodCode === "CASH" ? populated.totalMinor : 0;
      expect(after.cashSession?.expectedAmountMinor).toBe(
        (before.cashSession?.expectedAmountMinor ?? 0) + expectedCashDelta,
      );
      expect(after.cashSession?.cashSalesMinor).toBe(
        (before.cashSession?.cashSalesMinor ?? 0) + expectedCashDelta,
      );
    },
  );

  it("autoriza un precio manual por línea sin modificar el catálogo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-3",
      waiterUserId: "user-waiter",
    });
    const originalPrice = (await api.bootstrap()).products
      .find((product) => product.id === "prod-muzza")!
      .prices.find((price) => price.priceListCode === "SALON")!.amountMinor;

    await expect(
      api.addOrderItem({
        orderId: order.id,
        productId: "prod-muzza",
        unitPriceMinorOverride: 1_250_000,
        authorizerPin: "0000",
      }),
    ).rejects.toThrow("1234");
    const updated = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
      quantity: 2,
      unitPriceMinorOverride: 1_250_000,
      authorizerPin: "1234",
    });

    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]).toMatchObject({
      unitPriceMinorSnapshot: 1_250_000,
      lineTotalMinor: 2_500_000,
    });
    expect(
      (await api.bootstrap()).products
        .find((product) => product.id === "prod-muzza")!
        .prices.find((price) => price.priceListCode === "SALON")!.amountMinor,
    ).toBe(originalPrice);
  });

  it("edita datos del borrador y aprende el valor de envío por dirección", async () => {
    const api = createDemoApi(new MemoryStorage());
    const customer = await api.createCustomer({
      name: "Cliente con dos destinos",
      phone: "11 2222-8080",
      addresses: [
        {
          label: "Casa",
          address: "Centro 100",
          deliveryFeeMinor: 200_000,
        },
        {
          label: "Quinta",
          address: "Ruta 5 km 20",
          deliveryFeeMinor: 500_000,
        },
      ],
    });
    const draft = await api.createOrder({
      type: "DELIVERY",
      customerId: customer.id,
      customerAddressId: customer.addresses[0]!.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: customer.addresses[0]!.address,
      deliveryFeeMinor: 225_000,
    });
    const withItem = await api.addOrderItem({
      orderId: draft.id,
      productId: "prod-muzza",
    });
    const updated = await api.updateDraftOrder({
      orderId: draft.id,
      type: "DELIVERY",
      customerId: customer.id,
      customerAddressId: customer.addresses[1]!.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      deliveryAddress: customer.addresses[1]!.address,
      deliveryFeeMinor: 575_000,
      notes: "Portón lateral",
    });

    expect(updated.items).toHaveLength(withItem.items.length);
    expect(updated).toMatchObject({
      deliveryAddressSnapshot: "Ruta 5 km 20",
      deliveryFeeMinor: 575_000,
      notes: "Portón lateral",
    });
    expect(
      (await api.searchCustomers("Ruta 5"))[0]!.addresses[1],
    ).toMatchObject({ deliveryFeeMinor: 575_000 });
  });

  it("corrige datos de un pedido confirmado e impreso antes de cobrarlo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const draft = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente original",
      customerPhone: "11 4222-1000",
      deliveryAddress: "Calle Uno 100",
      deliveryFeeMinor: 200_000,
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: "prod-muzza",
    });
    await api.confirmOrder({ orderId: draft.id });
    await api.printOrder({ orderId: draft.id, kind: "KITCHEN_ORDER" });

    const updated = await api.updateDraftOrder({
      orderId: draft.id,
      type: "DELIVERY",
      customerName: "Cliente corregido",
      customerPhone: "11 4222-2000",
      deliveryAddress: "Calle Dos 200",
      deliveryFeeMinor: 350_000,
    });

    expect(updated).toMatchObject({
      lifecycleStatus: "CONFIRMED",
      customerNameSnapshot: "Cliente corregido",
      deliveryAddressSnapshot: "Calle Dos 200",
      deliveryFeeMinor: 350_000,
    });
  });

  it("protege acciones sensibles con el PIN de demostración", async () => {
    const api = createDemoApi(new MemoryStorage());
    await expect(
      api.cancelOrder({
        orderId: "order-1001",
        reason: "Prueba",
        authorizerPin: "0000",
      }),
    ).rejects.toThrow("1234");
    await expect(
      api.cancelOrder({
        orderId: "order-1001",
        reason: "Prueba",
        authorizerPin: "1234",
      }),
    ).resolves.toMatchObject({ operationalStatus: "CANCELLED" });
  });

  it("cierra la caja demo separando arqueo, cambio final y retiro", async () => {
    const api = createDemoApi(new MemoryStorage());
    const closed = await api.closeCashSession({
      countedAmountMinor: 7_350_000,
      closingFloatAmountMinor: 3_000_000,
      force: true,
      reason: "Fin de turno demo",
      authorizerPin: "1234",
    });
    expect(closed).toMatchObject({
      differenceMinor: 0,
      closingFloatAmountMinor: 3_000_000,
      cashRemovedAmountMinor: 4_350_000,
      floatDifferenceMinor: -2_000_000,
      cashSalesMinor: 2_350_000,
    });
    expect((await api.bootstrap()).cashSession).toBeNull();
  });

  it("informa las diferencias de caja separadas por turno", async () => {
    const api = createDemoApi(new MemoryStorage());
    const closed = await api.closeCashSession({
      countedAmountMinor: 8_000_000,
      closingFloatAmountMinor: 5_000_000,
      force: true,
      reason: "Diferencia de prueba",
      authorizerPin: "1234",
    });
    const current = await api.openCashSession({
      openingAmountMinor: 5_000_000,
    });

    const report = await api.getDetailedReport({
      dateFrom: closed.businessDate,
      dateTo: closed.businessDate,
    });

    expect(report.cash.differencesMinor).toBe(650_000);
    expect(report.cash.sessions).toEqual([
      expect.objectContaining({
        id: current.id,
        status: "OPEN",
        differenceMinor: null,
      }),
      expect.objectContaining({
        id: closed.id,
        status: "CLOSED",
        differenceMinor: 650_000,
      }),
    ]);
  });

  it("restablece el almacenamiento aislado", () => {
    const storage = new MemoryStorage();
    storage.setItem(DEMO_STORAGE_KEY, "cambios");
    resetDemoData(storage);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it("crea clientes y repartidores operativos sin pedir PIN propio", async () => {
    const api = createDemoApi(new MemoryStorage());
    const customer = await api.createCustomer({
      name: "Cliente desde pedido",
      phone: "11 2222-3333",
      address: "Calle 123",
      notes: "Prefiere WhatsApp",
    });
    const driver = await api.createDriver({
      fullName: "Repartidor demo",
      authorizerPin: "1234",
    });

    expect((await api.searchCustomers("Cliente desde"))[0]).toMatchObject({
      id: customer.id,
      phone: "11 2222-3333",
      notes: "Prefiere WhatsApp",
    });
    expect(await api.searchCustomers("")).toContainEqual(customer);
    expect((await api.searchCustomers("Calle 123"))[0]?.id).toBe(customer.id);
    expect(driver).toMatchObject({
      roleCode: "DELIVERY_DRIVER",
      fullName: "Repartidor demo",
    });
    expect(driver.staffNumber).toBeGreaterThan(0);
    const customDriver = await api.createDriver({
      staffNumber: 88,
      fullName: "Repartidor con número",
      authorizerPin: "1234",
    });
    expect(customDriver.staffNumber).toBe(88);
    await expect(
      api.createDriver({
        staffNumber: 88,
        fullName: "Repartidor duplicado",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("ya está ocupado");
    await expect(
      api.createCustomer({
        name: "Cliente desde pedido",
        phone: "11-2222-3333",
      }),
    ).rejects.toThrow("duplicado exacto");
    await expect(
      api.createCustomer({
        name: "Familiar del cliente",
        phone: "11-2222-3333",
      }),
    ).resolves.toMatchObject({ name: "Familiar del cliente" });
    const updated = await api.updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt,
      name: "Cliente editado",
      phone: "11 2222-4444",
      addresses: [
        {
          id: customer.addresses[0]!.id,
          label: "Principal",
          address: "Calle 123",
        },
        { label: "Trabajo", address: "Avenida 456" },
      ],
    });
    expect(updated.addresses.map((address) => address.address)).toEqual([
      "Calle 123",
      "Avenida 456",
    ]);
    expect(updated.addresses[0]!.id).toBe(customer.addresses[0]!.id);

    await expect(
      api.updateCustomer({
        customerId: customer.id,
        expectedUpdatedAt: customer.updatedAt,
        name: "Intento obsoleto",
        phone: customer.phone,
        addresses: updated.addresses,
      }),
    ).rejects.toThrow("otra ventana");
  });

  it("pagina la búsqueda demo con total y páginas estables", async () => {
    const api = createDemoApi(new MemoryStorage());
    for (let index = 0; index < 27; index += 1) {
      await api.createCustomer({
        name: `Cliente escala ${String(index).padStart(2, "0")}`,
        phone: `26 2600-${String(index).padStart(4, "0")}`,
      });
    }

    const first = await api.searchCustomersPage({
      query: "Cliente escala",
      page: 1,
      pageSize: 10,
    });
    const last = await api.searchCustomersPage({
      query: "Cliente escala",
      page: 99,
      pageSize: 10,
    });

    expect(first).toMatchObject({
      total: 27,
      page: 1,
      pageSize: 10,
      pageCount: 3,
    });
    expect(first.items).toHaveLength(10);
    expect(first.items[0]?.name).toBe("Cliente escala 00");
    expect(last.page).toBe(3);
    expect(last.items).toHaveLength(7);
    expect(last.items[0]?.name).toBe("Cliente escala 20");
  });

  it("fusiona, archiva y calcula el perfil completo en demo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const source = await api.createCustomer({
      name: "Duplicado demo origen",
      phone: "26 2666-1000",
      tags: ["Frecuente"],
      preferences: "Sin sal",
      addresses: [{ label: "Casa", address: "Ruta Demo 10" }],
    });
    const target = await api.createCustomer({
      name: "Receptor demo",
      phone: "26 2666-2000",
      tags: ["Empresa"],
      addresses: [{ label: "Trabajo", address: "Centro Demo 20" }],
    });

    const merged = await api.mergeCustomers({
      sourceCustomerId: source.id,
      targetCustomerId: target.id,
      reason: "Duplicado confirmado",
      authorizerPin: "1234",
    });
    expect(merged.tags).toEqual(
      expect.arrayContaining(["Frecuente", "Empresa"]),
    );
    expect(merged.addresses).toHaveLength(2);
    expect(
      (
        await api.searchCustomersPage({
          query: "Duplicado demo",
          page: 1,
          pageSize: 10,
          status: "ARCHIVED",
        })
      ).items[0],
    ).toMatchObject({ active: false, mergedIntoCustomerId: target.id });
    await expect(
      api.setCustomerActive({
        customerId: source.id,
        active: true,
        reason: "No corresponde",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("fusionada");
    await expect(
      api.getCustomerProfile({ customerId: target.id, page: 1, pageSize: 10 }),
    ).resolves.toMatchObject({
      customer: { id: target.id },
      metrics: { orderCount: 0, averageTicketMinor: 0 },
      history: { total: 0 },
    });
    await expect(
      api.setCustomerActive({
        customerId: target.id,
        active: false,
        reason: "Sin actividad",
        authorizerPin: "1234",
      }),
    ).resolves.toMatchObject({ active: false });
  });

  it("exige nombre, teléfono y dirección en envíos y pedidos para retirar", async () => {
    const api = createDemoApi(new MemoryStorage());
    await expect(api.createOrder({ type: "TAKEAWAY" })).rejects.toThrow(
      "nombre",
    );
    await expect(
      api.createOrder({
        type: "TAKEAWAY",
        customerName: "Cliente",
      }),
    ).rejects.toThrow("teléfono");
    await expect(
      api.createOrder({
        type: "DELIVERY",
        customerName: "Cliente",
        customerPhone: "11 3333-4444",
      }),
    ).rejects.toThrow("dirección");
  });

  it("detecta ediciones concurrentes entre dos pestañas demo", async () => {
    const storage = new MemoryStorage();
    const firstTab = createDemoApi(storage);
    const secondTab = createDemoApi(storage);
    const firstSnapshot = (await firstTab.searchCustomers("Ana"))[0]!;
    const secondSnapshot = (await secondTab.searchCustomers("Ana"))[0]!;

    await firstTab.updateCustomer({
      customerId: firstSnapshot.id,
      expectedUpdatedAt: firstSnapshot.updatedAt,
      name: "Ana actualizada",
      phone: firstSnapshot.phone,
      addresses: firstSnapshot.addresses,
    });

    await expect(
      secondTab.updateCustomer({
        customerId: secondSnapshot.id,
        expectedUpdatedAt: secondSnapshot.updatedAt,
        name: "Ana desde otra pestaña",
        phone: secondSnapshot.phone,
        addresses: secondSnapshot.addresses,
      }),
    ).rejects.toThrow("otra ventana");
  });

  it("crea categorías y evita nombres duplicados", async () => {
    const api = createDemoApi(new MemoryStorage());
    await expect(
      api.createCategory({ name: "Cafetería" }),
    ).resolves.toMatchObject({
      name: "Cafetería",
      active: true,
    });
    await expect(api.createCategory({ name: " cafetería " })).rejects.toThrow(
      "Ya existe una categoría",
    );
    expect((await api.bootstrap()).categories.at(-1)?.name).toBe("Cafetería");
  });

  it("elimina una categoría libre, audita y persiste el cambio", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    const category = await api.createCategory({ name: "Temporal" });
    await expect(
      api.deleteCategory({
        categoryId: category.id,
        reason: "Limpieza de catálogo",
        authorizerPin: "1234",
      }),
    ).resolves.toEqual({ deleted: true });
    expect(
      (await createDemoApi(storage).bootstrap()).categories.some(
        (item) => item.id === category.id,
      ),
    ).toBe(false);
  });

  it("bloquea eliminar categorías relacionadas y PIN inválido", async () => {
    const api = createDemoApi(new MemoryStorage());
    await expect(
      api.deleteCategory({
        categoryId: "cat-pizzas",
        reason: "Quitar",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("productos o historial");
    const category = await api.createCategory({ name: "Otra temporal" });
    await expect(
      api.deleteCategory({
        categoryId: category.id,
        reason: "Quitar",
        authorizerPin: "0000",
      }),
    ).rejects.toThrow(/PIN|permiso/i);
  });

  it("permite configurar control de stock por categoría y sincronizar productos masivamente", async () => {
    const api = createDemoApi(new MemoryStorage());
    const category = await api.createCategory({
      name: "Cafetería Demo",
      stockControlEnabled: true,
    });
    expect(category.stockControlEnabled).toBe(true);

    const prodWithStock = await api.createProduct({
      categoryId: category.id,
      name: "Café con leche",
      stockMinor: 5_000,
      stockTargetMinor: 20_000,
      stockMinMinor: 5_000,
      stockCriticalMinor: 2_000,
      prices: [
        { priceListCode: "SALON", amountMinor: 1_000 },
        { priceListCode: "TAKEAWAY", amountMinor: 900 },
        { priceListCode: "DELIVERY", amountMinor: 900 },
      ],
    });
    expect(prodWithStock.stockMinor).toBe(5_000);

    const prodWithoutStock = await api.createProduct({
      categoryId: category.id,
      name: "Té verde",
      stockMinor: null,
      prices: [
        { priceListCode: "SALON", amountMinor: 800 },
        { priceListCode: "TAKEAWAY", amountMinor: 700 },
        { priceListCode: "DELIVERY", amountMinor: 700 },
      ],
    });
    expect(prodWithoutStock.stockMinor).toBeNull();

    const updatedCategory = await api.updateCategory({
      categoryId: category.id,
      name: "Cafetería Demo",
      active: true,
      sortOrder: category.sortOrder,
      stockControlEnabled: false,
      reason: "Desactivar control de stock",
      authorizerPin: "1234",
    });
    expect(updatedCategory.stockControlEnabled).toBe(false);

    let bootstrap = await api.bootstrap();
    let p1 = bootstrap.products.find((p) => p.id === prodWithStock.id)!;
    let p2 = bootstrap.products.find((p) => p.id === prodWithoutStock.id)!;
    expect(p1.stockMinor).toBeNull();
    expect(p1.stockTargetMinor).toBeNull();
    expect(p1.stockMinMinor).toBeNull();
    expect(p1.stockCriticalMinor).toBeNull();
    expect(p2.stockMinor).toBeNull();

    const reactivatedCategory = await api.updateCategory({
      categoryId: category.id,
      name: "Cafetería Demo",
      active: true,
      sortOrder: category.sortOrder,
      stockControlEnabled: true,
      reason: "Reactivar control de stock",
      authorizerPin: "1234",
    });
    expect(reactivatedCategory.stockControlEnabled).toBe(true);

    bootstrap = await api.bootstrap();
    p1 = bootstrap.products.find((p) => p.id === prodWithStock.id)!;
    p2 = bootstrap.products.find((p) => p.id === prodWithoutStock.id)!;
    expect(p1.stockMinor).toBe(0);
    expect(p2.stockMinor).toBe(0);
  });

  it("unifica el precio de delivery y para retirar al cargar un producto", async () => {
    const api = createDemoApi(new MemoryStorage());
    const product = await api.createProduct({
      categoryId: "cat-pizzas",
      name: "Producto con dos listas",
      prices: [
        { priceListCode: "SALON", amountMinor: 1_000_000 },
        { priceListCode: "TAKEAWAY", amountMinor: 1_200_000 },
        { priceListCode: "DELIVERY", amountMinor: 1_500_000 },
      ],
    });
    expect(
      product.prices.find((price) => price.priceListCode === "TAKEAWAY")
        ?.amountMinor,
    ).toBe(1_200_000);
    expect(
      product.prices.find((price) => price.priceListCode === "DELIVERY")
        ?.amountMinor,
    ).toBe(1_200_000);
  });

  it("descarta borradores y bloquea confirmaciones vacías", async () => {
    const api = createDemoApi(new MemoryStorage());
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente borrador",
      customerPhone: "11 4444-0000",
      deliveryAddress: "Calle 100",
    });
    await expect(api.confirmOrder({ orderId: draft.id })).rejects.toThrow(
      "producto",
    );
    await expect(api.discardDraftOrder({ orderId: draft.id })).resolves.toEqual(
      { discarded: true },
    );
  });

  it("revierte la acción compuesta si un envío mezcla efectivo y transferencia", async () => {
    const api = createDemoApi(new MemoryStorage());
    const draft = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente demo",
      customerPhone: "11 4444-1111",
      deliveryAddress: "Calle 123",
    });
    const populated = await api.addOrderItem({
      orderId: draft.id,
      productId: "prod-muzza",
    });
    const cashMinor = Math.floor(populated.totalMinor / 2);

    await expect(
      api.completeOrder({
        orderId: draft.id,
        finalStatus: "DELIVERED",
        payments: [
          {
            methodCode: "CASH",
            amountMinor: cashMinor,
            receivedMinor: cashMinor,
          },
          {
            methodCode: "TRANSFER",
            amountMinor: populated.totalMinor - cashMinor,
          },
        ],
      }),
    ).rejects.toThrow("sin combinarlos");

    const unchanged = (await api.bootstrap()).orders.find(
      (order) => order.id === draft.id,
    );
    expect(unchanged).toMatchObject({
      lifecycleStatus: "DRAFT",
      paymentStatus: "UNPAID",
    });
    expect(unchanged?.payments).toHaveLength(0);
  });

  it("cuenta actividad del repartidor creado después aunque el ledger esté desactivado", async () => {
    const api = createDemoApi(new MemoryStorage());
    const settings = await api.bootstrap();
    await api.saveSettings({
      ...settings.settings,
      deliverySettlementEnabled: false,
    });
    const draft = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente actividad demo",
      customerPhone: "11 4000-1234",
      deliveryAddress: "Calle actividad 123",
      deliveryFeeMinor: 275_000,
    });
    const populated = await api.addOrderItem({
      orderId: draft.id,
      productId: "prod-muzza",
    });
    await api.confirmOrder({ orderId: draft.id });
    const driver = await api.createDriver({
      fullName: "Repartidor posterior demo",
      authorizerPin: "1234",
    });
    await api.assignDeliveryDriver({
      orderId: draft.id,
      driverUserId: driver.id,
    });
    await api.completeOrder({
      orderId: draft.id,
      finalStatus: "DELIVERED",
      collectedByDriver: true,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });

    const bootstrap = await api.bootstrap();
    expect(
      bootstrap.deliveryLedger.some((ledger) => ledger.orderId === draft.id),
    ).toBe(false);
    expect(bootstrap.driverDeliveryActivity).toContainEqual(
      expect.objectContaining({
        driverUserId: driver.id,
        deliveryCount: 1,
        earningsMinor: 275_000,
        lastDeliveryAt: expect.any(String),
      }),
    );
  });

  it("no bloquea al repartidor por pedidos pendientes de una caja cerrada", async () => {
    const api = createDemoApi(new MemoryStorage());
    const driver = await api.createDriver({
      fullName: "Repartidor histórico demo",
      authorizerPin: "1234",
    });
    const order = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente histórico",
      customerPhone: "11 4000-5000",
      deliveryAddress: "Calle histórica 100",
      deliveryFeeMinor: 200_000,
      driverUserId: driver.id,
    });
    await api.addOrderItem({ orderId: order.id, productId: "prod-muzza" });
    await api.confirmOrder({ orderId: order.id });
    await api.closeCashSession({
      countedAmountMinor: 7_350_000,
      force: true,
      reason: "Cerrar turno demo",
      authorizerPin: "1234",
    });

    await expect(
      api.updateUser({
        userId: driver.id,
        roleCode: "DELIVERY_DRIVER",
        active: false,
        reason: "Pedido de turno cerrado",
        authorizerPin: "1234",
      }),
    ).resolves.toMatchObject({ active: false });
  });

  it("no considera activo un borrador asignado a un repartidor", async () => {
    const api = createDemoApi(new MemoryStorage());
    const driver = await api.createDriver({
      fullName: "Repartidor con borrador demo",
      authorizerPin: "1234",
    });
    await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente borrador",
      customerPhone: "11 4000-6000",
      deliveryAddress: "Calle borrador 100",
      driverUserId: driver.id,
    });

    await expect(
      api.updateUser({
        userId: driver.id,
        roleCode: "DELIVERY_DRIVER",
        active: false,
        reason: "Sólo conserva un borrador",
        authorizerPin: "1234",
      }),
    ).resolves.toMatchObject({ active: false });
  });

  it("elimina de la lista un usuario aunque conserve pedidos históricos", async () => {
    const api = createDemoApi(new MemoryStorage());
    const driver = await api.createDriver({
      fullName: "Repartidor archivado demo",
      authorizerPin: "1234",
    });
    const order = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente del repartidor archivado",
      customerPhone: "11 4000-7000",
      deliveryAddress: "Calle archivada 100",
      driverUserId: driver.id,
    });

    await expect(
      api.deleteUser({
        userId: driver.id,
        reason: "Baja definitiva",
        authorizerPin: "1234",
      }),
    ).resolves.toEqual({ deleted: true });

    const bootstrap = await api.bootstrap();
    expect(bootstrap.users.some((user) => user.id === driver.id)).toBe(false);
    expect(bootstrap.orders).toContainEqual(
      expect.objectContaining({ id: order.id, driverUserId: driver.id }),
    );
  });

  it("devuelve un pago completo y vuelve a dejar el pedido impago", async () => {
    const api = createDemoApi(new MemoryStorage());
    const baseline = await api.bootstrap();
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente devolución",
      customerPhone: "11 4444-2222",
      deliveryAddress: "Calle 200",
    });
    const populated = await api.addOrderItem({
      orderId: draft.id,
      productId: "prod-muzza",
    });
    await api.confirmOrder({ orderId: draft.id });
    const paid = await api.payOrder({
      orderId: draft.id,
      payments: [
        {
          methodCode: "CASH",
          amountMinor: populated.totalMinor,
          receivedMinor: populated.totalMinor,
        },
      ],
    });
    const refunded = await api.refundPayment({
      orderId: draft.id,
      paymentId: paid.payments[0]!.id,
      reason: "Cobro duplicado",
      authorizerPin: "1234",
    });
    expect(refunded).toMatchObject({
      paidMinor: 0,
      paymentStatus: "UNPAID",
    });
    expect(refunded.payments[0]).toMatchObject({
      refundableMinor: 0,
      status: "REFUNDED",
    });
    const afterRefund = await api.bootstrap();
    expect(afterRefund.cashSession?.salesTotalMinor).toBe(
      baseline.cashSession?.salesTotalMinor,
    );
    expect(
      afterRefund.cashSession?.salesByPaymentMethod?.find(
        (method) => method.code === "CASH",
      )?.amountMinor,
    ).toBe(
      baseline.cashSession?.salesByPaymentMethod?.find(
        (method) => method.code === "CASH",
      )?.amountMinor,
    );
  });

  it("aplica precios masivos y simula perfiles de impresión", async () => {
    const api = createDemoApi(new MemoryStorage());
    const updated = await api.bulkUpdateProducts({
      productIds: ["prod-muzza", "prod-napo"],
      active: null,
      categoryId: null,
      priceAdjustment: {
        mode: "PERCENTAGE",
        value: 10,
        priceListCodes: ["SALON"],
      },
      reason: "Nueva lista",
      authorizerPin: "1234",
    });
    expect(
      updated
        .find((product) => product.id === "prod-muzza")
        ?.prices.find((price) => price.priceListCode === "SALON")?.amountMinor,
    ).toBe(1_650_000);
    await expect(api.listPrinters()).resolves.toHaveLength(2);
    const beforeTest = await api.bootstrap();
    const draftSettings = structuredClone(beforeTest.settings);
    draftSettings.businessName = "Nombre sin guardar";
    draftSettings.printing.kitchen.deviceName = "Impresora sólo para prueba";
    await expect(
      api.testPrinter({ kind: "KITCHEN_ORDER", settings: draftSettings }),
    ).resolves.toMatchObject({
      printed: true,
      message: expect.stringContaining("Impresora sólo para prueba"),
    });
    const afterTest = await api.bootstrap();
    expect(afterTest.settings.businessName).toBe(
      beforeTest.settings.businessName,
    );
    expect(afterTest.settings.printing.kitchen.deviceName).toBe(
      beforeTest.settings.printing.kitchen.deviceName,
    );

    const invalidSettings = structuredClone(beforeTest.settings);
    invalidSettings.printing.kitchen.charsPerLine = 100;
    await expect(api.saveSettings(invalidSettings)).rejects.toThrow(
      "entre 20 y 64",
    );
    await expect(
      api.testPrinter({ kind: "KITCHEN_ORDER", settings: invalidSettings }),
    ).rejects.toThrow("entre 20 y 64");
  });

  it("revierte por completo un lote si un producto quedaría con precio negativo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const before = await api.bootstrap();
    const muzzaBefore = before.products.find(
      (product) => product.id === "prod-muzza",
    )!;
    const waterBefore = before.products.find(
      (product) => product.id === "prod-agua",
    )!;

    await expect(
      api.bulkUpdateProducts({
        productIds: [muzzaBefore.id, waterBefore.id],
        active: false,
        categoryId: "cat-postres",
        priceAdjustment: {
          mode: "FIXED",
          value: -300_000,
          priceListCodes: ["SALON"],
        },
        reason: "Error controlado",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("Agua mineral");

    const after = await api.bootstrap();
    expect(
      after.products.find((product) => product.id === muzzaBefore.id),
    ).toEqual(muzzaBefore);
    expect(
      after.products.find((product) => product.id === waterBefore.id),
    ).toEqual(waterBefore);
  });

  it("rechaza precios e incrementos fuera del rango entero seguro", async () => {
    const api = createDemoApi(new MemoryStorage());
    await expect(
      api.createProduct({
        categoryId: "cat-pizzas",
        name: "Precio imposible",
        prices: [
          { priceListCode: "SALON", amountMinor: Number.MAX_VALUE },
          { priceListCode: "TAKEAWAY", amountMinor: 100_000 },
          { priceListCode: "DELIVERY", amountMinor: 100_000 },
        ],
      }),
    ).rejects.toThrow("rango");
    await expect(
      api.bulkUpdateProducts({
        productIds: ["prod-muzza"],
        active: null,
        categoryId: null,
        priceAdjustment: {
          mode: "FIXED",
          value: Number.MAX_SAFE_INTEGER,
          priceListCodes: ["SALON"],
        },
        reason: "Error controlado",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow("rango");
  });

  it("usa milésimas para stock y rechaza existencias iniciales inválidas", async () => {
    const api = createDemoApi(new MemoryStorage());
    expect(
      (await api.bootstrap()).products.find(
        (product) => product.id === "prod-muzza",
      )?.stockMinor,
    ).toBe(35_000);

    await expect(
      api.createProduct({
        categoryId: "cat-pizzas",
        name: "Stock inválido",
        stockMinor: Number.NaN,
        prices: [
          { priceListCode: "SALON", amountMinor: 100_000 },
          { priceListCode: "TAKEAWAY", amountMinor: 100_000 },
          { priceListCode: "DELIVERY", amountMinor: 100_000 },
        ],
      }),
    ).rejects.toThrow("stock inicial");

    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-4",
      waiterUserId: "user-waiter",
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
      quantity: 2,
    });
    await api.confirmOrder({ orderId: order.id });
    expect(
      (await api.bootstrap()).products.find(
        (product) => product.id === "prod-muzza",
      )?.stockMinor,
    ).toBe(33_000);
    await api.cancelOrder({
      orderId: order.id,
      reason: "Restituir stock de prueba",
      authorizerPin: "1234",
    });
    expect(
      (await api.bootstrap()).products.find(
        (product) => product.id === "prod-muzza",
      )?.stockMinor,
    ).toBe(35_000);
  });

  it("registra compras idempotentes y conserva parámetros de inventario", async () => {
    const api = createDemoApi(new MemoryStorage());
    const before = (await api.bootstrap()).products.find(
      (product) => product.id === "prod-muzza",
    )!;
    expect(before.stockTargetMinor).toBe(50_000);
    const input = {
      idempotencyKey: "demo-purchase-1",
      supplierName: "Proveedor Demo",
      invoiceNumber: "FAC-1",
      notes: "Reposición semanal",
      authorizerPin: "1234",
      items: [
        {
          productId: before.id,
          quantityMinor: 2_500,
          unitCostMinor: 10_000,
        },
      ],
    };
    const purchase = await api.createPurchase(input);
    expect(purchase.totalMinor).toBe(25_000);
    expect(purchase.items[0]).toMatchObject({
      productName: before.name,
      stockBeforeMinor: before.stockMinor,
      stockAfterMinor: (before.stockMinor ?? 0) + 2_500,
    });
    expect((await api.createPurchase(input)).id).toBe(purchase.id);
    expect((await api.listPurchases()).length).toBe(1);
    expect(
      (await api.bootstrap()).products.find(
        (product) => product.id === before.id,
      )?.stockMinor,
    ).toBe((before.stockMinor ?? 0) + 2_500);
  });

  it("traslada un pedido a otra mesa libre con PIN y actualiza ocupación de mesas", async () => {
    const api = createDemoApi(new MemoryStorage());
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-1",
      waiterUserId: "user-waiter",
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
    });

    // Rechaza PIN incorrecto
    await expect(
      api.changeOrderTable({
        orderId: order.id,
        targetTableId: "table-3",
        authorizerPin: "0000",
      }),
    ).rejects.toThrow("1234");

    // Rechaza misma mesa
    await expect(
      api.changeOrderTable({
        orderId: order.id,
        targetTableId: "table-1",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow(/ya se encuentra en esa mesa/i);

    // Rechaza si la mesa de destino está ocupada (table-2 tiene order-1001)
    await expect(
      api.changeOrderTable({
        orderId: order.id,
        targetTableId: "table-2",
        authorizerPin: "1234",
      }),
    ).rejects.toThrow(/ya está ocupada/i);

    // Traslado exitoso a mesa 3 (libre)
    const moved = await api.changeOrderTable({
      orderId: order.id,
      targetTableId: "table-3",
      authorizerPin: "1234",
      reason: "Traslado a mesa 3",
    });

    expect(moved.tableId).toBe("table-3");
    const data = await api.bootstrap();
    const t1 = data.tables.find((t) => t.id === "table-1");
    const t3 = data.tables.find((t) => t.id === "table-3");
    expect(t1?.currentOrderId).toBeNull();
    expect(t3?.currentOrderId).toBe(order.id);
  });

  it("permite cobrar con sobrepago y vuelto multimedio en demo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const order = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Demo Sobrepago",
      customerPhone: "11 9999-8888",
    });
    const populated = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
    });
    await api.confirmOrder({ orderId: order.id });
    const remaining = populated.totalMinor;

    const paid = await api.payOrder({
      orderId: order.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: remaining + 100_000 }],
      change: { methodCode: "CASH", amountMinor: 100_000 },
    });

    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.paidMinor).toBe(remaining);
    expect(paid.changeAmountMinor).toBe(100_000);
    expect(paid.changeMethodCode).toBe("CASH");
  });

  it("permite pagar al repartidor en el momento al cobrar en demo", async () => {
    const api = createDemoApi(new MemoryStorage());
    const bootstrap = await api.bootstrap();
    const driver = bootstrap.users.find((u) => u.roleCode === "DELIVERY_DRIVER")!;

    const order = await api.createOrder({
      type: "DELIVERY",
      customerName: "Demo Delivery",
      customerPhone: "11 7777-6666",
      deliveryAddress: "Calle Falsa 123",
      deliveryFeeMinor: 250_000,
      driverUserId: driver.id,
    });
    const populated = await api.addOrderItem({
      orderId: order.id,
      productId: "prod-muzza",
    });
    await api.confirmOrder({ orderId: order.id });

    await api.payOrder({
      orderId: order.id,
      payDriverNow: true,
      payments: [{ methodCode: "TRANSFER", amountMinor: populated.totalMinor }],
    });

    const after = await api.bootstrap();
    const ledger = after.deliveryLedger.find((l) => l.orderId === order.id);
    expect(ledger).toBeDefined();
    expect(ledger?.status).toBe("SETTLED");
    expect(ledger?.settledAmountMinor).toBe(250_000);
  });

  it("permite agregar pizza mitad y mitad combinando dos variedades", async () => {
    const api = createDemoApi(new MemoryStorage());
    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-1",
      waiterUserId: "user-waiter",
    });

    const updated = await api.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: "prod-muzza",
      secondProductId: "prod-napo",
    });

    expect(updated.items).toHaveLength(1);
    const item = updated.items[0]!;
    expect(item.halves).toHaveLength(2);
    expect(item.halves[0]?.productId).toBe("prod-muzza");
    expect(item.halves[1]?.productId).toBe("prod-napo");
    expect(item.productNameSnapshot).toContain("Mitad");
    expect(item.lineTotalMinor).toBeGreaterThan(0);
  });

  it("permite generar una variante de un producto con precios y stock propios", async () => {
    const api = createDemoApi(new MemoryStorage());
    const bootstrap = await api.bootstrap();
    const baseProduct = bootstrap.products.find((p) => p.id === "prod-muzza")!;
    expect(baseProduct).toBeDefined();

    const baseSalonPrice =
      baseProduct.prices.find((p) => p.priceListCode === "SALON")
        ?.amountMinor ?? 0;
    const variantSalonPrice = baseSalonPrice + 300_000;
    const variantDeliveryPrice = variantSalonPrice + 50_000;

    const variantName = `${baseProduct.name} Doble`;
    const variantCode = "MUZ-DOBLE";

    const variantProduct = await api.createProduct({
      categoryId: baseProduct.categoryId,
      name: variantName,
      code: variantCode,
      parentProductId: baseProduct.id,
      stockMinor: 15_000,
      stockMinMinor: 2_000,
      imageDataUrl: baseProduct.imageDataUrl,
      prices: [
        { priceListCode: "SALON", amountMinor: variantSalonPrice },
        { priceListCode: "TAKEAWAY", amountMinor: variantDeliveryPrice },
        { priceListCode: "DELIVERY", amountMinor: variantDeliveryPrice },
      ],
    });

    expect(variantProduct.name).toBe(variantName);
    expect(variantProduct.code).toBe(variantCode);
    expect(variantProduct.parentProductId).toBe(baseProduct.id);
    expect(variantProduct.categoryId).toBe(baseProduct.categoryId);
    expect(variantProduct.stockMinor).toBe(15_000);
    expect(
      variantProduct.prices.find((p) => p.priceListCode === "SALON")
        ?.amountMinor,
    ).toBe(variantSalonPrice);
    expect(
      variantProduct.prices.find((p) => p.priceListCode === "DELIVERY")
        ?.amountMinor,
    ).toBe(variantDeliveryPrice);

    const order = await api.createOrder({
      type: "DINE_IN",
      tableId: "table-1",
      waiterUserId: "user-waiter",
    });
    const orderWithVariant = await api.addOrderItem({
      orderId: order.id,
      productId: variantProduct.id,
    });
    expect(orderWithVariant.items).toHaveLength(1);
    expect(orderWithVariant.items[0]?.productNameSnapshot).toBe(variantName);
    expect(orderWithVariant.items[0]?.unitPriceMinorSnapshot).toBe(
      variantSalonPrice,
    );
    expect(orderWithVariant.items[0]?.lineTotalMinor).toBe(variantSalonPrice);
  });

  it("permite liquidar envíos de múltiples repartidores en una misma operación", async () => {
    const api = createDemoApi(new MemoryStorage());
    const driverA = await api.createDriver({
      fullName: "Repartidor Alpha",
      authorizerPin: "1234",
    });
    const driverB = await api.createDriver({
      fullName: "Repartidor Beta",
      authorizerPin: "1234",
    });

    const order1 = await api.createOrder({
      type: "DELIVERY",
      deliveryFeeMinor: 200_000,
      driverUserId: driverA.id,
      customerName: "Cliente A",
      customerPhone: "1122334455",
      deliveryAddress: "Calle Falsa 123",
    });
    const order2 = await api.createOrder({
      type: "DELIVERY",
      deliveryFeeMinor: 300_000,
      driverUserId: driverB.id,
      customerName: "Cliente B",
      customerPhone: "1122334466",
      deliveryAddress: "Calle Falsa 456",
    });

    await api.addOrderItem({ orderId: order1.id, productId: "prod-muzza" });
    await api.addOrderItem({ orderId: order2.id, productId: "prod-muzza" });

    await api.confirmOrder({ orderId: order1.id });
    await api.confirmOrder({ orderId: order2.id });

    const currentOrders = (await api.bootstrap()).orders;
    const freshOrder1 = currentOrders.find((o) => o.id === order1.id)!;
    const freshOrder2 = currentOrders.find((o) => o.id === order2.id)!;

    await api.payOrder({
      orderId: order1.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: freshOrder1.totalMinor }],
    });
    await api.payOrder({
      orderId: order2.id,
      payments: [{ methodCode: "TRANSFER", amountMinor: freshOrder2.totalMinor }],
    });

    await api.updateOrderStatus({ orderId: order1.id, status: "DELIVERED" });
    await api.updateOrderStatus({ orderId: order2.id, status: "DELIVERED" });

    const before = await api.bootstrap();
    const ledger1 = before.deliveryLedger.find((l) => l.orderId === order1.id)!;
    const ledger2 = before.deliveryLedger.find((l) => l.orderId === order2.id)!;
    expect(ledger1.status).toBe("PENDING");
    expect(ledger2.status).toBe("PENDING");
    expect(ledger1.driverUserId).not.toBe(ledger2.driverUserId);

    const settled = await api.settleDelivery({
      ledgerIds: [ledger1.id, ledger2.id],
      reason: "Liquidación combinada fin de turno",
      authorizerPin: "1234",
    });

    expect(settled).toHaveLength(2);
    expect(settled.every((s) => s.status === "SETTLED")).toBe(true);

    const after = await api.bootstrap();
    expect(
      after.deliveryLedger.find((l) => l.id === ledger1.id)?.status,
    ).toBe("SETTLED");
    expect(
      after.deliveryLedger.find((l) => l.id === ledger2.id)?.status,
    ).toBe("SETTLED");
  });
});


