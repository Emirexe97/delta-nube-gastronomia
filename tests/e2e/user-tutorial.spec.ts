import {
  test,
  expect,
  _electron,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

async function launchFreshProfile() {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-user-tutorial-"));
  const app = await _electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
    env: {
      ...process.env,
      GASTRONOMY_ADMIN_PIN: "1234",
      GASTRONOMY_LOCAL_PILOT: "0",
    },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(
    () =>
      typeof window.gastronomy?.isInitialAdminPinSetupRequired === "function",
  );
  if (
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))) !==
    resolve(profile)
  ) {
    await app.close();
    await rm(profile, { recursive: true, force: true });
    throw new Error(
      "Electron is not using the requested disposable tutorial profile.",
    );
  }
  return { app, profile, page };
}

async function removeProfile(profile: string) {
  if (
    resolve(profile, "..") !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-user-tutorial-")
  ) {
    throw new Error("Unsafe tutorial profile cleanup path.");
  }
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 150,
  });
}

async function configureInitialPin(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Configurá el PIN del administrador" }),
  ).toBeVisible();
  await expect(page.getByTestId("user-tutorial")).toHaveCount(0);
  await expect(
    page.evaluate(() => window.gastronomy.getTutorialProgress()),
  ).rejects.toThrow(/PIN inicial/);
  await page.getByLabel("PIN actual", { exact: true }).fill("1234");
  await page.getByLabel("PIN nuevo", { exact: true }).fill("748259");
  await page.getByLabel("Repetí el PIN nuevo").fill("748259");
  await page.getByRole("button", { name: "Guardar PIN y continuar" }).click();
  await expect(page.getByTestId("user-tutorial")).toBeVisible();
}

async function attachScreenshot(testInfo: TestInfo, page: Page, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("tutorial follows initial PIN setup, practice stays isolated, and skip resumes after reload", async ({}, testInfo) => {
  const { app, profile, page } = await launchFreshProfile();
  try {
    await configureInitialPin(page);
    await expect(
      page.getByRole("heading", { name: "Tu primera venta, paso a paso" }),
    ).toBeFocused();
    expect(
      await page
        .getByRole("link", { name: "Caja", exact: true })
        .evaluate((link) => Boolean(link.closest("[inert]"))),
    ).toBe(true);
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page
          .getByRole("dialog")
          .evaluate((dialog) => dialog.contains(document.activeElement)),
      ).toBe(true);
    }
    await attachScreenshot(testInfo, page, "tutorial-welcome");
    const before = await page.evaluate(async () => {
      const data = await window.gastronomy.bootstrap();
      return {
        orders: data.orders,
        products: data.products,
        cashSession: data.cashSession,
      };
    });

    await page.getByRole("button", { name: "Empezar recorrido" }).click();
    await expect(
      page.getByRole("heading", { name: "Antes de empezar el turno" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Probar apertura de caja" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "¡Bien!" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(
      page.getByRole("heading", { name: "Del producto a la comanda" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Agregar al pedido de ejemplo" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Pedido de ejemplo" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Confirmá el pago, no solo el pedido",
      }),
    ).toBeVisible();
    await attachScreenshot(testInfo, page, "tutorial-payment");
    await page.getByRole("button", { name: "Simular envío a cocina" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "todavía falta cobrar" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Simular cobro en efectivo" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "No se registró dinero" }),
    ).toBeVisible();
    const afterPractice = await page.evaluate(async () => {
      const data = await window.gastronomy.bootstrap();
      return {
        orders: data.orders,
        products: data.products,
        cashSession: data.cashSession,
      };
    });
    expect(afterPractice).toEqual(before);
    await page.getByRole("button", { name: "Anterior" }).click();
    await expect(
      page.getByRole("heading", { name: "Del producto a la comanda" }),
    ).toBeVisible();
    const after = await page.evaluate(async () => {
      const data = await window.gastronomy.bootstrap();
      return {
        orders: data.orders,
        products: data.products,
        cashSession: data.cashSession,
      };
    });
    expect(after).toEqual(before);

    await page.getByRole("button", { name: "Omitir por ahora" }).click();
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.gastronomy.getTutorialProgress()))
      .toMatchObject({ version: 1, status: "SKIPPED", stepId: "order" });
    await page.reload();
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);

    await page.evaluate(() => {
      window.location.hash = "/configuracion#settings-tutorial";
    });
    await expect(
      page.getByRole("heading", { name: "Tutorial de uso" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continuar tutorial" }).click();
    await expect(
      page.getByRole("heading", { name: "Del producto a la comanda" }),
    ).toBeVisible();
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      )
      .catch(() => undefined);
    await app.close();
    await removeProfile(profile);
  }
});

test("tutorial save failures keep the step and allow exit without blocking the POS", async () => {
  const { app, profile, page } = await launchFreshProfile();
  try {
    await configureInitialPin(page);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("gastronomy:saveTutorialProgress");
      ipcMain.handle("gastronomy:saveTutorialProgress", () => {
        throw new Error("Simulated storage failure");
      });
    });
    await page.getByRole("button", { name: "Empezar recorrido" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "No pudimos guardar tu avance",
    );
    await expect(
      page.getByRole("heading", { name: "Tu primera venta, paso a paso" }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.gastronomy.getTutorialProgress()))
        .status,
    ).toBe("NOT_STARTED");
    await page.getByRole("button", { name: "Salir sin guardar" }).click();
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);
    await page
      .getByRole("link", { name: "Configuración", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Configuración de Gastronomía" }),
    ).toBeVisible();
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    );
    await app.close();
    await removeProfile(profile);
  }
});

test("tutorial can be replayed from settings, completes durably, and Escape restores focus", async ({}, testInfo) => {
  const { app, profile, page } = await launchFreshProfile();
  try {
    await configureInitialPin(page);
    await page.getByRole("button", { name: "Omitir por ahora" }).click();
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);

    await page.evaluate(() => {
      window.location.hash = "/configuracion#settings-tutorial";
    });
    await expect(
      page.getByRole("heading", { name: "Tutorial de uso" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    const settingsName = page.getByLabel("Nombre visible", { exact: true });
    const originalName = await settingsName.inputValue();
    await settingsName.fill("Borrador sin guardar");
    await page.getByRole("tab", { name: "Tutorial", exact: true }).click();
    const replayButton = page.getByRole("button", {
      name: "Volver a hacer el tutorial",
    });
    await replayButton.click();
    await expect(
      page.getByRole("heading", { name: "Tu primera venta, paso a paso" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);
    await expect(replayButton).toBeFocused();

    await replayButton.click();
    await expect(
      page.getByRole("heading", { name: "Tu primera venta, paso a paso" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 700 });
    expect(
      await page
        .getByRole("dialog")
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    ).toBe(true);
    await attachScreenshot(testInfo, page, "tutorial-narrow-viewport");
    for (const title of [
      "Antes de empezar el turno",
      "Del producto a la comanda",
      "Confirmá el pago, no solo el pedido",
      "Ya conocés el recorrido esencial",
    ]) {
      await page
        .getByRole("button", { name: "Empezar recorrido" })
        .or(page.getByRole("button", { name: "Siguiente" }))
        .click();
      await expect(page.getByRole("heading", { name: title })).toBeInViewport();
    }
    await page.getByRole("button", { name: "Finalizar tutorial" }).click();
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(settingsName).toHaveValue("Borrador sin guardar");
    await settingsName.fill(originalName);
    await page.getByRole("tab", { name: "Tutorial", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.gastronomy.getTutorialProgress()))
      .toMatchObject({ version: 1, status: "COMPLETED", stepId: "finish" });
    await page.reload();
    await expect(page.getByTestId("user-tutorial")).toHaveCount(0);
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(
      page.getByLabel("Nombre visible", { exact: true }),
    ).toHaveValue(originalName);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      )
      .catch(() => undefined);
    await app.close();
    await removeProfile(profile);
  }
});
