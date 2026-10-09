import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidenceDir = resolve(
  "docs/qa/evidence/system-usability-cash-input-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function launchWithCash() {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-qa01-fix-"));
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
  const setup = await page.evaluate(async () => {
    const api = (window as any).gastronomy;
    const opened = await api.openCashSession({ openingAmountMinor: 100_000 });
    await api.registerCashMovement({
      type: "INCOME",
      amountMinor: 500_000,
      reason: "Ingreso QA01 aislamiento",
      paymentMethodCode: "CASH",
    });
    return { id: opened.id, number: opened.number };
  });
  await page.reload();
  await page.getByRole("link", { name: "Caja" }).click();
  await mkdir(evidenceDir, { recursive: true });
  return setup as { id: string; number: number };
}

async function nativeCapture(name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  });
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await writeFile(join(evidenceDir, name), Buffer.from(png, "base64"));
}

async function openCloseDialog() {
  await page.getByRole("button", { name: /Conciliar y cerrar caja/ }).click();
  return page.getByRole("dialog", { name: "Conciliar y cerrar caja" });
}

async function bootstrapSnapshot() {
  return page.evaluate(async () => {
    const data = await (window as any).gastronomy.bootstrap();
    return {
      cashSession: data.cashSession,
      orders: data.orders,
      customers: data.customers,
      movements: data.cashSession?.movements,
    };
  });
}

test("conserva los importes al abrir/reabrir y volver de revisión sin alterar la sesión", async () => {
  test.setTimeout(180_000);
  const setup = await launchWithCash();
  const before = await bootstrapSnapshot();
  const observations: unknown[] = [];

  for (let cycle = 0; cycle < 22; cycle++) {
    const dialog = await openCloseDialog();
    const counted = dialog.getByLabel("Total contado en caja");
    const float = dialog.getByLabel("Cambio final para la próxima caja");
    const reason = dialog.getByLabel("Motivo de la diferencia");
    // Deliberately fill immediately after opening: no focus/seed/readiness step.
    await counted.fill("5900");
    await float.fill("1500");
    const instant = {
      cycle,
      counted: await counted.inputValue(),
      closingFloat: await float.inputValue(),
    };
    await writeFile(
      join(evidenceDir, "rapid-immediate-values.json"),
      JSON.stringify(instant, null, 2),
    );
    expect(instant.closingFloat).toBe("1500");
    await reason.fill("Conteo QA01");
    expect(await counted.inputValue()).toBe("5900");
    expect(await reason.inputValue()).toBe("Conteo QA01");
    await dialog.getByRole("button", { name: "Revisar cierre" }).click();
    const review = page.getByRole("dialog", {
      name: "Confirmar cierre definitivo",
    });
    await expect(
      review.getByText("Cambio final", { exact: true }).locator(".."),
    ).toContainText("1.500");
    await expect(
      review.getByText("Contado sin cambio", { exact: true }).locator(".."),
    ).toContainText("4.400");
    await expect(
      review.getByText("Diferencia de arqueo", { exact: true }).locator(".."),
    ).toContainText(/-\s*\$\s*100/);
    await review.getByRole("button", { name: "Volver a revisar" }).click();
    const returned = page.getByRole("dialog", {
      name: "Conciliar y cerrar caja",
    });
    expect(
      await returned.getByLabel("Total contado en caja").inputValue(),
    ).toBe("5900");
    expect(
      await returned
        .getByLabel("Cambio final para la próxima caja")
        .inputValue(),
    ).toBe("1500");
    expect(
      await returned.getByLabel("Motivo de la diferencia").inputValue(),
    ).toBe("Conteo QA01");
    observations.push({
      cycle,
      counted: "5900",
      closingFloat: "1500",
      reason: "Conteo QA01",
    });
    await returned.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await bootstrapSnapshot()).toEqual(before);
  }
  await writeFile(
    join(evidenceDir, "rapid-open-review-back.json"),
    JSON.stringify({ session: setup, observations }, null, 2),
  );
});

test("permite edición nativa por teclado, preserva retorno y reinicia al cancelar y reabrir", async () => {
  const setup = await launchWithCash();
  const before = await bootstrapSnapshot();
  const dialog = await openCloseDialog();
  const counted = dialog.getByLabel("Total contado en caja");
  const float = dialog.getByLabel("Cambio final para la próxima caja");
  const reason = dialog.getByLabel("Motivo de la diferencia");
  await counted.fill("5900");
  await float.click();
  await float.press("ControlOrMeta+A");
  await float.pressSequentially("1800");
  expect(await float.inputValue()).toBe("1800");
  await float.press("Home");
  await float.press("Delete");
  expect(await float.inputValue()).toBe("800");
  await float.press("ControlOrMeta+A");
  await float.pressSequentially("1500");
  expect(await float.inputValue()).toBe("1500");
  await reason.fill("Edición nativa QA01");
  await dialog.getByRole("button", { name: "Revisar cierre" }).click();
  const review = page.getByRole("dialog", {
    name: "Confirmar cierre definitivo",
  });
  await expect(
    review.getByText("Cambio final", { exact: true }).locator(".."),
  ).toContainText("1.500");
  await nativeCapture("keyboard-review.png");
  await review.getByRole("button", { name: "Volver a revisar" }).click();
  const returned = page.getByRole("dialog", {
    name: "Conciliar y cerrar caja",
  });
  expect(await returned.getByLabel("Total contado en caja").inputValue()).toBe(
    "5900",
  );
  expect(
    await returned.getByLabel("Cambio final para la próxima caja").inputValue(),
  ).toBe("1500");
  expect(
    await returned.getByLabel("Motivo de la diferencia").inputValue(),
  ).toBe("Edición nativa QA01");
  await returned.getByRole("button", { name: "Cancelar" }).click();

  const reopened = await openCloseDialog();
  expect(await reopened.getByLabel("Total contado en caja").inputValue()).toBe(
    "",
  );
  expect(
    await reopened.getByLabel("Cambio final para la próxima caja").inputValue(),
  ).toBe("1000");
  await reopened.getByLabel("Total contado en caja").fill("5900");
  expect(
    await reopened.getByLabel("Motivo de la diferencia").inputValue(),
  ).toBe("");
  await reopened.getByLabel("Total contado en caja").fill("5900");
  await reopened.getByLabel("Cambio final para la próxima caja").fill("1500");
  expect(
    await reopened.getByLabel("Cambio final para la próxima caja").inputValue(),
  ).toBe("1500");
  await reopened.getByRole("button", { name: "Cancelar" }).click();
  expect(await bootstrapSnapshot()).toEqual(before);
  await writeFile(
    join(evidenceDir, "native-keyboard-edit.json"),
    JSON.stringify(
      {
        session: setup,
        reopenedDefaults: { openingFloat: "1000", counted: "" },
        canceledLedgerUnchanged: true,
      },
      null,
      2,
    ),
  );
});

test("valida el cambio final, requiere motivo y persiste el cierre real", async () => {
  const setup = await launchWithCash();
  const dialog = await openCloseDialog();
  const counted = dialog.getByLabel("Total contado en caja");
  const float = dialog.getByLabel("Cambio final para la próxima caja");
  await counted.fill("5900");
  await float.fill("6000");
  await expect(
    dialog.getByText("El cambio final no puede superar el efectivo contado."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeDisabled();
  await float.fill("1500");
  await expect(
    dialog.getByRole("button", { name: "Revisar cierre" }),
  ).toBeDisabled();
  await dialog.getByLabel("Motivo de la diferencia").fill("Cierre QA01");
  await dialog.getByRole("button", { name: "Revisar cierre" }).click();
  const review = page.getByRole("dialog", {
    name: "Confirmar cierre definitivo",
  });
  await expect(
    review.getByText("Esperado sin cambio", { exact: true }).locator(".."),
  ).toContainText("4.500");
  await expect(
    review.getByText("Contado sin cambio", { exact: true }).locator(".."),
  ).toContainText("4.400");
  await expect(
    review.getByText("Diferencia de arqueo", { exact: true }).locator(".."),
  ).toContainText(/-\s*\$\s*100/);
  await expect(
    review.getByText("Efectivo a retirar", { exact: true }).locator(".."),
  ).toContainText("4.400");
  await review
    .getByRole("button", { name: "Confirmar cierre definitivo" })
    .click();
  const report = page.getByRole("dialog", { name: "Informe de caja" });
  await expect(report).toBeVisible();
  await nativeCapture("persisted-close-report.png");
  await expect(
    report.getByRole("button", { name: "Confirmar cierre definitivo" }),
  ).toHaveCount(0);
  const persisted = await page.evaluate(async (cashSessionId) => {
    const api = (window as any).gastronomy;
    const data = await api.bootstrap();
    const sessionReport = await api.getCashSessionReport({ cashSessionId });
    const next = await api.openCashSession({ openingAmountMinor: 150_000 });
    return { active: data.cashSession, report: sessionReport.session, next };
  }, setup.id);
  expect(persisted.active).toBeNull();
  expect(persisted.report.countedAmountMinor).toBe(590_000);
  expect(persisted.report.closingFloatAmountMinor).toBe(150_000);
  expect(persisted.report.expectedAmountMinor).toBe(600_000);
  expect(persisted.report.cashRemovedAmountMinor).toBe(440_000);
  expect(persisted.report.differenceMinor).toBe(-10_000);
  expect(persisted.next.openingAmountMinor).toBe(150_000);
  await writeFile(
    join(evidenceDir, "validated-close.json"),
    JSON.stringify(
      {
        session: setup,
        countedAmountMinor: persisted.report.countedAmountMinor,
        closingFloatAmountMinor: persisted.report.closingFloatAmountMinor,
        expectedAmountMinor: persisted.report.expectedAmountMinor,
        cashRemovedAmountMinor: persisted.report.cashRemovedAmountMinor,
        differenceMinor: persisted.report.differenceMinor,
        nextOpeningAmountMinor: persisted.next.openingAmountMinor,
      },
      null,
      2,
    ),
  );
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
      !basename(target).startsWith("gastronomy-qa01-fix-")
    )
      throw new Error(
        "Refusing to clean profile outside qa01 isolated temp directory",
      );
    await rm(target, { recursive: true, force: true });
  }
});
