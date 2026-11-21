import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.describe("foco al entrar a Salón (Electron aislado)", () => {
  test.beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), "gastronomy-salon-focus-toast-"));
    app = await launchConfiguredPos({
      args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
      cwd: process.cwd(),
    });
    page = await app.firstWindow();
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  });

  test.afterEach(async () => {
    await app?.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
    await app?.close();
    if (userData) await rm(userData, { recursive: true, force: true });
  });

  async function openCashAndSalon() {
    await page.evaluate(() =>
      window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
    );
    await page.reload();
    await page.getByRole("link", { name: "Salón", exact: true }).click();
  }

  test("al entrar a Salón sin ventanas enfoca mesa y lo restaura tras salir y volver", async () => {
    const salon = page.getByRole("link", { name: "Salón", exact: true });
    await salon.click();
    const table = page.getByLabel("Número de mesa");
    await expect(table).toBeFocused();
    await expect(
      page.getByRole("dialog", { includeHidden: false }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: "Pedidos", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pedidos", exact: true }),
    ).toBeVisible();
    await salon.click();
    await expect(table).toBeFocused();
  });

  test("foco queda en los diálogos de mesa/pedido y al volver de editor abierto desde tarjeta", async () => {
    await openCashAndSalon();
    const tableInput = page.getByRole("textbox", {
      name: "Número de mesa",
      exact: true,
    });
    const tableCard = page
      .getByRole("button", { name: /^Abrir mesa \d+$/ })
      .first();
    await tableCard.click();
    const opening = page.getByRole("dialog", { name: /Abrir mesa \d+/ });
    await expect(opening.getByRole("combobox", { name: /^Mesero responsable/ })).toBeFocused();
    await expect(tableInput).not.toBeFocused();
    await opening.getByRole("button", { name: "Cancelar" }).click();
    await expect(tableInput).toBeFocused();

    const tableNumber = Number(
      (await tableCard.getAttribute("aria-label"))?.match(/\d+/)?.[0],
    );
    const deleteButton = page.getByRole("button", {
      name: `Eliminar mesa ${tableNumber}`,
      exact: true,
    });
    await deleteButton.click();
    const deleting = page.getByRole("dialog", {
      name: `Eliminar mesa ${tableNumber}`,
    });
    await expect(
      deleting.getByLabel("Confirmación número de mesa"),
    ).toBeFocused();
    await expect(tableInput).not.toBeFocused();
    await deleting.getByRole("button", { name: "Cancelar" }).click();
    await expect(tableInput).toBeFocused();

    await page
      .getByRole("button", { name: `Abrir mesa ${tableNumber}`, exact: true })
      .click();
    const openDialog = page.getByRole("dialog", {
      name: `Abrir mesa ${tableNumber}`,
    });
    await expect(openDialog.getByRole("combobox", { name: /^Mesero responsable/ })).toBeFocused();
    await openDialog
      .getByRole("button", { name: "Abrir mesa", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
    const search = editor.getByPlaceholder(/Código, nombre, categoría/);
    await expect(search).toBeFocused();
    await search.fill("MUZG");
    await editor
      .locator('[id^="order-editor-product-"]')
      .filter({ hasText: "Muzzarella grande" })
      .click();
    await expect(editor.getByLabel("Cantidad de Muzzarella grande")).toHaveValue(
      "1",
    );
    await expect(tableInput).not.toBeFocused();
    await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(tableInput).toBeFocused();
  });

  test("permite editar el precio de un producto agregado en la mesa", async () => {
    await openCashAndSalon();
    await page.getByRole("button", { name: "Abrir mesa 1", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Abrir mesa 1" })
      .getByRole("button", { name: "Abrir mesa", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
    await editor.getByPlaceholder(/Código, nombre, categoría/).fill("MUZG");
    await editor.locator('[id^="order-editor-product-"]').filter({ hasText: "Muzzarella grande" }).click();
    const editPrice = editor.getByRole("button", {
      name: "Editar precio de Muzzarella grande",
    });
    await editPrice.click();
    const dialog = page.getByRole("dialog", { name: "Editar precio", exact: true });
    const price = dialog.getByLabel("Precio unitario");
    const pin = dialog.getByLabel("PIN de autorización");
    const save = dialog.getByRole("button", { name: "Guardar precio" });
    await expect(price).toBeFocused();
    await price.fill("12345,67");
    await expect(save).toBeDisabled();
    await pin.fill("0000");
    await save.click();
    await expect(dialog.getByRole("alert")).toContainText(/PIN/i);
    await pin.fill("748259");
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(editor.getByRole("article")).toContainText("12.345,67");

    await editor.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByRole("button", { name: "Abrir pedido de mesa 1", exact: true }).click();
    await editPrice.click();
    await expect(price).toHaveValue("12345,67");
  });
});

let viteServer: ChildProcess;
let baseURL = "";

async function unusedPort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) =>
    listener.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("No port available");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test.describe("toast de impresión (harness real OrderPrintStatus)", () => {
  test.beforeAll(async () => {
    const port = await unusedPort();
    baseURL = `http://127.0.0.1:${port}`;
    viteServer = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
        "--mode",
        "demo",
      ],
      { cwd: "apps/gastronomy-web", stdio: "ignore", windowsHide: true },
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (viteServer.exitCode !== null)
        throw new Error(`Vite exited with ${viteServer.exitCode}`);
      try {
        if ((await fetch(baseURL)).ok) return;
      } catch {
        /* server is still starting */
      }
      await delay(100);
    }
    throw new Error("Vite did not start for toast test");
  });

  test.afterAll(() => viteServer?.kill());

  async function openPrintHarness(page: Page) {
    await page.clock.install({ time: new Date("2026-10-31T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-31T12:00:01Z"));
    await page.route("**/src/main.tsx", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: 'import "/src/test/order-print-harness.tsx";',
      }),
    );
    await page.goto(baseURL);
    await expect(page.getByRole("dialog", { name: /Pedido #/ })).toBeVisible();
  }

  async function finishPrint(page: Page, expectedCalls: number) {
    await expect
      .poll(() => page.evaluate(() => window.__printControl.calls))
      .toBe(expectedCalls);
    await page.evaluate(() => window.__printControl.finish());
  }

  test("notificación exitosa desaparece al cumplir 6s", async ({ page }) => {
    await openPrintHarness(page);
    const status = page.getByTestId("global-print-status").getByRole("status");

    await page.getByRole("button", { name: /Comanda/ }).click();
    await finishPrint(page, 1);
    await expect(status).toContainText("Enviada a la impresora.");
    await page.clock.runFor(5_999);
    await expect(status).toBeVisible();
    await page.clock.runFor(1);
    await expect(status).toHaveCount(0);
  });

  test("reimprimir el mismo pedido reinicia el plazo del toast", async ({
    page,
  }) => {
    await openPrintHarness(page);
    const status = page.getByTestId("global-print-status").getByRole("status");
    await page.getByRole("button", { name: /Comanda/ }).click();
    await finishPrint(page, 1);
    await expect(status).toContainText("Enviada a la impresora.");
    await page.clock.runFor(4_000);
    await page.getByRole("button", { name: /Reimprimir comanda/ }).click();
    const confirm = page.getByRole("dialog", { name: "Confirmar reimpresión" });
    await confirm
      .getByRole("button", { name: "Reimprimir", exact: true })
      .click();
    await finishPrint(page, 2);
    await expect(status).toContainText("Enviada a la impresora.");
    await page.clock.runFor(5_999);
    await expect(status).toBeVisible();
    await page.clock.runFor(1);
    await expect(status).toHaveCount(0);
  });
});
