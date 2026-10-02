import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: ElectronApplication;
let page: Page;
let userData = "";

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-vector-plan-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
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

test("redimensiona una mesa y conserva sus dimensiones tras recarga", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  const number = await page.evaluate(
    async () =>
      Math.max(
        ...(await window.gastronomy.bootstrap()).tables.map((t) => t.number),
      ) + 1,
  );
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Nueva mesa" }).click();
  const dialog = page.getByRole("dialog", { name: /Agregar mesa a/ });
  await dialog.getByLabel("Número de mesa").fill(String(number));
  await dialog.getByRole("button", { name: "Agregar mesa" }).click();
  await expect(
    page.getByRole("button", { name: `Editar mesa ${number}` }),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: `Editar mesa ${number}` }).click();
  const before = await page.evaluate(
    async (n) =>
      (await window.gastronomy.bootstrap()).tables.find((t) => t.number === n),
    number,
  );
  const handle = page.getByRole("button", {
    name: `Redimensionar mesa ${number} hacia sureste`,
  });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.getAttribute("aria-label"),
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      ),
    ).toBe(`Redimensionar mesa ${number} hacia sureste`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 60,
      box.y + box.height / 2 + 45,
    );
    await page.mouse.up();
  }
  await expect(page.getByRole("status")).toHaveText("Plano guardado.");
  await expect
    .poll(async () =>
      page.evaluate(
        async ({ n, width, height }) => {
          const resized = (await window.gastronomy.bootstrap()).tables.find(
            (t) => t.number === n,
          );
          return Boolean(
            resized &&
            resized.layoutWidth > width &&
            resized.layoutHeight > height,
          );
        },
        {
          n: number,
          width: before?.layoutWidth ?? 0,
          height: before?.layoutHeight ?? 0,
        },
      ),
    )
    .toBe(true);
  const after = await page.evaluate(
    async (n) =>
      (await window.gastronomy.bootstrap()).tables.find((t) => t.number === n),
    number,
  );
  expect(after?.layoutWidth).toBeGreaterThan(before?.layoutWidth ?? 0);
  expect(after?.layoutHeight).toBeGreaterThan(before?.layoutHeight ?? 0);
  expect(after?.layoutWidth).toBeGreaterThanOrEqual(6);
  expect(after?.layoutHeight).toBeGreaterThanOrEqual(7);
  await page.reload();
  const persisted = await page.evaluate(
    async (n) =>
      (await window.gastronomy.bootstrap()).tables.find((t) => t.number === n),
    number,
  );
  expect(persisted).toMatchObject({
    id: after?.id,
    layoutWidth: after?.layoutWidth,
    layoutHeight: after?.layoutHeight,
  });
});

test("dibuja un polígono, edita un nodo y persiste geometría y relleno", async () => {
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  await page.getByRole("button", { name: "Editar plano" }).click();
  await page.getByRole("button", { name: "Dibujar área" }).click();
  const drawingSurface = page.getByLabel("Área de dibujo por nodos");
  const bounds = await drawingSurface.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  for (const [x, y] of [
    [0.2, 0.2],
    [0.58, 0.2],
    [0.7, 0.58],
    [0.3, 0.72],
  ])
    await drawingSurface.click({
      position: { x: bounds.width * x, y: bounds.height * y },
    });
  await page.getByRole("button", { name: "Cerrar polígono" }).click();
  await expect(page.getByRole("status")).toHaveText("Plano guardado.");
  const shape = page.getByRole("button", {
    name: "Editar figura Área dibujada",
  });
  await expect(shape).toBeVisible();
  await shape.click();
  const node = page.getByRole("button", {
    name: "Editar nodo 2 de figura Área dibujada",
  });
  const nodeBox = await node.boundingBox();
  expect(nodeBox).not.toBeNull();
  if (nodeBox) {
    await page.mouse.move(
      nodeBox.x + nodeBox.width / 2,
      nodeBox.y + nodeBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(nodeBox.x + 35, nodeBox.y + 25);
    await page.mouse.up();
  }
  await expect(page.getByRole("status")).toHaveText("Figura guardada.");
  const beforeResize = await page.evaluate(async () =>
    (await window.gastronomy.bootstrap()).floorPlanShapes.find(
      (item) => item.label === "Área dibujada",
    ),
  );
  const shapeHandle = page.getByRole("button", {
    name: "Redimensionar figura Área dibujada hacia este",
  });
  const shapeHandleBox = await shapeHandle.boundingBox();
  expect(shapeHandleBox).not.toBeNull();
  if (shapeHandleBox) {
    await page.mouse.move(
      shapeHandleBox.x + shapeHandleBox.width / 2,
      shapeHandleBox.y + shapeHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(shapeHandleBox.x + 55, shapeHandleBox.y);
    await page.mouse.up();
  }
  await expect(page.getByRole("status")).toHaveText("Figura guardada.");
  const saved = await page.evaluate(async () =>
    (await window.gastronomy.bootstrap()).floorPlanShapes.find(
      (s) => s.label === "Área dibujada",
    ),
  );
  const heightHandle = page.getByRole("button", {
    name: "Redimensionar figura Área dibujada hacia sur",
    exact: true,
  });
  await heightHandle.scrollIntoViewIfNeeded();
  const heightHandleBox = await heightHandle.boundingBox();
  expect(heightHandleBox).not.toBeNull();
  if (heightHandleBox) {
    const pointerTarget = await page.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        return {
          label: target?.getAttribute("aria-label"),
          viewportHeight: window.innerHeight,
        };
      },
      {
        x: heightHandleBox.x + heightHandleBox.width / 2,
        y: heightHandleBox.y + heightHandleBox.height / 2,
      },
    );
    expect(pointerTarget.label).toBe(
      "Redimensionar figura Área dibujada hacia sur",
    );
    expect(heightHandleBox.y + heightHandleBox.height / 2 + 50).toBeLessThan(
      pointerTarget.viewportHeight,
    );
    await page.mouse.move(
      heightHandleBox.x + heightHandleBox.width / 2,
      heightHandleBox.y + heightHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      heightHandleBox.x + heightHandleBox.width / 2,
      heightHandleBox.y + heightHandleBox.height / 2 + 50,
    );
    await page.mouse.up();
  }
  await expect
    .poll(async () =>
      page.evaluate(
        async () =>
          (await window.gastronomy.bootstrap()).floorPlanShapes.find(
            (s) => s.label === "Área dibujada",
          )?.layoutHeight ?? 0,
      ),
    )
    .toBeGreaterThan(saved?.layoutHeight ?? 0);
  const resized = await page.evaluate(async () =>
    (await window.gastronomy.bootstrap()).floorPlanShapes.find(
      (s) => s.label === "Área dibujada",
    ),
  );
  expect(saved).toMatchObject({
    kind: "POLYGON",
    fillOpacity: 0.32,
    points: expect.arrayContaining([expect.any(Object)]),
  });
  expect(saved?.points).toHaveLength(4);
  expect(saved?.layoutWidth).toBeGreaterThan(beforeResize?.layoutWidth ?? 0);
  expect(resized?.layoutHeight).toBeGreaterThan(saved?.layoutHeight ?? 0);
  await page.reload();
  expect(
    await page.evaluate(async () =>
      (await window.gastronomy.bootstrap()).floorPlanShapes.some(
        (s) => s.label === "Área dibujada",
      ),
    ),
  ).toBe(true);
});
