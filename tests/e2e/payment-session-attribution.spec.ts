import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidenceDir = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-refund-repayment-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
const D1 = "2026-10-06";
const D2 = "2026-10-07";

async function launch(tag: string) {
  await mkdir(evidenceDir, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us17-${tag}-`));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible({
    timeout: 9000000,
  });
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
  });
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us17-")
    )
      throw new Error("Unsafe disposable profile path");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
}
const nativeCapture = async (name: string) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  });
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(join(evidenceDir, name), Buffer.from(png, "base64"));
};
async function setDate(sessionId: string, date: string) {
  const userDataPath = await app.evaluate(({ app }) => app.getPath("userData"));
  expect(resolve(userDataPath)).toBe(resolve(profile));
  expect(basename(profile)).toMatch(/^gastronomy-us17-/);
  const modulePath = createRequire(
    join(process.cwd(), "packages/database/package.json"),
  ).resolve("better-sqlite3-multiple-ciphers");
  const changed = await app.evaluate(
    (
      { app },
      x: {
        profile: string;
        modulePath: string;
        sessionId: string;
        date: string;
      },
    ) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(x.profile))
        throw Error("Wrong isolated profile");
      const req = process
        .getBuiltinModule("module")
        .createRequire(x.modulePath);
      const db = new (req(x.modulePath))(
        path.join(x.profile, "gastronomy.sqlite"),
      );
      try {
        return db
          .prepare("UPDATE cash_sessions SET business_date = ? WHERE id = ?")
          .run(x.date, x.sessionId).changes;
      } finally {
        db.close();
      }
    },
    { profile, modulePath, sessionId, date },
  );
  expect(changed).toBe(1);
}
async function ledger() {
  const modulePath = createRequire(
    join(process.cwd(), "packages/database/package.json"),
  ).resolve("better-sqlite3-multiple-ciphers");
  return app.evaluate(
    ({ app }, x: { profile: string; modulePath: string }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(x.profile))
        throw Error("Wrong isolated profile");
      const req = process
        .getBuiltinModule("module")
        .createRequire(x.modulePath);
      const db = new (req(x.modulePath))(
        path.join(x.profile, "gastronomy.sqlite"),
      );
      try {
        return {
          payments: db
            .prepare(
              "SELECT id,order_id,amount_minor,cash_session_id,payment_method_id FROM payments ORDER BY created_at,rowid",
            )
            .all(),
          refunds: db
            .prepare(
              "SELECT id,payment_id,amount_minor,cash_session_id FROM payment_refunds ORDER BY created_at,rowid",
            )
            .all(),
          movements: db
            .prepare(
              "SELECT id,type,amount_minor,cash_session_id,payment_method_id FROM cash_movements ORDER BY created_at,rowid",
            )
            .all(),
        };
      } finally {
        db.close();
      }
    },
    { profile, modulePath },
  );
}
async function startSession(opening: number, date: string) {
  const s = await page.evaluate(
    (openingAmountMinor) =>
      window.gastronomy.openCashSession({ openingAmountMinor }),
    opening,
  );
  await setDate(s.id, date);
  return s;
}
async function makeOrder(customerName: string, method: string, amount: number) {
  return page.evaluate(
    async (x) => {
      const api = window.gastronomy;
      const b = await api.bootstrap();
      const p = b.products.find((v) => v.code === "MUZG")!;
      let o = await api.createOrder({
        type: "TAKEAWAY",
        customerName: x.customerName,
        customerPhone: "1155551717",
      });
      await api.addOrderItem({ orderId: o.id, productId: p.id });
      o = await api.confirmOrder({ orderId: o.id });
      const totalMinor = o.totalMinor;
      const paid = await api.payOrder({
        orderId: o.id,
        payments: [{ methodCode: x.method, amountMinor: x.amount }],
        change:
          x.amount === 1600000
            ? { amountMinor: 100000, methodCode: "CASH" }
            : undefined,
      });
      await api.updateOrderStatus({ orderId: o.id, status: "DELIVERED" });
      return {
        id: o.id,
        totalMinor,
        product: p.name,
        paymentId: paid.payments[0]!.id,
      };
    },
    { customerName, method, amount },
  );
}
async function reports(session1: string, session2: string) {
  return page.evaluate(
    async (ids) => {
      const api = window.gastronomy;
      const ranges = await Promise.all(
        [
          ["2026-10-06", "2026-10-06"],
          ["2026-10-07", "2026-10-07"],
          ["2026-10-06", "2026-10-07"],
        ].map(([dateFrom, dateTo]) =>
          api.getDetailedReport({ dateFrom, dateTo }),
        ),
      );
      const cash1 = await api.getCashSessionReport({
        cashSessionId: ids.session1,
      });
      const cash2 = await api.getCashSessionReport({
        cashSessionId: ids.session2,
      });
      const finance1 = await api.getFinanceReport({
        from: "2026-10-06",
        to: "2026-10-06",
      });
      const finance2 = await api.getFinanceReport({
        from: "2026-10-07",
        to: "2026-10-07",
      });
      return {
        ranges,
        cash1,
        cash2,
        finance1,
        finance2,
        dashboard: (await api.bootstrap()).dashboard,
      };
    },
    { session1, session2 },
  );
}
async function rollSession(sessionId: string) {
  await page.evaluate(async (id) => {
    const r = await window.gastronomy.getCashSessionReport({
      cashSessionId: id,
    });
    await window.gastronomy.closeCashSession({
      countedAmountMinor: r.session.expectedAmountMinor,
      closingFloatAmountMinor: 0,
    });
  }, sessionId);
}

test("US17 reports attribute refund and API repayment to immutable cash sessions", async () => {
  await launch("refund-repay");
  try {
    const s1 = await startSession(1000000, D1);
    const sale = await makeOrder("US17 attribution", "CASH", 1500000);
    await page.evaluate(
      (x) =>
        window.gastronomy.refundPayment({
          orderId: x.orderId,
          paymentId: x.paymentId,
          amountMinor: 100000,
          reason: "US17 cross-day partial refund",
          authorizerPin: "1234",
        }),
      { orderId: sale.id, paymentId: sale.paymentId },
    );
    const firstCash = await page.evaluate(
      (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
      s1.id,
    );
    await rollSession(s1.id);
    const s2 = await startSession(0, D2);
    await page.reload();
    await page.getByRole("link", { name: "Pedidos", exact: true }).click();
    const oldOrderCount = await page
      .getByRole("row")
      .filter({ hasText: "US17 attribution" })
      .count();
    await nativeCapture("us17-repay-route-and-new-session.png");
    // API only: current UI does not surface this prior-day unpaid order for recobro.
    const repaid = await page.evaluate(
      (id) =>
        window.gastronomy.payOrder({
          orderId: id,
          payments: [{ methodCode: "CASH", amountMinor: 100000 }],
        }),
      sale.id,
    );
    const beforeQueries = await ledger();
    const after = await reports(s1.id, s2.id);
    expect(await ledger()).toEqual(beforeQueries);
    await page.reload();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ hasText: `#${s1.number}` })
      .filter({ hasText: D1 })
      .getByRole("button", { name: /Ver informe|Ver resumen/ })
      .click();
    const history = page.getByRole("dialog", {
      name: "Informe de caja",
      exact: true,
    });
    await expect(
      history.getByText("Calculando informe…", { exact: true }),
    ).toBeHidden();
    await nativeCapture("us17-reports-after-api-repayment.png");
    await expect(history).toContainText("14.000");
    const result = {
      scope: "real Electron API repayment; UI visibility checked separately",
      sale,
      firstCash,
      oldOrderCount,
      repaid,
      after,
    };
    await writeFile(
      join(evidenceDir, "us17-payment-session-attribution.json"),
      JSON.stringify(result, null, 2),
    );
    expect(sale.totalMinor).toBe(1500000);
    expect(firstCash.totals.salesMinor).toBe(1400000);
    expect(oldOrderCount).toBe(0);
    expect(after.cash1.totals.salesMinor).toBe(1400000);
    expect(after.cash2.totals.salesMinor).toBe(100000);
    expect(after.ranges[0]!.salesTotalMinor).toBe(1400000);
    expect(after.ranges[1]!.salesTotalMinor).toBe(100000);
    expect(after.ranges[2]!.salesTotalMinor).toBe(1500000);
    expect(after.ranges[0]!.orderCount).toBe(1);
    expect(after.ranges[1]!.orderCount).toBe(1);
    expect(after.ranges[2]!.orderCount).toBe(1);
    expect(
      after.ranges[0]!.byProduct[0]!.quantity +
        after.ranges[1]!.byProduct[0]!.quantity,
    ).toBeCloseTo(1, 2);
    expect(after.ranges[2]!.byProduct[0]!.quantity).toBe(1);
    expect(
      after.cash1.byProduct[0]!.quantity + after.cash2.byProduct[0]!.quantity,
    ).toBeCloseTo(1, 10);
    expect(after.finance1.salesMinor).toBe(1400000);
    expect(after.finance2.salesMinor).toBe(0);
    expect(after.dashboard.salesTotalMinor).toBe(100000);
    expect(after.cash1.orders.find((o) => o.id === sale.id)?.paidMinor).toBe(
      1400000,
    );
    expect(after.cash2.orders.find((o) => o.id === sale.id)?.paidMinor).toBe(
      100000,
    );
    expect(
      after.ranges[0]!.byPaymentMethod.find((x) => x.code === "CASH")
        ?.amountMinor,
    ).toBe(1400000);
    expect(
      after.ranges[1]!.byPaymentMethod.find((x) => x.code === "CASH")
        ?.amountMinor,
    ).toBe(100000);
    expect(
      after.ranges[2]!.byPaymentMethod.find((x) => x.code === "CASH")
        ?.amountMinor,
    ).toBe(1500000);
    for (const k of [
      "byType",
      "byProduct",
      "byCategory",
      "byHour",
      "byWaiter",
    ] as const) {
      expect(after.ranges[0]![k].reduce((n, x) => n + x.amountMinor, 0)).toBe(
        1400000,
      );
      expect(after.ranges[1]![k].reduce((n, x) => n + x.amountMinor, 0)).toBe(
        100000,
      );
      expect(after.ranges[2]![k].reduce((n, x) => n + x.amountMinor, 0)).toBe(
        1500000,
      );
    }
  } finally {
    await cleanup();
  }
});

test("US17 mixed tender, change and recobro preserve original payment attribution", async () => {
  await launch("mixed-change");
  try {
    const s1 = await startSession(2400000, D1);
    const sale = await makeOrder("US17 mixed", "CASH", 1600000);
    // Real over-tender/change fixture: CASH16000 less CASH1000 change.
    await page.evaluate(
      (x) =>
        window.gastronomy.refundPayment({
          orderId: x.orderId,
          paymentId: x.paymentId,
          amountMinor: 100000,
          reason: "US17 mixed refund",
          authorizerPin: "1234",
        }),
      { orderId: sale.id, paymentId: sale.paymentId },
    );
    await rollSession(s1.id);
    const s2 = await startSession(0, D2);
    await page.evaluate(
      (id) =>
        window.gastronomy.payOrder({
          orderId: id,
          payments: [{ methodCode: "TRANSFER", amountMinor: 100000 }],
        }),
      sale.id,
    );
    const after = await reports(s1.id, s2.id);
    const result = {
      sale,
      after,
      note: "Real CASH16000 tender/CASH1000 change before refund and new TRANSFER1000",
    };
    await nativeCapture("us17-mixed-tender-reports.png");
    await writeFile(
      join(evidenceDir, "us17-mixed-tender.json"),
      JSON.stringify(result, null, 2),
    );
    expect(after.cash1.totals.salesMinor).toBe(1400000);
    expect(after.cash2.totals.salesMinor).toBe(100000);
    expect(after.ranges[0]!.salesTotalMinor).toBe(1400000);
    expect(after.ranges[1]!.salesTotalMinor).toBe(100000);
    expect(after.ranges[2]!.salesTotalMinor).toBe(1500000);
    expect(
      after.ranges[0]!.byPaymentMethod.find((x) => x.code === "CASH")
        ?.amountMinor,
    ).toBe(1400000);
    expect(
      after.ranges[1]!.byPaymentMethod.find((x) => x.code === "TRANSFER")
        ?.amountMinor,
    ).toBe(100000);
    const filtered = await page.evaluate(
      async (ids) => ({
        d1cash: await window.gastronomy.getCashSessionReport({
          cashSessionId: ids.a,
          paymentMethodCode: "CASH",
        }),
        d1transfer: await window.gastronomy.getCashSessionReport({
          cashSessionId: ids.a,
          paymentMethodCode: "TRANSFER",
        }),
        d2transfer: await window.gastronomy.getCashSessionReport({
          cashSessionId: ids.b,
          paymentMethodCode: "TRANSFER",
        }),
      }),
      { a: s1.id, b: s2.id },
    );
    expect(filtered.d1cash.totals.salesMinor).toBe(1400000);
    expect(filtered.d1transfer.totals.salesMinor).toBe(0);
    expect(filtered.d2transfer.totals.salesMinor).toBe(100000);
  } finally {
    await cleanup();
  }
});

test("US17 only positive net sale orders count; non-sale drawer movement stays outside sales", async () => {
  await launch("controls");
  try {
    const s1 = await startSession(1000000, D1);
    const sale = await makeOrder("US17 control", "CASH", 1500000);
    await page.evaluate(() =>
      window.gastronomy.registerCashMovement({
        type: "INCOME",
        amountMinor: 300000,
        reason: "US17 external deposit",
        paymentMethodCode: "CASH",
      }),
    );
    const d1 = await page.evaluate(
      async (date) => ({
        report: await window.gastronomy.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
        cash: await window.gastronomy.getCashSessionReport({
          cashSessionId: (await window.gastronomy.bootstrap()).cashSession!.id,
        }),
      }),
      D1,
    );
    await rollSession(s1.id);
    const s2 = await startSession(0, D2);
    await page.evaluate(() =>
      window.gastronomy.registerCashMovement({
        type: "INCOME",
        amountMinor: 300000,
        reason: "US17 noncash manual income",
        paymentMethodCode: "TRANSFER",
      }),
    );
    const d2 = await page.evaluate(
      async (date) => ({
        report: await window.gastronomy.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
        cash: await window.gastronomy.getCashSessionReport({
          cashSessionId: (await window.gastronomy.bootstrap()).cashSession!.id,
        }),
      }),
      D2,
    );
    const out = { sale, d1, d2 };
    await nativeCapture("us17-nonsale-movement-controls.png");
    await writeFile(
      join(evidenceDir, "us17-controls.json"),
      JSON.stringify(out, null, 2),
    );
    expect(d1.report.salesTotalMinor).toBe(1500000);
    expect(d1.report.orderCount).toBe(1);
    expect(
      d1.report.byPaymentMethod.find((x) => x.code === "CASH")?.amountMinor,
    ).toBe(1500000);
    expect(d1.cash.session.expectedAmountMinor).toBe(2800000);
    expect(d2.report.salesTotalMinor).toBe(0);
    expect(d2.report.orderCount).toBe(0);
    expect(d2.cash.session.expectedAmountMinor).toBe(0);
  } finally {
    await cleanup();
  }
});

test("US17 next-day refund and repayment keep refund date while drawer nets in D2", async () => {
  await launch("refund-next-day");
  try {
    const s1 = await startSession(1000000, D1);
    const sale = await makeOrder("US17 refund next day", "CASH", 1500000);
    await rollSession(s1.id);
    const s2 = await startSession(1000000, D2);
    await page.evaluate(
      (x) =>
        window.gastronomy.refundPayment({
          orderId: x.orderId,
          paymentId: x.paymentId,
          amountMinor: 100000,
          reason: "US17 next-day refund",
          authorizerPin: "1234",
        }),
      { orderId: sale.id, paymentId: sale.paymentId },
    );
    const afterRefund = await page.evaluate(
      (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
      s2.id,
    );
    await page.evaluate(
      (id) =>
        window.gastronomy.payOrder({
          orderId: id,
          payments: [{ methodCode: "CASH", amountMinor: 100000 }],
        }),
      sale.id,
    );
    const after = await reports(s1.id, s2.id);
    const led = await ledger();
    const result = { sale, afterRefund, after, led };
    await nativeCapture("us17-next-day-refund-repay.png");
    await writeFile(
      join(evidenceDir, "us17-next-day-refund.json"),
      JSON.stringify(result, null, 2),
    );
    expect(afterRefund.session.cashRefundMinor).toBe(100000);
    expect(after.cash1.totals.salesMinor).toBe(1400000);
    expect(after.cash2.totals.salesMinor).toBe(100000);
    expect(after.ranges[0]!.salesTotalMinor).toBe(1400000);
    expect(after.ranges[1]!.salesTotalMinor).toBe(100000);
    expect(after.cash2.session.expectedAmountMinor).toBe(1000000);
    expect(led.payments).toHaveLength(2);
    expect(led.refunds).toHaveLength(1);
  } finally {
    await cleanup();
  }
});

test("US17 same-session recobro cannot erase a larger earlier change", async () => {
  await launch("large-change");
  try {
    const s = await startSession(1000000, D1);
    const o = await page.evaluate(async () => {
      const api = window.gastronomy,
        b = await api.bootstrap(),
        p = b.products.find((x) => x.code === "MUZG")!;
      let o = await api.createOrder({
        type: "TAKEAWAY",
        customerName: "US17 larger change",
        customerPhone: "1155551709",
      });
      await api.addOrderItem({ orderId: o.id, productId: p.id });
      await api.confirmOrder({ orderId: o.id });
      o = await api.payOrder({
        orderId: o.id,
        payments: [{ methodCode: "CASH", amountMinor: 2000000 }],
        change: { amountMinor: 500000, methodCode: "CASH" },
      });
      await api.refundPayment({
        orderId: o.id,
        paymentId: o.payments[0]!.id,
        amountMinor: 100000,
        reason: "Same-day correction",
        authorizerPin: "1234",
      });
      return api.payOrder({
        orderId: o.id,
        payments: [{ methodCode: "CASH", amountMinor: 100000 }],
      });
    });
    const before = await ledger();
    const cash = await page.evaluate(
      (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
      s.id,
    );
    const detailed = await page.evaluate(() =>
      window.gastronomy.getDetailedReport({
        dateFrom: "2026-10-06",
        dateTo: "2026-10-06",
      }),
    );
    await writeFile(
      join(evidenceDir, "us17-large-change.json"),
      JSON.stringify({ o, cash, detailed, before }, null, 2),
    );
    expect(cash.totals.salesMinor).toBe(1500000);
    expect(detailed.salesTotalMinor).toBe(1500000);
    expect(
      detailed.byPaymentMethod.find((x) => x.code === "CASH")?.amountMinor,
    ).toBe(1500000);
    expect(await ledger()).toEqual(before);
  } finally {
    await cleanup();
  }
});

test("US17 change in a different method reconciles tender and returned method", async () => {
  await launch("cross-change");
  try {
    const s = await startSession(1000000, D1);
    await page.evaluate(async () => {
      const api = window.gastronomy,
        b = await api.bootstrap(),
        p = b.products.find((x) => x.code === "MUZG")!;
      let o = await api.createOrder({
        type: "TAKEAWAY",
        customerName: "US17 cross method",
        customerPhone: "1155551710",
      });
      await api.addOrderItem({ orderId: o.id, productId: p.id });
      await api.confirmOrder({ orderId: o.id });
      await api.payOrder({
        orderId: o.id,
        payments: [{ methodCode: "TRANSFER", amountMinor: 2000000 }],
        change: { amountMinor: 500000, methodCode: "CASH" },
      });
    });
    const before = await ledger();
    const cash = await page.evaluate(
      (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
      s.id,
    );
    const detailed = await page.evaluate(() =>
      window.gastronomy.getDetailedReport({
        dateFrom: "2026-10-06",
        dateTo: "2026-10-06",
      }),
    );
    const dashboard = await page.evaluate(
      async () => (await window.gastronomy.bootstrap()).dashboard,
    );
    await writeFile(
      join(evidenceDir, "us17-cross-method-change.json"),
      JSON.stringify({ cash, detailed, dashboard, before }, null, 2),
    );
    expect(cash.totals.salesMinor).toBe(1500000);
    expect(cash.session.expectedAmountMinor).toBe(500000);
    expect(
      cash.session.salesByPaymentMethod.reduce((n, m) => n + m.amountMinor, 0),
    ).toBe(1500000);
    expect(cash.byPaymentMethod.reduce((n, m) => n + m.amountMinor, 0)).toBe(
      1500000,
    );
    expect(detailed.salesTotalMinor).toBe(1500000);
    expect(
      detailed.byPaymentMethod.reduce((s, p) => s + p.amountMinor, 0),
    ).toBe(1500000);
    expect(dashboard.salesTotalMinor).toBe(1500000);
    expect(
      dashboard.byPaymentMethod.reduce((s, p) => s + p.amountMinor, 0),
    ).toBe(1500000);
    expect(await ledger()).toEqual(before);
  } finally {
    await cleanup();
  }
});

test("US17 deposit, account receipt and driver cash retain their original economic/cash bases", async () => {
  await launch("account-driver-controls");
  try {
    const s1 = await startSession(1000000, D1);
    const fx = await page.evaluate(async () => {
      const api = window.gastronomy,
        b = await api.bootstrap(),
        p = b.products.find((x) => x.code === "MUZG")!;
      async function sale(
        name: string,
        type: "TAKEAWAY" | "DELIVERY" = "TAKEAWAY",
        driverUserId?: string,
      ) {
        let o = await api.createOrder({
          type,
          customerName: name,
          customerPhone: "1155551730",
          deliveryAddress:
            type === "DELIVERY" ? "US17 controls 123" : undefined,
          driverUserId,
        });
        await api.addOrderItem({ orderId: o.id, productId: p.id });
        return api.confirmOrder({ orderId: o.id });
      }
      const deposit = await sale("US17 deposit");
      await api.applyOrderDeposit({
        orderId: deposit.id,
        depositMinor: 300000,
        authorizerPin: "1234",
      });
      await api.payOrder({
        orderId: deposit.id,
        payments: [{ methodCode: "CASH", amountMinor: 1200000 }],
      });
      await api.updateOrderStatus({ orderId: deposit.id, status: "DELIVERED" });
      const customer = await api.createCustomer({
        name: "US17 account",
        phone: "1155551731",
      });
      const account = await sale("US17 account");
      await api.payOrder({
        orderId: account.id,
        customerId: customer.id,
        payments: [{ methodCode: "ACCOUNT", amountMinor: 1500000 }],
      });
      await api.updateOrderStatus({ orderId: account.id, status: "DELIVERED" });
      const driver = await api.createDriver({
        fullName: "US17 driver",
        authorizerPin: "1234",
      });
      const delivery = await sale("US17 driver cash", "DELIVERY", driver.id);
      await api.payOrder({
        orderId: delivery.id,
        collectedByDriver: true,
        payments: [{ methodCode: "CASH", amountMinor: 1500000 }],
      });
      await api.updateOrderStatus({
        orderId: delivery.id,
        status: "DELIVERED",
      });
      return { deposit, account, delivery, customer };
    });
    const d1 = await page.evaluate(
      (id) => window.gastronomy.getCashSessionReport({ cashSessionId: id }),
      s1.id,
    );
    await rollSession(s1.id);
    const s2 = await startSession(0, D2);
    await page.evaluate(
      (customerId) =>
        window.gastronomy.settleCustomerAccount({
          customerId,
          amountMinor: 600000,
          methodCode: "CASH",
          idempotencyKey: crypto.randomUUID(),
        }),
      fx.customer.id,
    );
    const before = await ledger();
    const after = await reports(s1.id, s2.id);
    await writeFile(
      join(evidenceDir, "us17-account-driver-deposit.json"),
      JSON.stringify({ fx, d1, after, before }, null, 2),
    );
    expect(d1.totals.salesMinor).toBe(4200000);
    expect(d1.session.expectedAmountMinor).toBe(2200000);
    expect(after.cash1.totals.salesMinor).toBe(4200000);
    expect(after.cash2.totals.salesMinor).toBe(0);
    expect(after.cash2.session.expectedAmountMinor).toBe(600000);
    expect(after.ranges[1]!.salesTotalMinor).toBe(0);
    expect(after.ranges[0]!.salesTotalMinor).toBe(4200000);
    expect(after.ranges[0]!.orderCount).toBe(3);
    expect(await ledger()).toEqual(before);
  } finally {
    await cleanup();
  }
});
