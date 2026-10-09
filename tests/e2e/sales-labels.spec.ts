import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us02-fix-2026-10-06",
);
let app: ElectronApplication;
let page: Page;
let profile: string;
test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us02-labels-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (
    dirname(resolve(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-us02-labels-")
  )
    throw new Error("Unsafe disposable profile");
  await rm(profile, { recursive: true, force: true });
});

for (const width of [1280, 1100, 1366]) {
  for (const scenario of [
    "empty",
    "unpaid",
    "partial",
    "cash",
    "account",
    "receipt",
    "refund",
    "deposit",
  ] as const) {
    if (width === 1366 && scenario !== "unpaid" && scenario !== "account")
      continue;
    test(`distinct sales bases for ${scenario} at ${width}px`, async () => {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0]!.setSize(
            width,
            width === 1100 ? 680 : width === 1366 ? 768 : 820,
          ),
        width,
      );
      const snapshot = await page.evaluate(async (scenario) => {
        const api = window.gastronomy;
        const session = await api.openCashSession({ openingAmountMinor: 0 });
        const data = await api.bootstrap();
        const date = session.businessDate;
        if (scenario !== "empty") {
          const customer = await api.createCustomer({
            name: "US02 cliente",
            phone: "1155000200",
          });
          const product = data.products.find(
            (product) => product.code === "MUZG",
          )!;
          await api.setFinanceProductCost({
            productId: product.id,
            unitCostMinor: 300_000,
          });
          const draft = await api.createOrder({
            type: "TAKEAWAY",
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
          });
          await api.addOrderItem({ orderId: draft.id, productId: product.id });
          const order = await api.confirmOrder({ orderId: draft.id });
          if (scenario === "deposit")
            await api.applyOrderDeposit({
              orderId: order.id,
              depositMinor: 300_000,
              authorizerPin: "1234",
            });
          if (
            ["partial", "cash", "account", "receipt", "refund"].includes(
              scenario,
            )
          ) {
            if (scenario === "partial") {
              let rejected = false;
              try {
                await api.payOrder({
                  orderId: order.id,
                  payments: [{ methodCode: "CASH", amountMinor: 500_000 }],
                  idempotencyKey: crypto.randomUUID(),
                });
              } catch (error) {
                rejected = String(error).includes("saldo pendiente");
              }
              if (!rejected)
                throw new Error(
                  "The existing full-balance payment guard must remain intact",
                );
            }
            const paid = await api.payOrder({
              orderId: order.id,
              customerId: customer.id,
              payments: [
                {
                  methodCode: ["account", "receipt"].includes(scenario)
                    ? "ACCOUNT"
                    : "CASH",
                  amountMinor: order.totalMinor,
                },
              ],
              idempotencyKey: crypto.randomUUID(),
            });
            // The existing API requires paying the full balance. A remaining
            // partially-paid state is produced by its real refund flow.
            if (scenario === "refund" || scenario === "partial")
              await api.refundPayment({
                orderId: order.id,
                paymentId: paid.payments[0]!.id,
                amountMinor: scenario === "partial" ? 1_000_000 : 300_000,
                reason: "US02 devolución aislada",
                authorizerPin: "1234",
                idempotencyKey: crypto.randomUUID(),
              });
            if (scenario === "receipt")
              await api.settleCustomerAccount({
                customerId: customer.id,
                amountMinor: order.totalMinor,
                methodCode: "CASH",
                idempotencyKey: crypto.randomUUID(),
              });
          }
        }
        return {
          date,
          dashboard: await api.getDashboard(),
          finance: await api.getFinanceReport({ from: date, to: date }),
          cash: (await api.bootstrap()).cashSession,
        };
      }, scenario);
      const expected = {
        empty: [0, 0, 0],
        unpaid: [0, 1_500_000, 0],
        partial: [500_000, 500_000, 500_000],
        cash: [1_500_000, 1_500_000, 1_500_000],
        account: [1_500_000, 1_500_000, 0],
        receipt: [1_500_000, 1_500_000, 1_500_000],
        refund: [1_200_000, 1_200_000, 1_200_000],
        deposit: [0, 1_500_000, 0],
      }[scenario];
      expect([
        snapshot.dashboard.salesTotalMinor,
        snapshot.finance.salesMinor,
        snapshot.cash!.expectedAmountMinor,
      ]).toEqual(expected);
      await page.reload();
      const dashboardCard = page
        .getByText("Pagos registrados", { exact: true })
        .locator("../..");
      await expect(dashboardCard).toBeVisible();
      await expect(dashboardCard).toContainText(formatMoney(expected[0]!));
      await expect(dashboardCard).toContainText("día comercial");
      await expect(dashboardCard).toContainText(
        `${snapshot.dashboard.orderCount} pedido${snapshot.dashboard.orderCount === 1 ? "" : "s"} con pago`,
      );
      await expect(dashboardCard).toContainText(
        "Incluye pagos parciales y cuenta corriente",
      );
      await expect(
        page.getByRole("heading", {
          name: "Pedidos con pagos registrados",
          exact: true,
        }),
      ).toBeVisible();
      if (expected[0])
        await expect(
          page.getByRole("columnheader", {
            name: "Pago registrado",
            exact: true,
          }),
        ).toBeVisible();
      else
        await expect(
          page.getByText("Todavía no hay pagos registrados en esta caja.", {
            exact: true,
          }),
        ).toBeVisible();
      const textBounds = await dashboardCard.evaluate((card) =>
        [...card.querySelectorAll("p")].map((paragraph) => {
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const ink = range.getBoundingClientRect();
          const box = paragraph.getBoundingClientRect();
          return {
            text: paragraph.textContent,
            fits: ink.left >= box.left - 1 && ink.right <= box.right + 1,
            scrollFits: paragraph.scrollWidth <= paragraph.clientWidth + 1,
          };
        }),
      );
      for (const item of textBounds)
        expect(item.fits && item.scrollFits, item.text ?? "card text").toBe(
          true,
        );
      await dashboardCard.screenshot({
        path: join(out, `${scenario}-${width}-summary.png`),
      });
      await page.getByRole("link", { name: "Finanzas", exact: true }).click();
      await page.getByLabel("Desde", { exact: true }).fill(snapshot.date);
      await page.getByLabel("Hasta", { exact: true }).fill(snapshot.date);
      const financeCard = page
        .getByText("Ventas confirmadas", { exact: true })
        .locator("..");
      await expect(financeCard).toBeVisible();
      await expect(financeCard.locator("p").nth(1)).toHaveText(
        formatMoney(expected[1]!),
      );
      await expect(financeCard).toContainText("Incluye pendientes de cobro");
      await expect(financeCard).toContainText(
        `Devoluciones descontadas: ${formatMoney(snapshot.finance.refundsMinor)}`,
      );
      await financeCard.screenshot({
        path: join(out, `${scenario}-${width}-finance.png`),
      });
      await page.screenshot({
        path: join(out, `${scenario}-${width}-finance-page.png`),
        fullPage: true,
      });
      const after = await page.evaluate(
        async (date) => ({
          dashboard: await window.gastronomy.getDashboard(),
          finance: await window.gastronomy.getFinanceReport({
            from: date,
            to: date,
          }),
          cash: (await window.gastronomy.bootstrap()).cashSession,
        }),
        snapshot.date,
      );
      expect(after).toEqual({
        dashboard: snapshot.dashboard,
        finance: snapshot.finance,
        cash: snapshot.cash,
      });
      await writeFile(
        join(out, `${scenario}-${width}.json`),
        JSON.stringify(
          {
            scenario,
            width,
            summaryMinor: expected[0],
            financeMinor: expected[1],
            cashMinor: expected[2],
            figuresUnchanged: true,
            realSqliteAndIpc: true,
            textBounds,
          },
          null,
          2,
        ),
      );
    });
  }
}
