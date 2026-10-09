import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-floor-controls-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-floor-controls-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(process.env.GASTRONOMY_E2E_BACKGROUND !== "1");
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
});

test.afterEach(async ({}, info) => {
  if (page && !page.isClosed()) {
    await writeFile(
      join(evidence, `${info.testId}-${info.status}.json`),
      JSON.stringify(
        await page.evaluate(async () => ({
          url: location.href,
          bootstrap: await window.gastronomy.bootstrap(),
          scroll: document.querySelector("main > div")?.scrollTop,
        })),
        null,
        2,
      ),
    ).catch(() => {});
  }
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-floor-controls-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function capture(file: string) {
  await settle();
  const shot = await app.evaluate(async ({ BrowserWindow }) => {
    const image =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: image.getSize(), data: image.toPNG().toString("base64") };
  });
  expect(shot.size.width).toBeGreaterThan(0);
  await writeFile(join(evidence, file), Buffer.from(shot.data, "base64"));
}

async function setWindow(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, { width, height }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(width, height);
    },
    { width, height },
  );
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getSize(),
    ),
  ).toEqual([width, height]);
  await settle();
}

async function mainScrollToTop() {
  await page.evaluate(() => {
    const main = document.querySelector("main > div") as HTMLElement | null;
    if (main) main.scrollTop = 0;
  });
  await settle();
}

async function controls() {
  const group = page.getByTestId("floor-plan-zoom-controls");
  await expect(group).toHaveCount(1);
  await expect(group).toBeVisible();
  await expect(group.getByRole("button")).toHaveCount(5);
  for (const label of [
    "Alejar plano",
    "Restablecer zoom",
    "Acercar plano",
    "Ajustar al área",
    "Centrar y restablecer",
  ])
    await expect(
      group.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  return group;
}

async function assertControlsReachable(group: Locator, tag: string) {
  const region = page.getByRole("region", { name: "Editor del plano" });
  // The group must leave the canvas/viewport so it cannot overlay drawing tools.
  expect(
    await region.locator('[data-testid="floor-plan-zoom-controls"]').count(),
  ).toBe(0);
  const [bounds, viewport, quick, toolbar] = await Promise.all([
    group.boundingBox(),
    page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    page
      .getByRole("button", { name: /^(Editar plano|Terminar edición)$/ })
      .boundingBox(),
    (async () => {
      const drawing = page.locator("[data-floor-drawing-toolbar]");
      const count = await drawing.count();
      expect(count).toBeLessThanOrEqual(1);
      return count ? drawing.boundingBox() : null;
    })(),
  ]);
  expect(bounds, `${tag}: zoom group has a measurable box`).not.toBeNull();
  if (!bounds) return;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  const contentBounds = await page.locator("main > div").boundingBox();
  expect(contentBounds).not.toBeNull();
  expect(bounds.y).toBeGreaterThanOrEqual(contentBounds!.y);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
  expect(bounds.height).toBeGreaterThan(0);
  if (quick) expect(overlaps(bounds, quick)).toBe(false);
  if (toolbar) expect(overlaps(bounds, toolbar)).toBe(false);
  await capture(`${tag}.png`);
}

function overlaps(
  a: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>,
  b: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>,
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

test("mantiene el grupo de zoom único y accesible arriba, fuera del lienzo, en lectura y edición", async () => {
  test.setTimeout(120_000);
  await page.evaluate(async () => {
    for (const name of [
      "Terraza con nombre largo para ubicar sectores",
      "Patio exterior con mesas y sombra",
      "Salón principal de eventos especiales",
    ])
      await window.gastronomy.createTableSector({ name });
  });
  await page.reload();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
  for (const [width, height] of [
    [1100, 768],
    [1100, 820],
    [1366, 768],
    [1366, 820],
  ]) {
    await setWindow(width, height);
    for (const mode of ["lectura", "edicion"] as const) {
      if (mode === "edicion")
        await page.getByRole("button", { name: "Editar plano" }).click();
      const naturalScrollTop = await page.evaluate(
        () =>
          (document.querySelector("main > div") as HTMLElement | null)
            ?.scrollTop ?? null,
      );
      await mainScrollToTop();
      // Do not scroll the target into view: inspect its natural first-viewport position.
      await capture(`before-assert-${width}x${height}-${mode}.png`);
      await writeFile(
        join(evidence, `before-assert-${width}x${height}-${mode}.json`),
        JSON.stringify(
          {
            width,
            height,
            mode,
            naturalScrollTop,
            normalizedScrollTop: await page.evaluate(
              () =>
                (document.querySelector("main > div") as HTMLElement | null)
                  ?.scrollTop ?? null,
            ),
            group: await page
              .getByTestId("floor-plan-zoom-controls")
              .boundingBox(),
            viewport: await page.evaluate(() => ({
              width: innerWidth,
              height: innerHeight,
            })),
          },
          null,
          2,
        ),
      );
      const group = await controls();
      await assertControlsReachable(
        group,
        `viewport-${width}x${height}-${mode}`,
      );
      if (mode === "edicion")
        await page.getByRole("button", { name: "Terminar edición" }).click();
    }
  }
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    baseline,
  );
});

test("preserva zoom, accesos rápidos y dibujo cancelado sin escribir cambios de plano", async () => {
  test.setTimeout(90_000);
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  const region = page.getByRole("region", { name: "Editor del plano" });
  const group = await controls();
  await assertControlsReachable(group, "zoom-before-drawing");
  await group.getByRole("button", { name: "Acercar plano" }).click();
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("118%");
  await group.getByRole("button", { name: "Ajustar al área" }).click();
  const regionBounds = await region.boundingBox();
  expect(regionBounds).not.toBeNull();
  const expectedFit = Math.max(
    0.35,
    Math.min(
      1,
      Math.round(
        Math.min(
          (regionBounds!.width * 0.95) / 1800,
          (regionBounds!.height * 0.95) / 1200,
        ) * 100,
      ) / 100,
    ),
  );
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText(`${Math.round(expectedFit * 100)}%`);
  await group.getByRole("button", { name: "Centrar y restablecer" }).click();
  await group.getByRole("button", { name: "Alejar plano" }).click();
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("85%");
  await group.getByRole("button", { name: "Centrar y restablecer" }).click();
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("100%");

  await region.focus();
  await page.keyboard.press("+");
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("115%");
  await page.keyboard.press("-");
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("100%");
  await page.keyboard.press("0");
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("100%");

  // The external control is a sibling of the region: keyboard events must not bubble
  // through both handlers and apply a compounded zoom.
  await group.getByRole("button", { name: "Acercar plano" }).focus();
  await page.keyboard.press("+");
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("115%");
  await page.keyboard.press("-");
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("100%");
  await page.keyboard.press("0");
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("100%");

  for (
    let i = 0;
    i < 24 &&
    !(await group.getByRole("button", { name: "Acercar plano" }).isDisabled());
    i++
  )
    await group.getByRole("button", { name: "Acercar plano" }).click();
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("300%");
  for (
    let i = 0;
    i < 48 &&
    !(await group.getByRole("button", { name: "Alejar plano" }).isDisabled());
    i++
  )
    await group.getByRole("button", { name: "Alejar plano" }).click();
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("35%");
  await group.getByRole("button", { name: "Centrar y restablecer" }).click();

  const editor = await region.boundingBox();
  expect(editor).not.toBeNull();
  await page.getByRole("button", { name: "Editar plano" }).click();
  for (const tool of ["Dibujar área", "Dibujar línea"]) {
    await group.getByRole("button", { name: "Ajustar al área" }).click();
    await page.getByRole("button", { name: tool, exact: true }).click();
    const drawing = page.locator("[data-floor-drawing-toolbar]");
    await expect(drawing).toBeVisible();
    const [groupBox, drawingBox] = await Promise.all([
      group.boundingBox(),
      drawing.boundingBox(),
    ]);
    expect(groupBox).not.toBeNull();
    expect(drawingBox).not.toBeNull();
    if (groupBox && drawingBox)
      expect(overlaps(groupBox, drawingBox)).toBe(false);
    await region.focus();
    await page.keyboard.press("Escape");
    await expect(drawing).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "Terminar edición" }),
  ).toBeVisible();
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(after.tableSectors).toEqual(before.tableSectors);
  expect(after.tables).toEqual(before.tables);
  expect(after.floorPlanShapes).toEqual(before.floorPlanShapes);
  expect(after.orders).toEqual(before.orders);
  expect(after.cashSession).toEqual(before.cashSession);
  expect(after.settings).toEqual(before.settings);
  await capture("zoom-and-cancel-preserved.png");
});

test("al 200% los controles siguen alcanzables y la carga rápida abre la mesa sin agregar datos al cancelar", async () => {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
  );
  await settle();
  test.setTimeout(90_000);
  // At200%, scroll to the header group, not into the distant canvas.
  await page.getByTestId("floor-plan-zoom-controls").scrollIntoViewIfNeeded();
  const group = await controls();
  await assertControlsReachable(group, "browser-zoom-200");
  await group.getByRole("button", { name: "Acercar plano" }).click();
  await expect(
    group.getByRole("button", { name: "Restablecer zoom" }),
  ).toHaveText("118%");

  const mesa = page.getByLabel("Número de mesa", { exact: true });
  await mesa.scrollIntoViewIfNeeded();
  await expect(mesa).toBeVisible();
  await mesa.fill("12");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByLabel(/^Nombre de mozo/)
    .selectOption({ label: "Administrador" });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
  const dialog = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(mesa).toBeFocused();
  const after = await page.evaluate(() => window.gastronomy.bootstrap());
  expect(after.orders).toEqual(baseline.orders);
  expect(after.tables).toEqual(baseline.tables);
  expect(after.cashSession).toEqual(baseline.cashSession);
  await capture("quick-entry-cancel-at-200.png");
});
