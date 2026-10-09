import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData: string;
const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-table-focus-fix-2026-10-07",
);

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-focus-priority-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(userData));
  const native = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      visible: w.isVisible(),
      focused: w.isFocused(),
      throttling: w.webContents.getBackgroundThrottling(),
    })),
  );
  expect(native).toEqual([
    { visible: false, focused: false, throttling: false },
  ]);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820),
  );
  await page.getByRole("link", { name: "Caja" }).click();
  await page.getByRole("button", { name: /Abrir caja/ }).click();
  await page.getByLabel("Cambio / fondo inicial").fill("50000");
  await page
    .getByRole("dialog", { name: "Abrir caja" })
    .getByRole("button", { name: "Abrir caja", exact: true })
    .click();
  await expect(page.getByText(/Caja #\d+/)).toBeVisible();
  await page.getByRole("link", { name: "Salón" }).click();
});

test.afterEach(async ({}, info) => {
  try {
    if (page) {
      await mkdir(evidence, { recursive: true });
      const state = await page.evaluate(async () => ({
        bootstrap: await window.gastronomy.bootstrap(),
        active: document.activeElement?.outerHTML,
        pendingRestoreBoundary: (window as any).__priorityTimingEvidence,
        visibleDialogs: Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter((d) => (d as HTMLElement).offsetParent !== null)
          .map((d) => d.textContent?.slice(0, 180)),
      }));
      const native = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          visible: w.isVisible(),
          focused: w.isFocused(),
          size: w.getSize(),
          throttling: w.webContents.getBackgroundThrottling(),
        })),
      );
      await writeFile(
        join(
          evidence,
          `${info.testId}-repeat${info.repeatEachIndex}-${info.retry}.json`,
        ),
        JSON.stringify(
          { title: info.title, status: info.status, ...state, native },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.warn("Could not capture table focus evidence", error);
  }
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (userData) {
    if (
      dirname(resolve(userData)) !== resolve(tmpdir()) ||
      !basename(userData).startsWith("gastronomy-focus-priority-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(userData, { recursive: true, force: true });
  }
});

async function openFromQuickEntry(number: number) {
  const table = page.getByLabel("Número de mesa");
  await table.fill(String(number));
  await table.press("Enter");
  const waiterNo = page.getByLabel(/^Número de mozo/);
  await expect(waiterNo).toBeFocused();
  await waiterNo.fill("1");
  await waiterNo.press("Enter");
  const waiterName = page.getByLabel(/^Nombre de mozo/);
  await expect(waiterName).toBeFocused();
  await waiterName.selectOption({ label: "Administrador" });
  await waiterName.press("Enter");
  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  return editor;
}

async function addAndPay(editor: Locator) {
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("MUZG");
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  const add = page.getByRole("dialog", { name: "Agregar · Muzzarella grande" });
  await add.getByRole("button", { name: "Agregar a la mesa" }).click();
  await expect(add).toBeHidden();
  await editor.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(editor.getByRole("button", { name: "Cobrar" })).toBeEnabled();
  await editor.getByRole("button", { name: "Cobrar" }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar pedido" });
  await payment.getByLabel("Efectivo", { exact: true }).fill("15000");
  await payment.getByRole("button", { name: "Confirmar cobro" }).click();
  await expect(payment).toBeHidden();
}

for (const width of [1100, 1366]) {
  test(`cobrar y cerrar a ${width}px devuelve foco a Mesa sin foco manual; pago permanece exacto`, async () => {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
      width,
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.getSize(),
      ),
    ).toEqual([width, 820]);
    const before = await page.evaluate(() => window.gastronomy.bootstrap());
    const editor = await openFromQuickEntry(67);
    await addAndPay(editor);
    await editor.getByRole("button", { name: "Cerrar mesa" }).click();
    await expect(editor).toBeHidden();
    const table = page.getByLabel("Número de mesa");
    await expect(table).toBeEnabled();
    await expect(table).toBeFocused();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: join(evidence, `focused-table-${width}.png`),
    });
    const after = await page.evaluate(() => window.gastronomy.bootstrap());
    const order = after.orders.find(
      (candidate) => candidate.tableNumber === 67,
    );
    expect(order?.paymentStatus).toBe("PAID");
    expect(order?.operationalStatus).toBe("DELIVERED");
    expect(order?.totalMinor).toBe(1500000);
    expect(order?.paidMinor).toBe(1500000);
    expect(
      after.tables.find((candidate) => candidate.number === 67)?.currentOrderId,
    ).toBeNull();
    await table.fill("72");
    await table.press("Enter");
    await expect(page.getByLabel(/^Número de mozo/)).toBeFocused();
    await page.getByLabel(/^Número de mozo/).fill("1");
    await page.getByLabel(/^Número de mozo/).press("Enter");
    await expect(page.getByLabel(/^Nombre de mozo/)).toBeFocused();
    const final = await page.evaluate(() => window.gastronomy.bootstrap());
    expect(
      final.orders.find((candidate) => candidate.tableNumber === 67),
    ).toEqual(order);
    expect(
      before.orders.find((candidate) => candidate.tableNumber === 67),
    ).toBeUndefined();
  });
}

test("reabrir pedido antes del retorno pendiente conserva foco en editor y no inhibe otra entrada", async () => {
  const editor = await openFromQuickEntry(68);
  await addAndPay(editor);
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cerrar mesa",
    );
    button?.click();
  });
  await expect(editor).toBeHidden();
  const row = page.getByRole("button", { name: /^Ver pedido #/ }).first();
  await expect(row).toBeVisible();
  await page.evaluate(() => {
    const table = document.querySelector<HTMLInputElement>(
      'input[placeholder="Ej.: 12"]',
    )!;
    if (document.activeElement === table || table.disabled)
      throw new Error(
        "Recovery already completed or table disabled before rapid reopen probe",
      );
    (window as any).__priorityTimingEvidence = {
      tableFocused: false,
      tableEnabled: true,
      activeTag: document.activeElement?.tagName,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    };
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ver pedido #"]',
    );
    button?.click();
  });
  const reopened = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(reopened).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await expect
    .poll(() =>
      reopened.evaluate((dialog) => dialog.contains(document.activeElement)),
    )
    .toBe(true);
  await expect(page.getByLabel("Número de mesa")).not.toBeFocused();
  await reopened.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(reopened).toBeHidden();
  const table = page.getByLabel("Número de mesa");
  await expect(table).toBeEnabled();
  await table.fill("71");
  await table.press("Enter");
  await expect(page.getByLabel(/^Número de mozo/)).toBeFocused();
});

test("salir a Salón principal mientras restaura y volver no deja el mozo pegado al foco", async () => {
  const editor = await openFromQuickEntry(69);
  await addAndPay(editor);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "Cerrar mesa")
      ?.click();
  });
  await expect(editor).toBeHidden();
  await page
    .getByRole("link", { name: "Resumen", exact: true })
    .evaluate((link) => {
      const table = document.querySelector<HTMLInputElement>(
        'input[placeholder="Ej.: 12"]',
      )!;
      if (document.activeElement === table || table.disabled)
        throw new Error(
          "Recovery already completed or table disabled before unmount probe",
        );
      (window as any).__priorityTimingEvidence = {
        tableFocused: false,
        tableEnabled: true,
        activeTag: document.activeElement?.tagName,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
      };
      (link as HTMLAnchorElement).click();
    });
  await expect(
    page.getByRole("heading", { name: "Resumen", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
  await expect(
    page.getByRole("link", { name: "Salón", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  const table = page.getByLabel("Número de mesa");
  await expect(table).toBeEnabled();
  await table.fill("70");
  await table.press("Enter");
  await expect(page.getByLabel(/^Número de mozo/)).toBeFocused();
});
