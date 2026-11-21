import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us06-fix-2026-10-06",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function stableScreenshot(options: Parameters<Page["screenshot"]>[0]) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  return page.screenshot(options);
}

test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us06-language-"));
  app = await launchConfiguredPos({
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
      !basename(profile).startsWith("gastronomy-us06-language-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

for (const width of [1100, 1366]) {
  test(`informes usan términos claros y auditoría conserva filtro a ${width}px`, async () => {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
      width,
    );
    const fixture = await page.evaluate(async () => {
      const api = window.gastronomy;
      const session = await api.openCashSession({
        openingAmountMinor: 100_000,
      });
      await api.registerCashMovement({
        authorizerPin: "748259",
        type: "EXPENSE",
        amountMinor: 12_500,
        reason: "US06 comprobación de gasto",
        paymentMethodCode: "CASH",
        idempotencyKey: crypto.randomUUID(),
      });
      const boot = await api.bootstrap();
      const date = boot.cashSession!.businessDate;
      const product = boot.products.find((item) => item.code === "MUZG")!;
      const driver = await api.createDriver({
        fullName: "US06 repartidor",
        authorizerPin: "748259",
      });
      const delivery = await api.createOrder({
        driverUserId: driver.id,
        type: "DELIVERY",
        customerName: "US06 envío con cargo",
        customerPhone: "1155550600",
        deliveryAddress: "Prueba US06",
        deliveryFeeMinor: 250_000,
      });
      await api.addOrderItem({ orderId: delivery.id, productId: product.id });
      const confirmed = await api.confirmOrder({ orderId: delivery.id });
      await api.payOrder({
        orderId: confirmed.id,
        collectedByDriver: false,
        payments: [
          { methodCode: "TRANSFER", amountMinor: confirmed.totalMinor },
        ],
      });
      await api.updateOrderStatus({
        orderId: confirmed.id,
        status: "DELIVERED",
      });
      return {
        sessionId: session.id,
        date,
        cashReport: await api.getCashSessionReport({
          cashSessionId: session.id,
        }),
        financeReport: await api.getFinanceReport({ from: date, to: date }),
        detailedReport: await api.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
        deliveryFeeMinor: (await api.getFinanceReport({ from: date, to: date }))
          .deliveryCostsMinor,
        audit: await api.getAuditLog({
          dateFrom: date,
          dateTo: date,
          action: "CASH_EXPENSE",
          search: "US06 comprobación de gasto",
          offset: 0,
          limit: 20,
        }),
      };
    });

    await page.reload();
    await page.getByRole("link", { name: "Informes", exact: true }).click();
    await page.getByLabel("Día comercial desde").fill(fixture.date);
    await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);
    await expect(
      page.getByText("Importes de envío", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/envíos por día comercial/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Saldos de reparto", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Delivery fees", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Saldos de delivery", { exact: true }),
    ).toHaveCount(0);
    expect(fixture.deliveryFeeMinor).toBeGreaterThan(0);
    expect(fixture.detailedReport.delivery.feesMinor).toBe(250_000);
    await expect(
      page
        .getByText("Importes de envío", { exact: true })
        .locator("..")
        .getByText(formatMoney(fixture.detailedReport.delivery.feesMinor), {
          exact: true,
        }),
    ).toBeVisible();
    await stableScreenshot({
      path: join(out, `us06-informes-${width}.png`),
      fullPage: true,
    });

    await page.getByRole("link", { name: "Auditoría", exact: true }).click();
    const action = page.getByRole("combobox");
    await expect(
      action.locator("option", { hasText: "Gasto de caja" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("table").getByText("Gasto de caja", { exact: true }),
    ).toBeVisible();
    await action.selectOption({ label: "Gasto de caja" });
    await expect(action).toHaveValue("CASH_EXPENSE");
    await expect(
      page.getByText("US06 comprobación de gasto", { exact: true }),
    ).toBeVisible();
    await stableScreenshot({
      path: join(out, `us06-auditoria-${width}.png`),
      fullPage: true,
    });

    const afterNavigation = await page.evaluate(
      async ({ date, sessionId }) => ({
        cashReport: await window.gastronomy.getCashSessionReport({
          cashSessionId: sessionId,
        }),
        financeReport: await window.gastronomy.getFinanceReport({
          from: date,
          to: date,
        }),
        detailedReport: await window.gastronomy.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
        audit: await window.gastronomy.getAuditLog({
          dateFrom: date,
          dateTo: date,
          action: "CASH_EXPENSE",
          search: "US06 comprobación de gasto",
          offset: 0,
          limit: 20,
        }),
      }),
      { date: fixture.date, sessionId: fixture.sessionId },
    );
    expect(afterNavigation).toEqual({
      cashReport: fixture.cashReport,
      financeReport: fixture.financeReport,
      detailedReport: fixture.detailedReport,
      audit: fixture.audit,
    });
    expect(fixture.audit).toHaveLength(1);
    expect(fixture.audit[0]?.action).toBe("CASH_EXPENSE");
    await writeFile(
      join(out, `us06-${width}.json`),
      JSON.stringify(
        {
          width,
          sessionId: fixture.sessionId,
          date: fixture.date,
          auditAction: fixture.audit[0]?.action,
          auditFilterValue: "CASH_EXPENSE",
          auditLabel: "Gasto de caja",
          reportsAndAuditUnchangedAfterNavigation: true,
          realElectronSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
  });
}

test("el catálogo usa lenguaje cotidiano sin cambiar el modificador predeterminado", async () => {
  const before = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const boot = await api.bootstrap();
    const date = boot.cashSession!.businessDate;
    return {
      date,
      modifiers: boot.modifiers,
      detailed: await api.getDetailedReport({ dateFrom: date, dateTo: date }),
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Catálogo, modificadores y stock",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Modificadores" }).click();
  await expect(
    page.getByText("Creá modificadores, como queso extra o sin salsa", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nuevo modificador", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nuevo modificador",
    exact: true,
  });
  await expect(dialog.getByLabel("Grupo", { exact: true })).toHaveValue(
    "Extras",
  );
  await expect(
    dialog.getByRole("button", { name: "Crear modificador", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Nuevo extra", exact: true }),
  ).toHaveCount(0);
  await stableScreenshot({
    path: join(out, "us06-catalogo-modificador.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  const after = await page.evaluate(
    async ({ date }) => {
      const boot = await window.gastronomy.bootstrap();
      return {
        modifiers: boot.modifiers,
        detailed: await window.gastronomy.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
      };
    },
    { date: before.date },
  );
  expect(after).toEqual({
    modifiers: before.modifiers,
    detailed: before.detailed,
  });
  await writeFile(
    join(out, "us06-catalogo-modificador.json"),
    JSON.stringify(
      { groupDefault: "Extras", unchangedAfterCancel: true },
      null,
      2,
    ),
  );
});

test("la búsqueda de clientes explica qué escribir sin mostrar tiempos internos", async () => {
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo pedido", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Buscá un cliente guardado o completá los datos abajo.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByText(/0,1 segundos/)).toHaveCount(0);
  await stableScreenshot({
    path: join(out, "us06-buscar-cliente.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(after.orders).toEqual(before.orders);
  expect(after).toEqual(before);
  expect(after.cashSession).toEqual(before.cashSession);
});
