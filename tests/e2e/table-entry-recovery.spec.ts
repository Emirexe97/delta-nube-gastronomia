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

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-table-recovery-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  if (process.env.GASTRONOMY_FOCUS_DIAGNOSTICS === "1") {
    await page.evaluate(() => {
      const events: unknown[] = [];
      (window as any).__focusDiagnostics = events;
      const describe = (node: Element | null) =>
        node
          ? {
              tag: node.tagName,
              label: node.getAttribute("aria-label"),
              text: node.textContent?.slice(0, 80),
              placeholder: node.getAttribute("placeholder"),
              disabled: node.hasAttribute("disabled"),
              connected: node.isConnected,
            }
          : null;
      const record = (kind: string, extra: unknown = null) =>
        events.push({
          time: performance.now(),
          kind,
          active: describe(document.activeElement),
          dialogs: document.querySelectorAll('[role="dialog"]').length,
          extra,
        });
      document.addEventListener(
        "focusin",
        (event) => record("focusin", describe(event.target as Element)),
        true,
      );
      document.addEventListener(
        "focusout",
        (event) => record("focusout", describe(event.target as Element)),
        true,
      );
      const originalFocus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (options) {
        record("focus-call", {
          target: describe(this),
          stack: new Error().stack,
        });
        return originalFocus.call(this, options);
      };
      const originalFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        const origin = new Error().stack;
        const id = originalFrame((timestamp) => {
          record("frame-before", origin);
          callback(timestamp);
          record("frame-after");
        });
        record("frame-scheduled", { id, origin });
        return id;
      };
      const originalCancel = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = (id) => {
        record("frame-canceled", { id });
        originalCancel(id);
      };
    });
  }
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
    if (process.env.GASTRONOMY_FOCUS_DIAGNOSTICS === "1") {
      const dir = join(
        process.cwd(),
        "docs/qa/evidence/system-usability-table-focus-audit-2026-10-07",
      );
      await mkdir(dir, { recursive: true });
      const state = await page.evaluate(async () => ({
        events: (window as any).__focusDiagnostics,
        active: document.activeElement?.outerHTML,
        table: document.querySelector('input[placeholder="Ej.: 12"]')
          ?.outerHTML,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(
          (n) => n.textContent,
        ),
        visibility: document.visibilityState,
        bootstrap: await window.gastronomy.bootstrap(),
        inputs: Array.from(document.querySelectorAll("input, select")).map(
          (n) => ({ html: n.outerHTML, focused: n === document.activeElement }),
        ),
      }));
      const windows = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((w) => ({
          visible: w.isVisible(),
          focused: w.isFocused(),
          throttling: w.webContents.getBackgroundThrottling(),
        })),
      );
      await writeFile(
        join(
          dir,
          `${info.testId}-repeat${info.repeatEachIndex}-${info.retry}.json`,
        ),
        JSON.stringify(
          {
            title: info.title,
            repeat: info.repeatEachIndex,
            status: info.status,
            ...state,
            windows,
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.warn("Could not capture focus diagnostics", error);
  }
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) {
    if (
      dirname(resolve(userData)) !== resolve(tmpdir()) ||
      !basename(userData).startsWith("gastronomy-table-recovery-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(userData, { recursive: true, force: true });
  }
});

async function openFromQuickEntry(tableNumber: number) {
  const table = page.getByLabel("Número de mesa");
  await table.fill(String(tableNumber));
  await table.press("Enter");

  const waiterNumber = page.getByLabel(/^Número de mozo/);
  await expect(waiterNumber).toBeFocused();
  await waiterNumber.fill("1");
  await waiterNumber.press("Enter");

  const waiterName = page.getByLabel(/^Nombre de mozo/);
  await expect(waiterName).toBeFocused();
  await waiterName.selectOption({ label: "Administrador" });
  await waiterName.press("Enter");

  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  return editor;
}

async function expectQuickEntryRecovered(nextTableNumber: number) {
  const table = page.getByLabel("Número de mesa");
  await expect(table).toBeEnabled();
  await expect(table).toBeFocused();

  await table.fill(String(nextTableNumber));
  await table.press("Enter");
  await expect(
    page.getByText(`Mesa ${nextTableNumber} creada`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Salón" })).toBeVisible();
}

test("Escape al cerrar el editor devuelve el foco a carga rápida y permite otra mesa", async () => {
  const editor = await openFromQuickEntry(61);
  await editor.getByPlaceholder(/Código, nombre, categoría/).focus();
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();

  await expectQuickEntryRecovered(62);
});

test("cerrar el editor con X devuelve el foco a carga rápida y permite otra mesa", async () => {
  const editor = await openFromQuickEntry(63);
  await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(editor).toBeHidden();

  await expectQuickEntryRecovered(64);
});

test("cambiar la mesa mientras se elige mozo sigue disponible sin salir de Salón", async () => {
  const table = page.getByLabel("Número de mesa");
  await table.fill("65");
  await table.press("Enter");
  await expect(page.getByLabel(/^Número de mozo/)).toBeEnabled();

  await expect(table).toBeEnabled();
  await table.fill("66");
  await table.press("Enter");
  await expect(page.getByText("Mesa 66 creada", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Salón" })).toBeVisible();
});

test("cobrar y cerrar mesa devuelve la carga rápida a una nueva mesa", async () => {
  const editor = await openFromQuickEntry(67);
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await search.fill("MUZG");
  await editor.getByRole("button", { name: /Muzzarella grande/ }).click();
  const addProduct = page.getByRole("dialog", {
    name: "Agregar · Muzzarella grande",
  });
  await addProduct.getByRole("button", { name: "Agregar a la mesa" }).click();
  await expect(addProduct).toBeHidden();

  await editor.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(editor.getByRole("button", { name: "Cobrar" })).toBeEnabled();
  await editor.getByRole("button", { name: "Cobrar" }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar pedido" });
  await payment.getByLabel("Efectivo", { exact: true }).fill("15000");
  await payment.getByRole("button", { name: "Confirmar cobro" }).click();
  await expect(payment).toBeHidden();

  await editor.getByRole("button", { name: "Cerrar mesa" }).click();
  await expect(editor).toBeHidden();
  await expectQuickEntryRecovered(68);
});
