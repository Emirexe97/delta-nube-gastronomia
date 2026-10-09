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
  "docs/qa/evidence/system-usability-us05-fix-2026-10-06",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us05-open-orders-"));
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
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us05-open-orders-")
    )
      throw new Error("Unsafe profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});
const states = [
  "empty",
  "table-only",
  "takeaway-draft",
  "delivery-confirmed",
  "paid-ready",
  "mixed-terminal",
] as const;
for (const width of [1280, 1100, 1366])
  for (const state of states) {
    test(`open order scope ${state} at ${width}px`, async () => {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
        width,
      );
      const fixture = await page.evaluate(async (state) => {
        const api = window.gastronomy;
        await api.openCashSession({ openingAmountMinor: 0 });
        const boot = await api.bootstrap();
        const product = boot.products.find(
          (product) => product.code === "MUZG",
        )!;
        const expectedNumbers: number[] = [];
        async function create(
          type: "DINE_IN" | "TAKEAWAY" | "DELIVERY",
          confirmed = true,
        ) {
          const order = await api.createOrder({
            type,
            tableId:
              type === "DINE_IN"
                ? boot.tables.find((table) => table.active)!.id
                : undefined,
            customerName: "US05 aislado",
            customerPhone: "1155000500",
            deliveryAddress:
              type === "DELIVERY" ? "Calle de prueba 123" : undefined,
          });
          await api.addOrderItem({ orderId: order.id, productId: product.id });
          return confirmed
            ? api.confirmOrder({ orderId: order.id })
            : (await api.bootstrap()).orders.find(
                (candidate) => candidate.id === order.id,
              )!;
        }
        if (state === "table-only" || state === "mixed-terminal")
          await create("DINE_IN");
        if (state === "takeaway-draft" || state === "mixed-terminal")
          expectedNumbers.push((await create("TAKEAWAY", false)).number);
        if (state === "delivery-confirmed" || state === "mixed-terminal")
          expectedNumbers.push((await create("DELIVERY")).number);
        if (state === "paid-ready") {
          const order = await create("TAKEAWAY");
          await api.payOrder({
            orderId: order.id,
            payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
          });
          await api.updateOrderStatus({ orderId: order.id, status: "READY" });
          expectedNumbers.push(order.number);
        }
        if (state === "mixed-terminal") {
          const cancelled = await create("TAKEAWAY");
          await api.cancelOrder({
            orderId: cancelled.id,
            reason: "US05 cancelado de prueba",
            authorizerPin: "1234",
          });
          const delivered = await create("TAKEAWAY");
          await api.completeOrder({
            orderId: delivered.id,
            finalStatus: "DELIVERED",
            payments: [
              { methodCode: "CASH", amountMinor: delivered.totalMinor },
            ],
          });
        }
        const data = await api.bootstrap();
        const tableOrders = data.orders.filter(
          (order) =>
            order.type === "DINE_IN" &&
            order.paymentStatus !== "PAID" &&
            !["DELIVERED", "CANCELLED"].includes(order.operationalStatus),
        );
        return {
          data,
          expectedNumbers,
          tableTotal: tableOrders.reduce(
            (sum, order) => sum + order.totalMinor - order.paidMinor,
            0,
          ),
          tableCount: tableOrders.length,
        };
      }, state);
      expect(fixture.expectedNumbers.length).toBe(
        state === "empty" || state === "table-only"
          ? 0
          : state === "mixed-terminal"
            ? 2
            : 1,
      );
      expect(fixture.tableCount).toBe(
        state === "table-only" || state === "mixed-terminal" ? 1 : 0,
      );
      await page.reload();
      await page.getByRole("link", { name: "Resumen", exact: true }).click();
      await expect(page.locator(".panel-enter")).toHaveCSS("opacity", "1");
      const stat = page
        .getByText("Retiros y envíos abiertos", { exact: true })
        .locator("..");
      await expect(stat.locator("p").nth(1)).toHaveText(
        String(fixture.expectedNumbers.length),
      );
      await expect(stat).toContainText(
        fixture.expectedNumbers.length
          ? "requieren seguimiento"
          : "sin pendientes de entrega",
      );
      expect(
        await stat.locator("p").evaluateAll((paragraphs) =>
          paragraphs.every((p) => {
            const range = document.createRange();
            range.selectNodeContents(p);
            const ink = range.getBoundingClientRect();
            const box = p.getBoundingClientRect();
            return (
              ink.left >= box.left - 1 &&
              ink.right <= box.right + 1 &&
              p.scrollWidth <= p.clientWidth + 1
            );
          }),
        ),
      ).toBe(true);
      await expect(
        page.getByText("Mesas por cobrar", { exact: true }).locator(".."),
      ).toContainText(formatMoney(fixture.tableTotal));
      const heading = page.getByRole("heading", {
        name: "Retiros y envíos en curso",
        exact: true,
      });
      const panel = heading.locator("..").locator("..").locator("..");
      await expect(
        panel.getByRole("link", { name: "Ver todos" }),
      ).toHaveAttribute("href", /#\/pedidos$/);
      if (fixture.expectedNumbers.length) {
        await expect(panel.locator("tbody tr")).toHaveCount(
          fixture.expectedNumbers.length,
        );
        for (const number of fixture.expectedNumbers)
          await expect(
            panel.getByText(`#${number}`, { exact: true }),
          ).toBeVisible();
      } else {
        await expect(
          panel.getByText("No hay retiros ni envíos abiertos", { exact: true }),
        ).toBeVisible();
        await expect(panel).toContainText(
          "F3 crea un pedido para retirar · F4 crea un envío",
        );
      }
      await expect(
        page.getByText("Pedidos abiertos", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("operación al día", { exact: true }),
      ).toHaveCount(0);
      const after = await page.evaluate(() => window.gastronomy.bootstrap());
      expect(after.orders).toEqual(fixture.data.orders);
      expect(after.cashSession).toEqual(fixture.data.cashSession);
      expect(after.dashboard).toEqual(fixture.data.dashboard);
      await page.screenshot({
        path: join(out, `${state}-${width}.png`),
        fullPage: true,
      });
      await writeFile(
        join(out, `${state}-${width}.json`),
        JSON.stringify(
          {
            state,
            width,
            expectedCount: fixture.expectedNumbers.length,
            tableCount: fixture.tableCount,
            unchanged: true,
            realSqliteAndIpc: true,
          },
          null,
          2,
        ),
      );
    });
  }
