import { describe, expect, it } from "vitest";
import { createDemoApi, DEMO_STORAGE_KEY, type DemoStorage } from "./demo-api";

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

async function draft(
  api: ReturnType<typeof createDemoApi>,
  type: "DELIVERY" | "TAKEAWAY" = "DELIVERY",
) {
  const order = await api.createOrder({
    type,
    customerName: "Cliente prueba",
    customerPhone: "1122334455",
    deliveryAddress: type === "DELIVERY" ? "Calle 123" : undefined,
    deliveryFeeMinor: 200_000,
  });
  const populated = await api.addOrderItem({
    orderId: order.id,
    productId: "prod-muzza",
  });
  return { order, populated };
}

async function configure(api: ReturnType<typeof createDemoApi>) {
  const current = await api.bootstrap();
  await api.saveSettings({
    ...current.settings,
    deliverySettlementEnabled: true,
    deliveryFeeBelongsToDriver: true,
    deliveryDriverPaymentMode: "ACCUMULATED",
  });
}

describe("repartidor y responsable explícitos en demo", () => {
  it.each([undefined, false] as const)(
    "cobra desde el negocio por defecto/false (%s)",
    async (collectedByDriver) => {
      const storage = new MemoryStorage();
      const api = createDemoApi(storage);
      await configure(api);
      const driver = await api.createDriver({
        fullName: "Chofer destino",
        authorizerPin: "1234",
      });
      const { order, populated } = await draft(api);
      const before = (await api.bootstrap()).cashSession!;
      const completed = await api.completeOrder({
        orderId: order.id,
        driverUserId: driver.id,
        ...(collectedByDriver === undefined ? {} : { collectedByDriver }),
        finalStatus: "DELIVERED",
        payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
      });
      expect(completed.collectedByDriver).toBe(false);
      const after = await api.bootstrap();
      expect(after.cashSession!.expectedAmountMinor).toBe(
        before.expectedAmountMinor + populated.totalMinor,
      );
      expect(
        after.deliveryLedger.find((row) => row.orderId === order.id)?.direction,
      ).toBe("BUSINESS_OWES_DRIVER");
      expect(
        after.deliveryLedger.find((row) => row.orderId === order.id)
          ?.driverUserId,
      ).toBe(driver.id);
      expect(
        (await createDemoApi(storage).bootstrap()).deliveryLedger.find(
          (row) => row.orderId === order.id,
        )?.driverUserId,
      ).toBe(driver.id);
    },
  );

  it("true explícito cobra por el repartidor y crea deuda del repartidor sin sumar ventas a caja", async () => {
    const api = createDemoApi(new MemoryStorage());
    await configure(api);
    const driver = await api.createDriver({
      fullName: "Chofer cobra",
      authorizerPin: "1234",
    });
    const { order, populated } = await draft(api);
    const before = (await api.bootstrap()).cashSession!;
    const completed = await api.completeOrder({
      orderId: order.id,
      driverUserId: driver.id,
      collectedByDriver: true,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    expect(completed.collectedByDriver).toBe(true);
    const after = await api.bootstrap();
    expect(after.cashSession!.expectedAmountMinor).toBe(
      before.expectedAmountMinor,
    );
    expect(
      after.deliveryLedger.find((row) => row.orderId === order.id),
    ).toMatchObject({
      direction: "DRIVER_OWES_BUSINESS",
      driverUserId: driver.id,
      amountDueMinor: populated.totalMinor - 200_000,
    });
  });

  it("permite mixto efectivo/transferencia cuando cobra el negocio", async () => {
    const api = createDemoApi(new MemoryStorage());
    await configure(api);
    const driver = await api.createDriver({
      fullName: "Chofer mixto",
      authorizerPin: "1234",
    });
    const { order, populated } = await draft(api);
    const half = Math.floor(populated.totalMinor / 2);
    const completed = await api.completeOrder({
      orderId: order.id,
      driverUserId: driver.id,
      finalStatus: "DELIVERED",
      payments: [
        { methodCode: "CASH", amountMinor: half },
        { methodCode: "TRANSFER", amountMinor: populated.totalMinor - half },
      ],
    });
    expect(completed.collectedByDriver).toBe(false);
    expect(
      (await api.bootstrap()).deliveryLedger.find(
        (row) => row.orderId === order.id,
      )?.direction,
    ).toBe("BUSINESS_OWES_DRIVER");
  });

  it("retiene responsable repartidor en pago parcial posterior sin flag", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    await configure(api);
    const driver = await api.createDriver({
      fullName: "Chofer parcial",
      authorizerPin: "1234",
    });
    const { order, populated } = await draft(api);
    await api.assignDeliveryDriver({
      orderId: order.id,
      driverUserId: driver.id,
    });
    await api.confirmOrder({ orderId: order.id });
    const partial = 100_000;
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    const storedOrder = saved.data.orders.find(
      (item: any) => item.id === order.id,
    );
    storedOrder.paidMinor = partial;
    storedOrder.paymentStatus = "PARTIALLY_PAID";
    storedOrder.collectedByDriver = true;
    storedOrder.payments = [
      {
        id: "partial-payment",
        methodCode: "CASH",
        methodName: "Efectivo",
        amountMinor: partial,
        receivedMinor: partial,
        reference: null,
        createdAt: new Date().toISOString(),
        refundedMinor: 0,
        refundableMinor: partial,
        status: "ACTIVE",
      },
    ];
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    const resumed = createDemoApi(storage);
    const beforeResume = (await resumed.bootstrap()).cashSession!
      .expectedAmountMinor;
    const result = await resumed.payOrder({
      orderId: order.id,
      collectedByDriver: true,
      payments: [
        { methodCode: "CASH", amountMinor: populated.totalMinor - partial },
      ],
    });
    expect(result.collectedByDriver).toBe(true);
    expect((await resumed.bootstrap()).cashSession!.expectedAmountMinor).toBe(
      beforeResume,
    );
    await resumed.updateOrderStatus({
      orderId: order.id,
      status: "OUT_FOR_DELIVERY",
    });
    await resumed.updateOrderStatus({ orderId: order.id, status: "DELIVERED" });
    expect(
      (await resumed.bootstrap()).deliveryLedger.find(
        (row) => row.orderId === order.id,
      )?.direction,
    ).toBe("DRIVER_OWES_BUSINESS");
  });

  it("asigna y cambia repartidor seleccionado al completar, sin permitir cambios inválidos o históricos", async () => {
    const storage = new MemoryStorage();
    const api = createDemoApi(storage);
    await configure(api);
    const first = await api.createDriver({
      fullName: "Chofer uno",
      authorizerPin: "1234",
    });
    const second = await api.createDriver({
      fullName: "Chofer dos",
      authorizerPin: "1234",
    });
    const { order, populated } = await draft(api);
    const invalidId = "not-a-driver";
    const beforeInvalid = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.completeOrder({
        orderId: order.id,
        driverUserId: invalidId,
        finalStatus: "DELIVERED",
        payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
      }),
    ).rejects.toThrow();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeInvalid);
    await api.assignDeliveryDriver({
      orderId: order.id,
      driverUserId: first.id,
    });
    await api.confirmOrder({ orderId: order.id });
    const changed = await api.payOrder({
      orderId: order.id,
      driverUserId: second.id,
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    expect(changed.driverUserId).toBe(second.id);
    const inactive = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    inactive.data.users.find((user: any) => user.id === second.id).active =
      false;
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(inactive));
    const reloaded = createDemoApi(storage);
    const inactiveDraft = await draft(reloaded);
    const ledgerBefore = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      reloaded.payOrder({
        orderId: inactiveDraft.order.id,
        driverUserId: second.id,
        payments: [
          {
            methodCode: "CASH",
            amountMinor: inactiveDraft.populated.totalMinor,
          },
        ],
      }),
    ).rejects.toThrow();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(ledgerBefore);
    await expect(
      api.payOrder({
        orderId: "missing",
        driverUserId: first.id,
        payments: [],
      }),
    ).rejects.toThrow();
    const nonDelivery = await draft(api, "TAKEAWAY");
    const beforeNonDelivery = storage.getItem(DEMO_STORAGE_KEY);
    await expect(
      api.payOrder({
        orderId: nonDelivery.order.id,
        driverUserId: first.id,
        payments: [
          { methodCode: "CASH", amountMinor: nonDelivery.populated.totalMinor },
        ],
      }),
    ).rejects.toThrow();
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(beforeNonDelivery);
  });

  it("no cambia repartidor de pedido finalizado", async () => {
    const api = createDemoApi(new MemoryStorage());
    await configure(api);
    const first = await api.createDriver({
      fullName: "Chofer final",
      authorizerPin: "1234",
    });
    const second = await api.createDriver({
      fullName: "Chofer alternativo",
      authorizerPin: "1234",
    });
    const { order, populated } = await draft(api);
    await api.completeOrder({
      orderId: order.id,
      driverUserId: first.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "CASH", amountMinor: populated.totalMinor }],
    });
    const before = (await api.bootstrap()).deliveryLedger.find(
      (row) => row.orderId === order.id,
    )!;
    await expect(
      api.assignDeliveryDriver({ orderId: order.id, driverUserId: second.id }),
    ).rejects.toThrow(/finalizado/i);
    expect(
      (await api.bootstrap()).deliveryLedger.find((row) => row.id === before.id)
        ?.driverUserId,
    ).toBe(first.id);
  });
});
