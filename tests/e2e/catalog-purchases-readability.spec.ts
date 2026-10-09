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
import { formatMoney } from "../../packages/domain/src/money";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us07b2-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us07b2-readability-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us07b2-readability-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function settle() {
  await page.evaluate(async () => {
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

async function readable(locator: Locator, label: string) {
  await settle();
  const measurements = await locator.evaluateAll((nodes) => {
    const lum = (color: string) => {
      const rgb =
        color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      if (rgb.length !== 3) return null;
      const linear = rgb.map((v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return linear.reduce(
        (sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i]!,
        0,
      );
    };
    const bg = (node: Element) => {
      let color = [255, 255, 255];
      const layers: number[][] = [];
      for (let el: Element | null = node; el; el = el.parentElement) {
        const match =
          getComputedStyle(el)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [];
        if (match.length < 3) continue;
        layers.push([
          match[0]!,
          match[1]!,
          match[2]!,
          match.length > 3 ? match[3]! : 1,
        ]);
        if ((match.length > 3 ? match[3]! : 1) >= 0.999) break;
      }
      for (const [red, green, blue, alpha] of layers.reverse()) {
        const match = [red, green, blue];
        color = match.map(
          (channel, index) => channel * alpha + color[index]! * (1 - alpha),
        );
      }
      return `rgb(${color.map(Math.round).join(",")})`;
    };
    return nodes
      .filter((n) => {
        const box = n.getBoundingClientRect();
        let faded = false;
        for (let el: Element | null = n; el; el = el.parentElement)
          if (Number(getComputedStyle(el).opacity) < 0.999) faded = true;
        return (
          Boolean(n.textContent?.trim()) &&
          !n.matches(
            "span.inline-flex.rounded-md, span.font-mono.select-none",
          ) &&
          !n.closest(":disabled,[aria-disabled='true']") &&
          !faded &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .map((n) => {
        const s = getComputedStyle(n),
          foreground = lum(s.color),
          background = lum(bg(n));
        return {
          text: n.textContent?.trim().replace(/\s+/g, " "),
          fontSize: Number.parseFloat(s.fontSize),
          fontWeight: Number.parseInt(s.fontWeight, 10),
          contrast:
            foreground === null || background === null
              ? null
              : (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05),
        };
      });
  });
  expect(
    measurements.length,
    `${label}: visible labels measured`,
  ).toBeGreaterThan(0);
  for (const m of measurements) {
    expect(m.fontSize, `${label}: ${m.text} font`).toBeGreaterThanOrEqual(12);
    expect(m.contrast, `${label}: ${m.text} contrast`).not.toBeNull();
    const large =
      m.fontSize >= 24 || (m.fontSize >= 18.67 && m.fontWeight >= 700);
    expect(m.contrast!, `${label}: ${m.text} contrast`).toBeGreaterThanOrEqual(
      large ? 3 : 4.5,
    );
  }
  return measurements;
}

async function windowWidth(width: number) {
  await app.evaluate(
    ({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 820),
    width,
  );
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize()[0],
    ),
  ).toBe(width);
}

async function stateSnapshot() {
  return page.evaluate(async () => {
    const [bootstrap, purchases, costs] = await Promise.all([
      window.gastronomy.bootstrap(),
      window.gastronomy.listPurchases(),
      window.gastronomy.getFinanceProductCosts(),
    ]);
    return { products: bootstrap.products, purchases, costs };
  });
}

async function catalogFixture() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    const category = (await api.bootstrap()).categories[0]!;
    const prices = [
      { priceListCode: "SALON" as const, amountMinor: 1_000 },
      { priceListCode: "TAKEAWAY" as const, amountMinor: 1_000 },
      { priceListCode: "DELIVERY" as const, amountMinor: 1_000 },
    ];
    const parent = await api.createProduct({
      categoryId: category.id,
      name: "US07B2 base",
      code: "US07B2BASE",
      prices,
    });
    const variant = await api.createProduct({
      categoryId: category.id,
      parentProductId: parent.id,
      name: "US07B2 variante sin costo",
      code: "US07B2VAR",
      prices,
    });
    const other = await api.createProduct({
      categoryId: category.id,
      name: "US07B2 otro",
      code: "US07B2OTRO",
      prices,
    });
    await api.setFinanceProductCost({
      productId: parent.id,
      unitCostMinor: 100,
    });
    return { parent, variant, other };
  });
}

async function assertFits(locator: Locator, label: string) {
  const overflows = await locator.evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const element = node as HTMLElement;
        const box = element.getBoundingClientRect();
        return {
          text: element.textContent?.trim(),
          width: box.width,
          height: box.height,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight,
        };
      })
      .filter(
        (item) =>
          item.width > 0 &&
          item.height > 0 &&
          (item.scrollWidth > item.width + 1 ||
            item.scrollHeight > item.height + 1),
      ),
  );
  expect(
    overflows,
    `${label}: paragraphs fit their visible containers`,
  ).toEqual([]);
}

async function capture(label: string) {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>("main, main *").forEach((el) => {
      if (el.scrollHeight > el.clientHeight) el.scrollTop = 0;
      if (el.scrollWidth > el.clientWidth) el.scrollLeft = 0;
    });
  });
  await settle();
  await page.screenshot({
    path: join(evidence, `${label}.png`),
    fullPage: true,
  });
}

async function reachable(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
}

for (const width of [1100, 1366]) {
  test(`Catálogo mantiene legibles filtros, contexto y selección oculta a ${width}px`, async () => {
    await windowWidth(width);
    const fixture = await catalogFixture();
    await page.reload();
    const before = await stateSnapshot();
    await page.getByRole("link", { name: "Productos", exact: true }).click();
    const root = page.locator("main .panel-enter");
    await expect(
      root.getByRole("heading", { name: "Catálogo, modificadores y stock" }),
    ).toBeVisible();
    await root.getByLabel("Filtrar por costo").selectOption("sin");
    const parentCheck = root.getByLabel(`Seleccionar ${fixture.parent.name}`, {
      exact: true,
    });
    const variantCheck = root.getByLabel(
      `Seleccionar ${fixture.variant.name}`,
      { exact: true },
    );
    await expect(parentCheck).toBeVisible();
    await expect(parentCheck).not.toBeChecked();
    await expect(variantCheck).toBeVisible();
    await variantCheck.check();
    await expect(parentCheck).not.toBeChecked();
    const contextLabels = await readable(
      root.locator("p, span, td, th, strong, label, h2"),
      "variant match with parent context",
    );
    await capture(`catalog-context-${width}`);
    await root.getByLabel("Buscar productos").fill("US07B2 inexistente");
    const hiddenNotice = root.getByText(
      /producto seleccionado oculto por los filtros actuales/,
    );
    await expect(hiddenNotice).toBeVisible();
    const hiddenLabels = await readable(
      root.locator("p, span, td, th, strong, label, h2"),
      "hidden selection notice",
    );
    await assertFits(root.locator("p"), "catalog helper text");
    await capture(`catalog-hidden-selection-${width}`);
    await expect(root.getByLabel("Buscar productos")).toBeVisible();
    await expect(root.getByLabel("Filtrar por categoría")).toBeVisible();
    await expect(root.getByLabel("Filtrar por estado")).toBeVisible();
    await expect(root.getByLabel("Filtrar por stock")).toBeVisible();
    await root.getByLabel("Buscar productos").fill("");
    await root.getByRole("tab", { name: "Productos" }).click();
    await root.getByRole("button", { name: "Nuevo producto" }).click();
    const createDialog = page.getByRole("dialog", { name: "Nuevo producto" });
    const createLabels = await readable(
      createDialog.locator("p, span, td, th, strong, label, h2"),
      "new product labels",
    );
    await assertFits(
      createDialog.locator("p"),
      "new product dialog paragraphs",
    );
    await capture(`catalog-new-${width}`);
    const createCancel = createDialog.getByRole("button", { name: "Cancelar" });
    await reachable(createCancel);
    await createCancel.click();
    expect(
      await stateSnapshot(),
      "cancelled new product leaves products, purchases and costs unchanged",
    ).toEqual(before);
    await root
      .getByRole("button", { name: `Editar ${fixture.parent.name}` })
      .click();
    const editDialog = page.getByRole("dialog", {
      name: `Editar · ${fixture.parent.name}`,
    });
    const editLabels = await readable(
      editDialog.locator("p, span, td, th, strong, label, h2"),
      "edit product context",
    );
    await assertFits(editDialog.locator("p"), "edit product dialog paragraphs");
    await capture(`catalog-edit-${width}`);
    const editCancel = editDialog.getByRole("button", { name: "Cancelar" });
    await reachable(editCancel);
    await editCancel.click();
    expect(
      await stateSnapshot(),
      "cancelled product edit leaves products, purchases and costs unchanged",
    ).toEqual(before);
    await root.getByRole("button", { name: /Operación masiva/ }).click();
    const bulkDialog = page.getByRole("dialog", { name: /Operación masiva/ });
    const bulkLabels = await readable(
      bulkDialog.locator("p, span, td, th, strong, label, h2"),
      "bulk preview and explanatory text",
    );
    await assertFits(bulkDialog.locator("p"), "bulk dialog paragraphs");
    await capture(`catalog-bulk-${width}`);
    const bulkCancel = bulkDialog.getByRole("button", { name: "Cancelar" });
    await reachable(bulkCancel);
    await bulkCancel.click();
    expect(
      await stateSnapshot(),
      "cancelled bulk preview leaves products, purchases and costs unchanged",
    ).toEqual(before);
    await page.screenshot({
      path: join(evidence, `catalog-${width}.png`),
      fullPage: true,
    });
    expect(
      await stateSnapshot(),
      "catalog navigation does not mutate products, purchases or costs",
    ).toEqual(before);
    await writeFile(
      join(evidence, `catalog-${width}.json`),
      JSON.stringify(
        {
          width,
          contextLabels,
          hiddenLabels,
          createLabels,
          editLabels,
          bulkLabels,
          stateUnchangedAfterNavigationAndCancelledDialogs: true,
          realElectronSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
  });

  test(`Historial vacío de Compras es legible y cancelar el ingreso no altera datos a ${width}px`, async () => {
    await windowWidth(width);
    const before = await stateSnapshot();
    expect(before.purchases).toHaveLength(0);
    await page.getByRole("link", { name: "Compras", exact: true }).click();
    const root = page.locator("main .panel-enter");
    await expect(
      root.getByText("Todavía no hay ingresos registrados.", { exact: true }),
    ).toBeVisible();
    const labels = await readable(
      root.locator("p, span, td, th, strong, label, h2"),
      "purchases empty state",
    );
    await assertFits(
      root.locator("p"),
      "purchase empty-state and card paragraphs",
    );
    await page.getByRole("button", { name: /Registrar ingreso/i }).click();
    const dialog = page.getByRole("dialog", { name: "Registrar ingreso" });
    await expect(
      dialog.getByText(
        "El stock y costo de los artículos se actualizarán al confirmar el ingreso.",
      ),
    ).toBeVisible();
    const dialogLabels = await readable(
      dialog.locator("p, span, td, th, strong, label, h2"),
      "purchase form explanatory text",
    );
    await assertFits(dialog.locator("p"), "purchase modal paragraphs");
    await page.screenshot({
      path: join(evidence, `purchase-dialog-${width}.png`),
      fullPage: true,
    });
    const cancel = dialog.getByRole("button", { name: "Cancelar" });
    await reachable(cancel);
    await cancel.click();
    expect(
      await stateSnapshot(),
      "cancelled purchase leaves inventory and costs unchanged",
    ).toEqual(before);
    await page.screenshot({
      path: join(evidence, `purchases-empty-${width}.png`),
      fullPage: true,
    });
    await writeFile(
      join(evidence, `purchases-empty-${width}.json`),
      JSON.stringify(
        {
          width,
          labels,
          dialogLabels,
          cancelledWithoutMutation: true,
          realElectronSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
  });
}

test("Historial de Compras poblado muestra metadata legible y cancelar revisión no muta importes", async () => {
  await windowWidth(1366);
  const fixture = await page.evaluate(async () => {
    const product = (await window.gastronomy.bootstrap()).products.find(
      (item) => item.active,
    )!;
    const purchase = await window.gastronomy.createPurchase({
      idempotencyKey: crypto.randomUUID(),
      supplierName: "Proveedor US07B2",
      invoiceNumber: "FAC-US07B2",
      notes: "Control de lectura",
      authorizerPin: "1234",
      items: [
        { productId: product.id, quantityMinor: 2500, unitCostMinor: 10000 },
      ],
    });
    return { purchase, productId: product.id };
  });
  const before = await stateSnapshot();
  await page.reload();
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  const root = page.locator("main .panel-enter");
  await expect(
    root.getByText("Proveedor US07B2", { exact: true }),
  ).toBeVisible();
  await expect(root.getByText("FAC-US07B2", { exact: true })).toBeVisible();
  await expect(root.getByText(/Nota: Control de lectura/)).toBeVisible();
  await expect(
    root
      .getByText(formatMoney(fixture.purchase.totalMinor), { exact: true })
      .last(),
  ).toBeVisible();
  const labels = await readable(
    root.locator("p, span, td, th, strong, label, h2"),
    "purchase history metadata",
  );
  await assertFits(root.locator("p"), "purchase history metadata paragraphs");
  await page.getByRole("button", { name: /Registrar ingreso/i }).click();
  const dialog = page.getByRole("dialog", { name: "Registrar ingreso" });
  await dialog.getByLabel("Producto").selectOption(fixture.productId);
  await dialog.getByLabel("Cantidad").fill("3");
  await dialog.getByLabel("Costo unit.").fill("125");
  await expect(
    dialog.getByText("Total del ingreso", { exact: true }).locator("../.."),
  ).toContainText(formatMoney(37_500));
  const dialogLabels = await readable(
    dialog.locator("p, span, td, th, strong, label, h2"),
    "purchase review total and field labels",
  );
  await assertFits(dialog.locator("p"), "purchase modal paragraphs at 1366px");
  await page.screenshot({
    path: join(evidence, "purchase-dialog-populated-1366.png"),
    fullPage: true,
  });
  const cancelDraft = dialog.getByRole("button", { name: "Cancelar" });
  await reachable(cancelDraft);
  await cancelDraft.click();
  expect(
    await stateSnapshot(),
    "cancelled draft leaves saved purchase, stock and costs unchanged",
  ).toEqual(before);
  await page.screenshot({
    path: join(evidence, "purchases-populated-1366.png"),
    fullPage: true,
  });
  expect(
    await stateSnapshot(),
    "history navigation preserves the purchase and derived costs",
  ).toEqual(before);
  await writeFile(
    join(evidence, "purchases-populated-1366.json"),
    JSON.stringify(
      {
        width: 1366,
        labels,
        dialogLabels,
        fixture: {
          supplier: fixture.purchase.supplierName,
          totalMinor: fixture.purchase.totalMinor,
        },
        unchangedAfterNavigation: true,
        realElectronSqliteAndIpc: true,
      },
      null,
      2,
    ),
  );
});
