import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us19-fix-2026-10-05",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function launch(tag: string) {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), `gastronomy-us19-fix-${tag}-`));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 1_000_000 }),
  );
  await page.reload();
}
async function cleanup() {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
  });
  await app?.close();
  if (profile) {
    if (
      !resolve(profile).startsWith(resolve(tmpdir()) + "\\gastronomy-us19-fix-")
    )
      throw new Error("Unsafe disposable profile path");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
}
test("Finanzas descuenta el envío una vez en ambos circuitos sin alterar caja", async () => {
  const cases: any[] = [];
  for (const mode of ["driver-retains-fee", "business-pays-fee"] as const) {
    await launch(`us19-${mode}`);
    try {
      const fx = await page.evaluate(async (mode) => {
        const api = window.gastronomy;
        const data = await api.bootstrap();
        await api.saveSettings({
          ...data.settings,
          deliverySettlementEnabled: true,
          deliveryFeeBelongsToDriver: true,
          deliveryDriverPaymentMode: "ACCUMULATED",
        });
        const food = data.products.find((x) => x.code === "MUZG")!;
        await api.setFinanceProductCost({
          productId: food.id,
          unitCostMinor: 300_000,
        });
        const driver = await api.createDriver({
          fullName: `US19 ${mode}`,
          authorizerPin: "1234",
        });
        const draft = await api.createOrder({
          type: "DELIVERY",
          customerName: `US19 ${mode}`,
          customerPhone: "1155551900",
          deliveryAddress: "Audit fixture",
          deliveryFeeMinor: 250_000,
          driverUserId: driver.id,
        });
        await api.addOrderItem({ orderId: draft.id, productId: food.id });
        const order = await api.confirmOrder({ orderId: draft.id });
        await api.payOrder({
          orderId: order.id,
          collectedByDriver: mode === "driver-retains-fee",
          payments: [
            {
              methodCode: mode === "driver-retains-fee" ? "CASH" : "TRANSFER",
              amountMinor: order.totalMinor,
            },
          ],
        });
        await api.updateOrderStatus({ orderId: order.id, status: "DELIVERED" });
        const date = data.cashSession!.businessDate;
        const report = await api.getFinanceReport({ from: date, to: date });
        const bootstrap = await api.bootstrap();
        return {
          mode,
          date,
          orderId: order.id,
          number: order.number,
          totalMinor: order.totalMinor,
          report: {
            salesMinor: report.salesMinor,
            cogsMinor: report.cogsMinor,
            deliveryCostsMinor: report.deliveryCostsMinor,
            expensesMinor: report.expensesMinor,
            profitMinor: report.estimatedOperatingProfitMinor,
          },
          ledger: bootstrap.deliveryLedger
            .filter((x) => x.orderId === order.id)
            .map((x) => ({
              direction: x.direction,
              amountDueMinor: x.amountDueMinor,
              status: x.status,
            })),
          cash: bootstrap.cashSession?.expectedAmountMinor,
        };
      }, mode);
      await page.reload();
      // Settle the real obligation through Repartidores UI, not a fabricated expense.
      await page
        .getByRole("link", { name: "Repartidores", exact: true })
        .click();
      await page
        .getByRole("checkbox", {
          name: `Seleccionar movimiento del pedido ${fx.number}`,
          exact: true,
        })
        .check();
      await page
        .getByRole("button", {
          name:
            mode === "driver-retains-fee"
              ? /Registrar rendición del repartidor/
              : /Pagar envío/,
        })
        .click();
      const review = page.getByRole("dialog", {
        name: "Revisar pago o rendición",
        exact: true,
      });
      await review
        .getByLabel("PIN de autorización", { exact: true })
        .fill("1234");
      await review
        .getByRole("button", { name: "Revisar liquidación", exact: true })
        .click();
      await page
        .getByRole("dialog", {
          name: "Confirmar movimiento de caja",
          exact: true,
        })
        .getByRole("button", { name: "Confirmar movimiento", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", {
          name: "Confirmar movimiento de caja",
          exact: true,
        }),
      ).not.toBeVisible();
      const settled = await page.evaluate(
        async ({ date, id }) => {
          const report = await window.gastronomy.getFinanceReport({
            from: date,
            to: date,
          });
          const boot = await window.gastronomy.bootstrap();
          return {
            report: {
              salesMinor: report.salesMinor,
              cogsMinor: report.cogsMinor,
              deliveryCostsMinor: report.deliveryCostsMinor,
              expensesMinor: report.expensesMinor,
              profitMinor: report.estimatedOperatingProfitMinor,
            },
            ledger: boot.deliveryLedger
              .filter((x) => x.orderId === id)
              .map((x) => ({
                direction: x.direction,
                amountDueMinor: x.amountDueMinor,
                status: x.status,
              })),
            cash: boot.cashSession!.expectedAmountMinor,
          };
        },
        { date: fx.date, id: fx.orderId },
      );
      expect(settled.ledger[0]?.status).toBe("SETTLED");
      await page.getByRole("link", { name: "Finanzas", exact: true }).click();
      await expect(
        page
          .locator("main")
          .getByRole("heading", { name: "Finanzas", exact: true })
          .last(),
      ).toBeVisible();
      await expect(
        page.getByText(/Comida:.*3.000.*Reparto:.*2.500/),
      ).toBeVisible();
      const dom = await page.locator("body").innerText();
      expect(fx.report.profitMinor).toBe(1_200_000);
      expect(fx.report.deliveryCostsMinor).toBe(250_000);
      expect(settled.report.profitMinor).toBe(1_200_000);
      expect(settled.report.deliveryCostsMinor).toBe(250_000);
      expect(settled.report.expensesMinor).toBe(0);
      expect(settled.cash).toBe(
        mode === "driver-retains-fee" ? 2_500_000 : 750_000,
      );
      await page.screenshot({
        path: join(out, `us19-finanzas-${mode}.png`),
        fullPage: true,
      });
      cases.push({
        ...fx,
        beforeSettlement: {
          report: fx.report,
          cash: fx.cash,
          ledger: fx.ledger,
        },
        ...settled,
        ui: {
          settlementPerformedThroughUI: true,
          expectedVisibleLabels: [
            "Ventas confirmadas",
            "Costo vendido",
            "Resultado operativo estimado",
          ],
          bodyContainsNumbers: [
            "5.500",
            "2.500",
            "12.000",
            "17.500",
            "3.000",
          ].filter((x) => dom.includes(x)),
          bodyTextCaptured: true,
          visualReadability:
            "No se afirma legibilidad visual/contraste: reportes previos documentaron texto blanco sobre fondo blanco en valores financieros. Captura sólo evidencia actual.",
        },
      });
    } finally {
      await cleanup();
    }
  }
  expect(cases.map((c) => c.report.profitMinor)).toEqual([
    1_200_000, 1_200_000,
  ]);
  await writeFile(
    join(out, "us19-fixed-ui-api.json"),
    JSON.stringify(cases, null, 2),
  );
});
