import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  attachInteractionDiagnostics,
  installInteractionDiagnostics,
} from "./interaction-diagnostics";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-waiter-focus-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await installInteractionDiagnostics(page);
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
});

test.afterEach(async ({}, info) => {
  try {
    await attachInteractionDiagnostics(
      page,
      app,
      info,
      "waiter-focus-state",
    );
  } catch (error) {
    console.warn("Waiter focus diagnostics failed", error);
  }
  await page
    ?.evaluate(() => {
      const harness = (window as Window & { __waiterFocusHarness?: { restore(): void } })
        .__waiterFocusHarness;
      harness?.restore();
    })
    .catch(() => {});
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-waiter-focus-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

test("recupera el foco del nombre de mozo después de corregir el número inválido", async () => {
  test.setTimeout(90_000);
  const waiter = await page.evaluate(() =>
    window.gastronomy.createUser({
      fullName: "Mozo recuperación foco",
      roleCode: "WAITER",
      pin: "2468",
      authorizerPin: "1234",
    }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  const table = page.getByLabel("Número de mesa");
  await table.fill("68");
  await table.press("Enter");
  await expect(page.getByText("Mesa 68 creada", { exact: true })).toBeVisible();
  const waiterNumber = page.getByLabel(/^Número de mozo/);
  const waiterName = page.getByLabel(/^Nombre de mozo/);
  await expect(waiterNumber).toBeFocused();
  await expect(waiterName.locator("option", { hasText: waiter.fullName })).toHaveCount(1);

  // Hold only callbacks from the focus helper; native RAF remains available to
  // React, Playwright, and all unrelated application work.
  await page.evaluate(() => {
    const nativeRequest = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    let nextId = -1;
    let cancelled = 0;
    const held = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      if (callback.toString().includes("preventScroll")) {
        const id = nextId--;
        held.set(id, callback);
        return id;
      }
      return nativeRequest(callback);
    };
    window.cancelAnimationFrame = (id) => {
      if (held.delete(id)) {
        cancelled += 1;
        return;
      }
      nativeCancel(id);
    };
    (window as Window & {
      __waiterFocusHarness?: {
        count(): number;
        cancellations(): number;
        release(): void;
        restore(): void;
      };
    }).__waiterFocusHarness = {
      count: () => held.size,
      cancellations: () => cancelled,
      release: () => {
        const callbacks = [...held.values()];
        held.clear();
        callbacks.forEach((callback) => nativeRequest(callback));
      },
      restore: () => {
        window.requestAnimationFrame = nativeRequest;
        window.cancelAnimationFrame = nativeCancel;
      },
    };
  });

  await waiterNumber.fill("999");
  await waiterName.selectOption({ index: 0 });
  await waiterName.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "No existe un mozo activo",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as Window & { __waiterFocusHarness?: { count(): number } })
          .__waiterFocusHarness?.count(),
      ),
    )
    .toBe(1);

  await waiterNumber.fill(String(waiter.staffNumber));
  await waiterName.selectOption({ label: waiter.fullName });
  await expect(waiterNumber).toHaveValue(String(waiter.staffNumber));
  await expect(waiterName).toHaveValue(waiter.id);
  await waiterName.focus();
  await expect(waiterName).toBeFocused();
  await page.evaluate(() => {
    const harness = (window as Window & {
      __waiterFocusHarness?: { release(): void; restore(): void };
    }).__waiterFocusHarness!;
    harness.release();
    harness.restore();
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(waiterName).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & {
            __waiterFocusHarness?: { cancellations(): number };
          }
        ).__waiterFocusHarness?.cancellations(),
      ),
    )
    .toBeGreaterThan(0);


  await waiterName.press("Enter");
  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const created = await page.evaluate(
    async ({ staffId }) =>
      (await window.gastronomy.bootstrap()).orders.filter(
        (order) => order.tableNumber === 68 && order.waiterUserId === staffId,
      ),
    { staffId: waiter.id },
  );
  expect(created).toHaveLength(1);
  expect(created[0]?.waiterName).toBe(waiter.fullName);
});

test("el avance rápido mesa-mozo continúa abriendo el pedido correcto", async () => {
  test.setTimeout(180_000);
  const waiter = await page.evaluate(() =>
    window.gastronomy.createUser({
      fullName: "Mozo avance repetido",
      roleCode: "WAITER",
      pin: "2468",
      authorizerPin: "1234",
    }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  const table = page.getByLabel("Número de mesa");
  const waiterNumber = page.getByLabel(/^Número de mozo/);
  const waiterName = page.getByLabel(/^Nombre de mozo/);

  for (let index = 0; index < 10; index += 1) {
    const tableNumber = 80 + index;
    await table.fill(String(tableNumber));
    await table.press("Enter");
    await expect(
      page.getByText(`Mesa ${tableNumber} creada`, { exact: true }),
    ).toBeVisible();
    await expect(waiterNumber).toBeFocused();
    await waiterNumber.fill(String(waiter.staffNumber));
    await waiterNumber.press("Enter");
    await expect(waiterName).toBeFocused();
    await waiterName.selectOption({ label: waiter.fullName });
    await waiterName.press("Enter");
    const editor = page.getByRole("dialog", {
      name: /Pedido #\d+ · Salón/,
    });
    await expect(editor).toBeVisible();
    const orders = await page.evaluate(
      async ({ tableNumber, staffId }) =>
        (await window.gastronomy.bootstrap()).orders.filter(
          (order) =>
            order.tableNumber === tableNumber &&
            order.waiterUserId === staffId,
        ),
      { tableNumber, staffId: waiter.id },
    );
    expect(orders).toHaveLength(1);
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
  }
});
