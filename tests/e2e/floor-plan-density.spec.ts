import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-floor-density-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-floor-density-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function createCrowdedSector(count = 60) {
  const fixture = await page.evaluate(async (count) => {
    const api = window.gastronomy;
    const sector = await api.createTableSector({ name: `Densidad ${count}` });
    await api.configureTables({ count });
    let state = await api.bootstrap();
    const tables = state.tables.filter((table) => table.active).slice(0, count);
    for (const [index, table] of tables.entries()) {
      await api.updateTable({
        tableId: table.id,
        number: table.number,
        name: `Mesa densa ${table.number}`,
        active: true,
        sectorId: sector.id,
        layoutX: index % 3,
        layoutY: index % 2,
        layoutWidth: index % 5 === 0 ? 24 : 18,
        layoutHeight: index % 5 === 0 ? 22 : 16,
        shape: index % 4 === 0 ? "RECTANGLE" : "SQUARE",
      });
    }
    const obstacle = await api.createFloorPlanShape({
      sectorId: sector.id,
      kind: "RECTANGLE",
      label: "Columna central",
      color: "#22C55E",
      layoutX: 44,
      layoutY: 38,
      layoutWidth: 12,
      layoutHeight: 20,
    });
    state = await api.bootstrap();
    return {
      sector,
      tables: state.tables.filter((t) => t.sectorId === sector.id),
      obstacle,
    };
  }, count);
  return fixture;
}

async function openFloorPlan() {
  // Fixtures use IPC directly; refresh the bootstrap query before rendering them.
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
}

async function waitForLayout() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function currentSnapshot(sectorId: string) {
  return page.evaluate(async (sectorId) => {
    const state = await window.gastronomy.bootstrap();
    const tables = state.tables.filter((table) => table.sectorId === sectorId);
    return {
      tables: tables.map((table) => ({
        id: table.id,
        number: table.number,
        name: table.name,
        shape: table.shape,
        layoutX: table.layoutX,
        layoutY: table.layoutY,
        layoutWidth: table.layoutWidth,
        layoutHeight: table.layoutHeight,
      })),
      orders: state.orders,
      cashSession: state.cashSession,
      products: state.products.map((product) => ({
        id: product.id,
        stockMinor: product.stockMinor,
      })),
      shapes: state.floorPlanShapes.filter(
        (shape) => shape.sectorId === sectorId,
      ),
    };
  }, sectorId);
}

async function expectDomTablesDoNotOverlap() {
  const boxes = await page
    .locator('[data-floor-canvas] button[aria-label^="Editar mesa "]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
      }),
    );
  expect(boxes.length).toBeGreaterThan(0);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(
        a.right <= b.x + 0.5 ||
          b.right <= a.x + 0.5 ||
          a.bottom <= b.y + 0.5 ||
          b.bottom <= a.y + 0.5,
        `DOM table bounds ${i} and ${j} must not overlap`,
      ).toBe(true);
    }
}

function expectGeometryDoesNotOverlap(
  tables: Array<{
    number: number;
    layoutX: number;
    layoutY: number;
    layoutWidth: number;
    layoutHeight: number;
  }>,
) {
  for (let i = 0; i < tables.length; i++)
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]!;
      const b = tables[j]!;
      expect(
        a.layoutX + a.layoutWidth <= b.layoutX + 0.001 ||
          b.layoutX + b.layoutWidth <= a.layoutX + 0.001 ||
          a.layoutY + a.layoutHeight <= b.layoutY + 0.001 ||
          b.layoutY + b.layoutHeight <= a.layoutY + 0.001,
        `Stored geometry for tables ${a.number} and ${b.number} must not overlap`,
      ).toBe(true);
    }
}

test("mantiene el plano personalizado al navegar y cancelar compactación", async () => {
  const fixture = await createCrowdedSector();
  await openFloorPlan();
  await expect(
    page.getByRole("tab", { name: `${fixture.sector.name} · 60` }),
  ).toBeVisible();
  await page.getByRole("tab", { name: `${fixture.sector.name} · 60` }).click();
  const before = await currentSnapshot(fixture.sector.id);
  await page.getByRole("tab", { name: "Vista clásica" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await page.getByRole("tab", { name: `${fixture.sector.name} · 60` }).click();
  expect(await currentSnapshot(fixture.sector.id)).toEqual(before);

  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Ordenar mesas" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Ordenar mesas de ${fixture.sector.name}`,
  });
  await expect(dialog).toContainText(/reemplaza.*posición.*tamaño/i);
  await expect(dialog).toContainText(/números, nombres y formas se conservan/i);
  await expect(dialog).toContainText(/figuras no se mueven/i);
  await expect(dialog).toContainText(
    /pedidos, cobros y stock no se modifican/i,
  );
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(await currentSnapshot(fixture.sector.id)).toEqual(before);

  await page.getByRole("button", { name: "Ordenar mesas" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await currentSnapshot(fixture.sector.id)).toEqual(before);
});

test("compacta 60 mesas sin solapes ni pérdida de pedidos, figuras o geometría de negocio", async () => {
  test.setTimeout(120_000);
  const fixture = await createCrowdedSector();
  const occupied = await page.evaluate(async (tableId) => {
    const api = window.gastronomy;
    const state = await api.bootstrap();
    const table = state.tables.find((item) => item.id === tableId)!;
    const product = state.products.find((item) => item.code === "MUZG")!;
    const draft = await api.createOrder({
      type: "DINE_IN",
      tableId,
      waiterUserId: "user-admin",
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: product.id,
      quantity: 1,
    });
    return api.confirmOrder({ orderId: draft.id });
  }, fixture.tables[0]!.id);
  const before = await currentSnapshot(fixture.sector.id);
  await openFloorPlan();
  await page.getByRole("tab", { name: `${fixture.sector.name} · 60` }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  for (const width of [1100, 1366]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 900),
      width,
    );
    await waitForLayout();
    await page.getByRole("button", { name: "Ordenar mesas" }).click();
    const dialog = page.getByRole("dialog", {
      name: `Ordenar mesas de ${fixture.sector.name}`,
    });
    await dialog.getByRole("button", { name: "Ordenar y compactar" }).click();
    await expect(page.getByRole("status")).toHaveText("Plano guardado.", {
      timeout: 30_000,
    });
    await expect
      .poll(async () =>
        page.getByRole("button", { name: /^Editar mesa / }).count(),
      )
      .toBe(60);
    await waitForLayout();
    await expectDomTablesDoNotOverlap();
    const layout = await currentSnapshot(fixture.sector.id);
    expectGeometryDoesNotOverlap(layout.tables);
    const canvas = page.locator("[data-floor-canvas]");
    const viewport = page.getByRole("region", { name: "Editor del plano" });
    await viewport.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    const viewportBounds = await viewport.boundingBox();
    const canvasBounds = await canvas.boundingBox();
    expect(viewportBounds).not.toBeNull();
    expect(canvasBounds).not.toBeNull();
    expect(canvasBounds!.x).toBeGreaterThanOrEqual(viewportBounds!.x);
    expect(canvasBounds!.x + canvasBounds!.width).toBeLessThanOrEqual(
      viewportBounds!.x + viewportBounds!.width,
    );
    await page.evaluate(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const bitmap = await app.evaluate(async ({ BrowserWindow }) => {
      const image =
        await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
      return { size: image.getSize(), data: image.toPNG().toString("base64") };
    });
    expect(bitmap.size.width).toBeGreaterThan(0);
    const evidencePath = test.info().outputPath(`floor-density-${width}.png`);
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, Buffer.from(bitmap.data, "base64"));
    await test.info().attach(`floor-density-${width}`, {
      body: Buffer.from(bitmap.data, "base64"),
      contentType: "image/png",
    });
    await expect(canvas).toBeVisible();
    if (width === 1100) {
      await page.reload();
      await page.getByRole("link", { name: "Salón" }).click();
      await page.getByRole("tab", { name: "Plano por sectores" }).click();
      await page
        .getByRole("tab", { name: `${fixture.sector.name} · 60` })
        .click();
      await page.getByRole("button", { name: "Editar plano" }).click();
    }
  }
  const after = await currentSnapshot(fixture.sector.id);
  expect(
    after.tables.map(({ layoutX, layoutY, layoutWidth, layoutHeight }) => ({
      layoutX,
      layoutY,
      layoutWidth,
      layoutHeight,
    })),
  ).not.toEqual(
    before.tables.map(({ layoutX, layoutY, layoutWidth, layoutHeight }) => ({
      layoutX,
      layoutY,
      layoutWidth,
      layoutHeight,
    })),
  );
  expect(
    after.tables.map(({ id, number, name, shape }) => ({
      id,
      number,
      name,
      shape,
    })),
  ).toEqual(
    before.tables.map(({ id, number, name, shape }) => ({
      id,
      number,
      name,
      shape,
    })),
  );
  expect(after.orders).toEqual(before.orders);
  expect(after.cashSession).toEqual(before.cashSession);
  expect(after.products).toEqual(before.products);
  expect(after.shapes).toEqual(before.shapes);
  expect(after.orders.some((order) => order.id === occupied.id)).toBe(true);
  await page.reload();
  const persisted = await currentSnapshot(fixture.sector.id);
  expect(persisted.tables).toEqual(after.tables);
});

test("permite altas consecutivas con números mayores de 100 y tamaño estándar sin solapes", async () => {
  const fixture = await createCrowdedSector(12);
  // Start from a known, compact grid using the product action, then stress consecutive additions.
  await openFloorPlan();
  await page.getByRole("tab", { name: `${fixture.sector.name} · 12` }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Ordenar mesas" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ordenar y compactar" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Plano guardado.");
  await page.getByRole("button", { name: "Terminar edición" }).click();
  const newNumber = await page.evaluate(
    async () =>
      Math.max(
        ...(await window.gastronomy.bootstrap()).tables.map(
          (table) => table.number,
        ),
      ) + 101,
  );
  await page.getByRole("button", { name: "Editar plano" }).click();
  for (let index = 0; index < 8; index++) {
    await page.getByRole("button", { name: "Nueva mesa" }).click();
    const dialog = page.getByRole("dialog", { name: /Agregar mesa a/ });
    await dialog.getByLabel("Número de mesa").fill(String(newNumber + index));
    await dialog.getByRole("button", { name: "Agregar mesa" }).click();
    const addedTable = page.getByRole("button", {
      name: `Editar mesa ${newNumber + index}`,
    });
    await expect(addedTable).toBeVisible();
    const geometry = await page.evaluate(async (number) => {
      const table = (await window.gastronomy.bootstrap()).tables.find(
        (item) => item.number === number,
      )!;
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-floor-canvas] button[aria-label^="Editar mesa "]',
        ),
      ].find(
        (item) => item.getAttribute("aria-label") === `Editar mesa ${number}`,
      )!;
      const node = button.parentElement!;
      return {
        layoutWidth: table.layoutWidth,
        layoutHeight: table.layoutHeight,
        pixelWidth: node.offsetWidth,
        pixelHeight: node.offsetHeight,
      };
    }, newNumber + index);
    expect(geometry).toEqual({
      layoutWidth: 6,
      layoutHeight: 9,
      pixelWidth: 108,
      pixelHeight: 108,
    });
  }
  await expectDomTablesDoNotOverlap();
});

test("figura que bloquea todo el canvas impide alta y compactación sin mutaciones", async () => {
  const fixture = await createCrowdedSector(8);
  await page.evaluate(async (sectorId) => {
    const api = window.gastronomy;
    await api.createFloorPlanShape({
      sectorId,
      kind: "RECTANGLE",
      label: "Bloqueo total",
      color: "#ef4444",
      layoutX: 0,
      layoutY: 0,
      layoutWidth: 100,
      layoutHeight: 100,
    });
  }, fixture.sector.id);
  const before = await currentSnapshot(fixture.sector.id);
  await openFloorPlan();
  await page.getByRole("tab", { name: `${fixture.sector.name} · 8` }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Nueva mesa" }).click();
  const addDialog = page.getByRole("dialog", { name: /Agregar mesa a/ });
  const nextNumber =
    Math.max(...before.tables.map((table) => table.number)) + 1;
  await addDialog.getByLabel("Número de mesa").fill(String(nextNumber));
  await addDialog.getByRole("button", { name: "Agregar mesa" }).click();
  await expect(page.getByText(/No hay espacio suficiente/i)).toBeVisible();
  expect((await currentSnapshot(fixture.sector.id)).tables).toEqual(
    before.tables,
  );
  await page.keyboard.press("Escape");
  await expect(addDialog).toBeHidden();
  await page.getByRole("button", { name: "Ordenar mesas" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ordenar y compactar" })
    .click();
  await expect(page.getByText(/No hay espacio suficiente/i)).toBeVisible();
  const after = await currentSnapshot(fixture.sector.id);
  expect(after.tables).toEqual(before.tables);
  expect(after.orders).toEqual(before.orders);
  expect(after.cashSession).toEqual(before.cashSession);
  expect(after.products).toEqual(before.products);
});

test("reporta un fallo parcial real y permite reintentar hasta converger", async () => {
  const fixture = await createCrowdedSector(10);
  const before = await currentSnapshot(fixture.sector.id);
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get(
      "gastronomy:updateTable",
    );
    if (typeof original !== "function")
      throw Error("missing updateTable handler");
    (globalThis as any).__densityUpdateTableOriginal = original;
    let calls = 0;
    ipcMain.removeHandler("gastronomy:updateTable");
    ipcMain.handle("gastronomy:updateTable", (...args: any[]) => {
      calls++;
      if (calls === 3) throw Error("IPC test failure");
      return original(...args);
    });
  });
  await openFloorPlan();
  await page.getByRole("tab", { name: `${fixture.sector.name} · 10` }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Ordenar mesas" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ordenar y compactar" })
    .click();
  await expect(page.getByText(/^Se ordenaron 2 de 10 mesas\./i)).toBeVisible();
  const partial = await currentSnapshot(fixture.sector.id);
  expect(
    partial.tables.filter((table, index) => {
      const original = before.tables[index]!;
      return (
        table.layoutX !== original.layoutX ||
        table.layoutY !== original.layoutY ||
        table.layoutWidth !== original.layoutWidth ||
        table.layoutHeight !== original.layoutHeight
      );
    }).length,
  ).toBe(2);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("gastronomy:updateTable");
    ipcMain.handle(
      "gastronomy:updateTable",
      (globalThis as any).__densityUpdateTableOriginal,
    );
  });
  await page.getByRole("button", { name: "Ordenar mesas" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ordenar y compactar" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Plano guardado.");
  await expectDomTablesDoNotOverlap();
  const final = await currentSnapshot(fixture.sector.id);
  expect(
    final.tables.map(({ id, number, name, shape }) => ({
      id,
      number,
      name,
      shape,
    })),
  ).toEqual(
    before.tables.map(({ id, number, name, shape }) => ({
      id,
      number,
      name,
      shape,
    })),
  );
  expect(final.orders).toEqual(before.orders);
  expect(final.cashSession).toEqual(before.cashSession);
  expect(final.products).toEqual(before.products);
});
