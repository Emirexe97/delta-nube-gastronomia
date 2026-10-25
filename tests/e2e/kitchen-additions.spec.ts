import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";
let currentTableNumber: number | null = null;

async function launch(dineIn = false) {
  currentTableNumber = dineIn ? 61 : null;
  userData = await mkdtemp(join(tmpdir(), "gastronomy-kitchen-additions-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();

  // Keep the real print preview, but make its final native print deterministic.
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const install = (window: any) => {
      window.webContents.getPrintersAsync = async () => [
        { name: "Mock Printer", isDefault: true },
      ];
      window.webContents.print = (
        _options: unknown,
        callback: (ok: boolean) => void,
      ) => callback(true);
    };
    electronApp.on("browser-window-created", (_event: unknown, window: any) =>
      install(window),
    );
    for (const window of BrowserWindow.getAllWindows()) install(window);
  });

  return page.evaluate(async (isDineIn) => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    if (!data.cashSession)
      await api.openCashSession({ openingAmountMinor: 5_000_000 });
    const table = isDineIn ? await api.ensureTable({ number: 61 }) : null;
    const activeProducts = data.products.filter(
      (product: any) => product.active,
    );
    const [original, unchanged, added] = activeProducts;
    if (!original || !unchanged || !added) {
      throw new Error(
        "Se necesitan al menos tres productos activos para el caso E2E",
      );
    }
    const order = await api.createOrder({
      type: isDineIn ? "DINE_IN" : "TAKEAWAY",
      tableId: table?.id,
      customerName: "Comanda con agregados E2E",
      customerPhone: "11 5555-0022",
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: original.id,
      quantity: 2,
    });
    await api.addOrderItem({
      orderId: order.id,
      productId: unchanged.id,
      quantity: 1,
    });
    await api.confirmOrder({ orderId: order.id });
    await api.saveSettings({
      ...data.settings,
      printing: {
        ...data.settings.printing,
        kitchen: { ...data.settings.printing.kitchen, mode: "SYSTEM_DIALOG" },
        bill: { ...data.settings.printing.bill, mode: "SYSTEM_DIALOG" },
      },
    });
    return { orderId: order.id, original, unchanged, added };
  }, dineIn);
}

async function openPreview(
  orderId: string,
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL" = "KITCHEN_ORDER",
) {
  await page.evaluate(
    ({ orderId, kind }) => {
      (window as any).__printResult = null;
      void window.gastronomy
        .printOrder({ orderId, kind })
        .then((result: unknown) => {
          (window as any).__printResult = result;
        });
    },
    { orderId, kind },
  );
  await expect
    .poll(
      () =>
        app
          .windows()
          .filter((candidate) =>
            candidate.url().includes("print-preview-controls"),
          ).length,
    )
    .toBe(1);
  return app
    .windows()
    .find((candidate) => candidate.url().includes("print-preview-controls"))!;
}

async function finishPreview(preview: Page, print: boolean) {
  await preview
    .getByRole("button", { name: print ? "Imprimir" : "Cancelar" })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__printResult))
    .not.toBeNull();
}

async function finishUiPreview(preview: Page, print: boolean) {
  await preview
    .getByRole("button", { name: print ? "Imprimir" : "Cancelar" })
    .click();
  await expect
    .poll(
      () =>
        app
          .windows()
          .filter((candidate) =>
            candidate.url().includes("print-preview-controls"),
          ).length,
    )
    .toBe(0);
}

async function openOrderEditor() {
  await page.reload();
  if (currentTableNumber != null) {
    await page.getByRole("link", { name: "Salón" }).click();
    await page
      .getByRole("button", {
        name: `Abrir pedido de mesa ${currentTableNumber}`,
        exact: true,
      })
      .click();
  } else {
    await page.getByRole("link", { name: "Pedidos" }).click();
    await page
      .getByRole("row")
      .filter({ hasText: "Comanda con agregados E2E" })
      .click();
  }
  return page.getByRole("dialog", { name: /Pedido #\d+ ·/ });
}

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("la reimpresión parcial conserva pendientes al cancelar y luego imprime sólo diferencias", async () => {
  const setup = await launch(true);
  const initial = await openPreview(setup.orderId);
  await expect(
    initial.getByText(setup.original.name, { exact: false }),
  ).toBeVisible();
  await finishPreview(initial, true);

  await page.evaluate(
    async ({ orderId, originalId, addedId }) => {
      const api = window.gastronomy;
      const order = (await api.bootstrap()).orders.find(
        (candidate: any) => candidate.id === orderId,
      )!;
      const originalItem = order.items.find(
        (item: any) => item.productId === originalId,
      )!;
      await api.updateOrderItemQuantity({
        orderId,
        itemId: originalItem.id,
        quantity: 3,
      });
      await api.addOrderItem({ orderId, productId: addedId, quantity: 1 });
    },
    {
      orderId: setup.orderId,
      originalId: setup.original.id,
      addedId: setup.added.id,
    },
  );

  let editor = await openOrderEditor();
  await expect(
    editor.getByRole("button", { name: /Reimprimir comanda/ }),
  ).toBeVisible();
  await editor.getByRole("button", { name: /Reimprimir comanda/ }).click();
  let confirmation = page.getByRole("dialog", {
    name: "Confirmar reimpresión",
  });
  const additions = confirmation.getByRole("radio", {
    name: "Sólo lo agregado",
  });
  await expect(additions).toBeChecked();
  await confirmation.screenshot({
    path: test.info().outputPath("kitchen-scope-choice.png"),
  });
  await expect(
    confirmation.getByText(setup.added.name, { exact: false }),
  ).toBeVisible();
  await expect(
    confirmation.getByText(`${1} × ${setup.added.name}`, { exact: true }),
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Reimprimir", exact: true })
    .click();
  let preview = await (async () => {
    await expect
      .poll(
        () =>
          app
            .windows()
            .filter((candidate) =>
              candidate.url().includes("print-preview-controls"),
            ).length,
      )
      .toBe(1);
    return app
      .windows()
      .find((candidate) => candidate.url().includes("print-preview-controls"))!;
  })();
  await expect(preview.getByText("AGREGADO", { exact: true })).toBeVisible();
  await preview.screenshot({
    path: test.info().outputPath("kitchen-additions-ticket.png"),
  });
  await expect(
    preview.getByText(setup.added.name, { exact: false }),
  ).toBeVisible();
  await expect(
    preview.getByText(setup.original.name, { exact: false }),
  ).toBeVisible();
  await expect(
    preview.getByText(setup.unchanged.name, { exact: false }),
  ).toHaveCount(0);
  await expect(
    preview.locator(".product").filter({ hasText: setup.original.name }),
  ).toContainText(/1\s*[×x]/i);
  await expect(
    preview.locator(".product").filter({ hasText: setup.added.name }),
  ).toContainText(/1\s*[×x]/i);
  await finishUiPreview(preview, false);

  // Reopening after cancellation must still offer the same pending delta.
  editor = await openOrderEditor();
  await editor.getByRole("button", { name: /Reimprimir comanda/ }).click();
  confirmation = page.getByRole("dialog", { name: "Confirmar reimpresión" });
  await expect(
    confirmation.getByRole("radio", { name: "Sólo lo agregado" }),
  ).toBeChecked();
  await confirmation
    .getByRole("button", { name: "Reimprimir", exact: true })
    .click();
  preview = await (async () => {
    await expect
      .poll(
        () =>
          app
            .windows()
            .filter((candidate) =>
              candidate.url().includes("print-preview-controls"),
            ).length,
      )
      .toBe(1);
    return app
      .windows()
      .find((candidate) => candidate.url().includes("print-preview-controls"))!;
  })();
  await expect(preview.getByText("AGREGADO", { exact: true })).toBeVisible();
  await expect(
    preview.getByText(setup.added.name, { exact: false }),
  ).toBeVisible();
  await expect(
    preview.getByText(setup.original.name, { exact: false }),
  ).toBeVisible();
  await expect(
    preview.getByText(setup.unchanged.name, { exact: false }),
  ).toHaveCount(0);
  await expect(
    preview.locator(".product").filter({ hasText: setup.original.name }),
  ).toContainText(/1\s*[×x]/i);
  await expect(
    preview.locator(".product").filter({ hasText: setup.added.name }),
  ).toContainText(/1\s*[×x]/i);
  await finishUiPreview(preview, true);

  editor = await openOrderEditor();
  await editor.getByRole("button", { name: /Reimprimir comanda/ }).click();
  confirmation = page.getByRole("dialog", { name: "Confirmar reimpresión" });
  await expect(
    confirmation.getByRole("radio", { name: "Sólo lo agregado" }),
  ).toBeDisabled();
  await expect(
    confirmation.getByRole("radio", { name: "Comanda completa" }),
  ).toBeChecked();
});

test("la reimpresión completa incluye todo el pedido y la cuenta no aplica alcance parcial", async () => {
  const setup = await launch();
  const initial = await openPreview(setup.orderId);
  await finishPreview(initial, true);
  await page.evaluate(
    async ({ orderId, originalId, addedId }) => {
      const api = window.gastronomy;
      const order = (await api.bootstrap()).orders.find(
        (candidate: any) => candidate.id === orderId,
      )!;
      const originalItem = order.items.find(
        (item: any) => item.productId === originalId,
      )!;
      await api.updateOrderItemQuantity({
        orderId,
        itemId: originalItem.id,
        quantity: 3,
      });
      await api.addOrderItem({ orderId, productId: addedId, quantity: 1 });
    },
    {
      orderId: setup.orderId,
      originalId: setup.original.id,
      addedId: setup.added.id,
    },
  );

  const editor = await openOrderEditor();
  await editor.getByRole("button", { name: /Reimprimir comanda/ }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirmar reimpresión",
  });
  await confirmation.getByRole("radio", { name: "Comanda completa" }).check();
  await confirmation
    .getByRole("button", { name: "Reimprimir", exact: true })
    .click();
  const fullPreview = await (async () => {
    await expect
      .poll(
        () =>
          app
            .windows()
            .filter((candidate) =>
              candidate.url().includes("print-preview-controls"),
            ).length,
      )
      .toBe(1);
    return app
      .windows()
      .find((candidate) => candidate.url().includes("print-preview-controls"))!;
  })();
  await expect(
    fullPreview.getByText(setup.original.name, { exact: false }),
  ).toBeVisible();
  await expect(
    fullPreview.getByText(setup.unchanged.name, { exact: false }),
  ).toBeVisible();
  await expect(
    fullPreview.getByText(setup.added.name, { exact: false }),
  ).toBeVisible();
  await expect(
    fullPreview.locator(".product").filter({ hasText: setup.original.name }),
  ).toContainText(/3\s*[×x]/i);
  await expect(
    fullPreview.locator(".product").filter({ hasText: setup.unchanged.name }),
  ).toContainText(/1\s*[×x]/i);
  await expect(
    fullPreview.locator(".product").filter({ hasText: setup.added.name }),
  ).toContainText(/1\s*[×x]/i);
  await expect(fullPreview.getByText("AGREGADO", { exact: true })).toHaveCount(
    0,
  );
  await finishUiPreview(fullPreview, true);

  const bill = await openPreview(setup.orderId, "CUSTOMER_BILL");
  await expect(
    bill.getByText(setup.original.name, { exact: false }),
  ).toBeVisible();
  await expect(
    bill.getByText(setup.unchanged.name, { exact: false }),
  ).toBeVisible();
  await expect(
    bill.getByText(setup.added.name, { exact: false }),
  ).toBeVisible();
  await expect(bill.getByText("AGREGADO", { exact: true })).toHaveCount(0);
  await finishPreview(bill, false);
});
