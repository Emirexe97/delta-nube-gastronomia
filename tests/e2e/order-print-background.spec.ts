import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

let server: ChildProcess;
let baseURL: string;

async function unusedPort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) =>
    listener.listen(0, "127.0.0.1", resolve).on("error", reject),
  );
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate test port");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test.beforeAll(async () => {
  const port = await unusedPort();
  baseURL = `http://127.0.0.1:${port}`;
  server = spawn(
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
    {
      cwd: "apps/gastronomy-web",
      stdio: "ignore",
      windowsHide: true,
    },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null)
      throw new Error(`Vite exited with ${server.exitCode}`);
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      /* server is still starting */
    }
    await delay(100);
  }
  throw new Error("Vite did not start for order print regression test");
});

test.afterAll(() => {
  server?.kill();
});

async function openHarness(page: Page) {
  page.on("pageerror", (error) =>
    console.error(`Print harness: ${error.message}`),
  );
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

test("Ocultar closes the latest print notice without uncovering earlier results", async ({
  page,
}) => {
  await openHarness(page);
  await page
    .getByRole("dialog", { name: /Pedido #/ })
    .getByRole("button", { name: "Cerrar", exact: true })
    .click();
  const status = page.getByTestId("global-print-status");
  for (const number of [801, 802, 803]) {
    await page.evaluate(async (orderNumber) => {
      const modulePath = "/src/order-print.ts";
      const { orderPrintCoordinator } = await import(modulePath);
      void orderPrintCoordinator.run({
        orderId: `notice-${orderNumber}`,
        orderNumber,
        kind: "CUSTOMER_BILL",
      });
    }, number);
    await expect
      .poll(() => page.evaluate(() => window.__printControl.calls))
      .toBe(number - 800);
    await expect(
      status.getByRole("button", { name: "Ocultar", exact: true }),
    ).toHaveCount(number === 802 ? 1 : 0);
    await page.evaluate(() => window.__printControl.finish());
    await expect(
      status.getByRole("status").filter({ hasText: `Pedido #${number}` }),
    ).toContainText("Enviada a la impresora.");
    if (number !== 801) {
      await status
        .getByRole("button", { name: "Ocultar", exact: true })
        .click();
      await expect(status.getByRole("status")).toHaveCount(0);
      await expect(status.getByRole("alert")).toHaveCount(0);
    }
  }
});

test("native print remains single-flight and its result survives closing and reopening the editor", async ({
  page,
}) => {
  await openHarness(page);
  const printButton = page.getByRole("button", { name: /Comanda/ });
  await printButton.click();
  const globalStatus = page.getByTestId("global-print-status");
  await expect(
    globalStatus
      .getByRole("status")
      .filter({ hasText: "Enviando a la impresora" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__printControl.calls))
    .toBe(1);

  const editor = page.getByRole("dialog", { name: /Pedido #/ });
  await editor.getByRole("button", { name: "Cerrar" }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole("button", { name: "Ir a otra pantalla" }).click();
  await expect(
    globalStatus
      .getByRole("status")
      .filter({ hasText: "Enviando a la impresora" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Abrir pedido" }).click();
  const reopenedEditor = page.getByRole("dialog", { name: /Pedido #/ });
  await expect(reopenedEditor).toBeVisible();
  await expect(
    reopenedEditor.getByRole("button", { name: /Enviando/ }).first(),
  ).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => window.__printControl.calls))
    .toBe(1);

  await reopenedEditor.getByRole("button", { name: "Cerrar" }).click();
  await page.evaluate(() => window.__printControl.finish());
  await expect(
    globalStatus
      .getByRole("status")
      .filter({ hasText: "Enviada a la impresora" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Pedido #/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Abrir pedido" }).click();
  await expect(
    page.getByRole("button", { name: /Reimprimir comanda/ }),
  ).toBeVisible();
});

test("native print failure is reported after the editor has closed", async ({
  page,
}) => {
  await openHarness(page);
  await page.getByRole("button", { name: /Comanda/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__printControl.calls))
    .toBe(1);
  const editor = page.getByRole("dialog", { name: /Pedido #/ });
  await editor.getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Ir a otra pantalla" }).click();
  await page.evaluate(() =>
    window.__printControl.finish("Impresora sintética sin respuesta"),
  );
  await expect(
    page
      .getByTestId("global-print-status")
      .getByRole("alert")
      .filter({ hasText: "Impresora sintética sin respuesta" }),
  ).toBeVisible();
});

test("confirmed reprint prompt leaves the order editor open and interactive", async ({
  page,
}) => {
  await openHarness(page);
  await page.getByRole("button", { name: /Comanda/ }).click();
  await page.evaluate(() => window.__printControl.finish());
  await expect(
    page.getByRole("button", { name: /Reimprimir comanda/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Reimprimir comanda/ }).click();
  const confirmDialog = page.getByRole("dialog", {
    name: "Confirmar reimpresión",
  });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog
    .getByRole("button", { name: "Reimprimir", exact: true })
    .click();
  await expect(confirmDialog).toHaveCount(0);
  const editor = page.getByRole("dialog", { name: /Pedido #/ });
  await expect(
    editor.getByRole("button", { name: /Enviando/ }).first(),
  ).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => window.__printControl.calls))
    .toBe(2);
  await editor.getByRole("button", { name: "Cerrar" }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    page
      .getByTestId("global-print-status")
      .getByRole("status")
      .filter({ hasText: "Enviando a la impresora" }),
  ).toBeVisible();
});
