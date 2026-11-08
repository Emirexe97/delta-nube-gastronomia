import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchConfiguredPos } from "./pos-fixture";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-money-auth-"));
  app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 500000 }),
  );
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("cash withdrawal requires an authorization PIN and keeps the draft after PIN rejection", async () => {
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.getByRole("button", { name: /Registrar movimiento/ }).click();
  const dialog = page.getByRole("dialog", { name: "Movimiento de caja" });
  await dialog.getByLabel("Tipo").selectOption("WITHDRAWAL");
  await dialog.getByLabel("Importe").fill("1250");
  await dialog.getByLabel("Motivo").fill("Retiro de prueba UX");
  const submit = dialog.getByRole("button", { name: "Registrar" });
  await expect(dialog.getByLabel("PIN de autorización")).toHaveAttribute(
    "type",
    "password",
  );
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("PIN de autorización").fill("0000");
  await submit.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Importe")).toHaveValue("1250");
  await expect(dialog.getByLabel("Motivo")).toHaveValue("Retiro de prueba UX");
  await expect(dialog.getByLabel("PIN de autorización")).toHaveValue("0000");
  await dialog.getByLabel("PIN de autorización").fill("748259");
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(
      async () =>
        (await window.gastronomy.bootstrap()).cashSession?.expectedAmountMinor,
    ),
  ).toBe(375000);
  await page.getByRole("link", { name: "Auditoría", exact: true }).click();
  await page
    .getByPlaceholder("Entidad, usuario o motivo", { exact: true })
    .fill("Retiro de prueba UX");
  const auditRow = page
    .getByRole("row")
    .filter({ hasText: "Retiro de prueba UX" });
  await expect(auditRow).toBeVisible();
  await expect(auditRow).toContainText("Autorizó:");
});

test("finance expense requests an authorization PIN and preserves entered details on rejection", async () => {
  await page.getByRole("link", { name: "Finanzas", exact: true }).click();
  await page.getByLabel("Categoría").fill("Prueba UX");
  await page.getByLabel("Concepto").fill("Gasto protegido");
  await page.getByLabel("Importe").fill("1500");
  await page.getByLabel("PIN de autorización").fill("0000");
  await page
    .getByRole("button", { name: "Registrar gasto", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Concepto")).toHaveValue("Gasto protegido");
  await expect(page.getByLabel("Importe")).toHaveValue("1500");
  await expect(page.getByLabel("PIN de autorización")).toHaveValue("0000");
  await page.getByLabel("PIN de autorización").fill("748259");
  await page
    .getByRole("button", { name: "Registrar gasto", exact: true })
    .click();
  await expect(page.getByLabel("Concepto")).toHaveValue("");
  const authorizer = await page.evaluate(
    async () =>
      (await window.gastronomy.getAuditLog({ limit: 100 })).find(
        (row) => row.action === "FINANCE_EXPENSE_CREATED",
      )?.authorizerName,
  );
  expect(authorizer).toBeTruthy();
});
