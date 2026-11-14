import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-customer-accent-"));
  app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach(window => window.destroy()),
  ).catch(() => {});
  await app?.close();
  if (userData) {
    if (dirname(resolve(userData)) !== resolve(tmpdir()) ||
      !basename(userData).startsWith("gastronomy-customer-accent-"))
      throw new Error("Unsafe disposable customer profile cleanup");
    await rm(userData, { recursive: true, force: true });
  }
});

test("busca el mismo cliente con o sin tilde en Clientes y selector de pedido", async () => {
  const customer = await page.evaluate(async () => {
    const api = window.gastronomy;
    const customer = await api.createCustomer({
      name: "Héctor Búsqueda QA",
      phone: "11 4444-7733",
      addresses: [{ label: "Casa", address: "Mitre 773", deliveryFeeMinor: 0 }],
    });
    await api.openCashSession({ openingAmountMinor: 0 });
    return customer;
  });
  expect(customer?.name).toBe("Héctor Búsqueda QA");
  await page.reload();

  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  const directorySearch = page.getByPlaceholder("Nombre, teléfono o dirección");
  for (const query of ["Hector", "HÉCTOR", "He\u0301ctor", "Héctor"]) {
    await directorySearch.fill(query);
    await expect(page.getByRole("button", { name: "Editar Héctor Búsqueda QA" })).toBeVisible();
  }

  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: /F4 Envío/ }).click();
  const order = page.getByRole("dialog", { name: "Nuevo Envío" });
  const selector = order.getByRole("combobox", { name: /Buscar cliente/ });
  for (const query of ["Hector", "HÉCTOR", "He\u0301ctor", "Héctor"]) {
    await selector.fill(query);
    await expect(order.getByRole("option", { name: /Héctor Búsqueda QA/ })).toBeVisible();
  }
});
