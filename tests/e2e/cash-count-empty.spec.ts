import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidenceDir = resolve(
  "docs/qa/evidence/system-usability-known-bugs-fix-2026-10-09",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function launchWithCash() {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-cash-count-empty-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  const actualUserData = await app.evaluate(({ app: electronApp }) =>
    electronApp.getPath("userData"),
  );
  expect(resolve(actualUserData)).toBe(resolve(profile));
  await page.getByRole("link", { name: "Caja" }).waitFor();
  const session = await page.evaluate(async () => {
    const api = window.gastronomy;
    const opened = await api.openCashSession({ openingAmountMinor: 100_000 });
    await api.registerCashMovement({
      type: "INCOME",
      amountMinor: 500_000,
      reason: "US22 fixture",
      paymentMethodCode: "CASH",
      idempotencyKey: crypto.randomUUID(),
    });
    return { id: opened.id };
  });
  await page.reload();
  await page.getByRole("link", { name: "Caja" }).click();
  await mkdir(evidenceDir, { recursive: true });
  return session;
}

async function openCloseDialog() {
  await page.getByRole("button", { name: /Conciliar y cerrar caja/ }).click();
  return page.getByRole("dialog", { name: "Conciliar y cerrar caja" });
}

async function nativeCapture(name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
    );
  });
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(join(evidenceDir, name), Buffer.from(png, "base64"));
}

async function sessionSnapshot(sessionId: string) {
  return page.evaluate(async (cashSessionId) => {
    const api = window.gastronomy;
    return {
      bootstrap: await api.bootstrap(),
      report: await api.getCashSessionReport({ cashSessionId }),
    };
  }, sessionId);
}

test("blank count stays pending instead of previewing zero, shortage, or invalid float", async () => {
  test.setTimeout(180_000);
  const session = await launchWithCash();
  const before = await sessionSnapshot(session.id);
  const dialog = await openCloseDialog();
  const counted = dialog.getByLabel("Total contado en caja");
  const float = dialog.getByLabel("Cambio final para la próxima caja");

  expect(await counted.inputValue()).toBe("");
  expect(await float.inputValue()).toBe("1000");
  await expect(dialog.getByText("Diferencia de arqueo", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Efectivo a retirar", { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByText("El cambio final no puede superar el efectivo contado."),
  ).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Revisar cierre" })).toBeDisabled();
  await nativeCapture("blank-count-pending.png");

  await counted.fill("0");
  await expect(dialog.getByText("Diferencia de arqueo", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("El cambio final no puede superar el efectivo contado."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Revisar cierre" })).toBeDisabled();
  await nativeCapture("explicit-zero-shortage.png");

  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await sessionSnapshot(session.id)).toEqual(before);
  await writeFile(
    join(evidenceDir, "blank-count-no-write.json"),
    JSON.stringify({ blankDidNotSubmit: true, explicitZeroRemainsKnownCount: true }, null, 2),
  );
});

test("count preview appears only after a valid count and blank/malformed input cannot submit", async () => {
  test.setTimeout(180_000);
  const session = await launchWithCash();
  const before = await sessionSnapshot(session.id);
  const dialog = await openCloseDialog();
  const counted = dialog.getByLabel("Total contado en caja");
  const float = dialog.getByLabel("Cambio final para la próxima caja");

  await counted.fill("6000");
  await expect(dialog.getByText("Diferencia de arqueo", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Efectivo a retirar", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Revisar cierre" })).toBeEnabled();
  await counted.fill("abc");
  await expect(dialog.getByRole("button", { name: "Revisar cierre" })).toBeDisabled();
  await expect(dialog.getByText("El cambio final no puede superar el efectivo contado.")).toHaveCount(0);
  await counted.fill("6000");
  await float.fill("7000");
  await expect(dialog.getByText("El cambio final no puede superar el efectivo contado.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Revisar cierre" })).toBeDisabled();
  await counted.fill("");
  await expect(dialog.getByText("Diferencia de arqueo", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Efectivo a retirar", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("El cambio final no puede superar el efectivo contado.")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Revisar cierre" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(await sessionSnapshot(session.id)).toEqual(before);
});

test.afterEach(async () => {
  if (app) {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
    await app.close();
  }
  if (profile) {
    const target = resolve(profile);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith("gastronomy-cash-count-empty-")
    )
      throw new Error("Refusing to clean profile outside isolated temp directory");
    await rm(target, { recursive: true, force: true });
  }
});
