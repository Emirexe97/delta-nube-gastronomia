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

async function openCash(page: Page, pending = false) {
  page.on("pageerror", (error) => console.error(error.message));
  await page.route("**/src/main.tsx", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: 'import "/src/test/cash-close-harness.tsx";',
    }),
  );
  await page.goto(baseURL + (pending ? "/?pending=order" : "/"));
  await page.getByRole("button", { name: "Conciliar y cerrar caja" }).click();
  return page.getByRole("dialog", {
    name: "Conciliar y cerrar caja",
    exact: true,
  });
}

test("a variance without pending orders needs a reason and no forced closure", async ({
  page,
}) => {
  const dialog = await openCash(page);
  await expect(
    dialog.getByRole("checkbox", { name: /Forzar cierre/ }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText(/No hay pedidos ni rendiciones pendientes/),
  ).toBeVisible();
  await dialog.getByLabel("Total contado en caja").fill("110,00");
  await dialog.getByLabel("Cambio final para la próxima caja").fill("10,00");
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Indicá el motivo de la diferencia de arqueo.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByLabel("Motivo de la diferencia")
    .fill("Diferencia de prueba");
  await expect(dialog.getByLabel("PIN de autorización")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Revisar cierre" }).click();
  await expect(
    page.getByRole("dialog", { name: "Confirmar cierre definitivo" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__cashCloseTest.calls)).toBe(0);
});

test("missing or invalid amounts remain blocked and a matching count needs no reason", async ({
  page,
}) => {
  const dialog = await openCash(page);
  const review = dialog.getByRole("button", { name: "Revisar cierre" });
  await expect(review).toBeDisabled();
  await expect(
    dialog.getByText(/Ingresá un total contado válido/),
  ).toBeVisible();
  await dialog.getByLabel("Total contado en caja").fill("100,00");
  await dialog.getByLabel("Cambio final para la próxima caja").fill("");
  await expect(review).toBeDisabled();
  await expect(
    dialog.getByText(/Ingresá un cambio final válido/),
  ).toBeVisible();
  await dialog.getByLabel("Cambio final para la próxima caja").fill("110,00");
  await expect(review).toBeDisabled();
  await expect(
    dialog.getByText("El cambio final no puede superar el efectivo contado.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByLabel("Cambio final para la próxima caja").fill("10,00");
  await expect(review).toBeEnabled();
  await expect(dialog.getByLabel("Motivo de la diferencia")).toHaveCount(0);
});

test("forcing remains explicit and previous authorization is cleared when pending orders disappear", async ({
  page,
}) => {
  const dialog = await openCash(page, true);
  await dialog.getByLabel("Total contado en caja").fill("100,00");
  await dialog.getByLabel("Cambio final para la próxima caja").fill("10,00");
  const force = dialog.getByRole("checkbox", { name: /Forzar cierre/ });
  await force.check();
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Motivo del cierre forzado")
    .fill("Prueba de autorización");
  await dialog.getByLabel("PIN de autorización").fill("1234");
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeEnabled();
  await page.evaluate(() => window.__cashCloseTest.setPending(false));
  await expect(force).toHaveCount(0);
  await expect(dialog.getByLabel("PIN de autorización")).toHaveCount(0);
  await expect(dialog.getByLabel("Total contado en caja")).toHaveValue(
    "100,00",
  );
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeEnabled();
  await page.evaluate(() => window.__cashCloseTest.setPending(true));
  await expect(force).not.toBeChecked();
  await force.check();
  await expect(dialog.getByLabel("PIN de autorización")).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.__cashCloseTest.calls)).toBe(0);
});
