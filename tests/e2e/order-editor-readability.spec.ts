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
  "docs/qa/evidence/system-usability-order-editor-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-editor-readability-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  expect(
    await app.evaluate(({ BrowserWindow }) => ({
      visible: BrowserWindow.getAllWindows()[0]!.isVisible(),
      focused: BrowserWindow.getAllWindows()[0]!.isFocused(),
      throttled:
        BrowserWindow.getAllWindows()[0]!.webContents.getBackgroundThrottling(),
    })),
  ).toEqual({ visible: false, focused: false, throttled: false });
});

test.afterEach(async () => {
  if (
    test.info().status !== test.info().expectedStatus &&
    page &&
    !page.isClosed()
  ) {
    await writeFile(
      join(
        evidence,
        `failed-${test
          .info()
          .title.slice(0, 20)
          .replace(/[^a-z0-9]/gi, "_")}.json`,
      ),
      JSON.stringify(
        await page.evaluate(() => ({
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
            (el) => ({ text: el.textContent, html: el.outerHTML }),
          ),
          focused: document.activeElement?.outerHTML,
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
      !basename(profile).startsWith("gastronomy-editor-readability-")
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
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function readable(locator: Locator, label: string) {
  return {
    ...(await locator.evaluate((el) => {
      const luminance = (color: string) => {
        const values =
          color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? [];
        return values
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index]!,
            0,
          );
      };
      const style = getComputedStyle(el);
      const layers: Element[] = [];
      for (let node: Element | null = el; node; node = node.parentElement)
        layers.unshift(node);
      let background = [255, 255, 255];
      for (const node of layers) {
        const css = getComputedStyle(node);
        if (Number(css.opacity) !== 1)
          throw new Error("Settle animations before measuring contrast");
        const rgba = css.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const alpha = rgba[3] ?? 1;
        background = background.map(
          (value, index) => (rgba[index] ?? 0) * alpha + value * (1 - alpha),
        );
      }
      const bg = `rgb(${background.join(", ")})`;
      const fgLuminance = luminance(style.color);
      const bgLuminance = luminance(bg);
      return {
        text: el.textContent?.trim(),
        font: Number.parseFloat(style.fontSize),
        minHeight: Number.parseFloat(style.minHeight),
        ratio:
          (Math.max(fgLuminance, bgLuminance) + 0.05) /
          (Math.min(fgLuminance, bgLuminance) + 0.05),
        color: style.color,
        bg,
      };
    })),
    label,
  };
}

async function snapshot() {
  return page.evaluate(async () => {
    const state = await window.gastronomy.bootstrap();
    return {
      orders: state.orders,
      cashSession: state.cashSession,
      dashboard: state.dashboard,
    };
  });
}

async function setNativeWindow(width: number, zoom = 1) {
  await app.evaluate(
    ({ BrowserWindow }, { width, zoom }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(width, 820);
      window.webContents.setZoomFactor(zoom);
    },
    { width, zoom },
  );
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getSize(),
    ),
  ).toEqual([width, 820]);
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
    ),
  ).toBe(zoom);
  await settle();
}

async function nativeCapture(name: string) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const bitmap = await window.webContents.capturePage();
    return { size: bitmap.getSize(), data: bitmap.toPNG().toString("base64") };
  });
  expect(image.size.width).toBeGreaterThan(0);
  expect(image.size.height).toBeGreaterThan(0);
  await writeFile(join(evidence, name), Buffer.from(image.data, "base64"));
  return image.size;
}

async function assertReadability(
  observations: Awaited<ReturnType<typeof readable>>[],
) {
  await writeFile(
    join(
      evidence,
      `readability-${test
        .info()
        .title.slice(0, 20)
        .replace(/[^a-z0-9]/gi, "_")}.json`,
    ),
    JSON.stringify(
      {
        viewport: await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
        })),
        measurements: observations,
        minimumFontPx: 12,
        minimumContrast: 4.5,
      },
      null,
      2,
    ),
  );
  for (const item of observations) {
    expect(item.font, `${item.label}: font size`).toBeGreaterThanOrEqual(12);
    expect(item.ratio, `${item.label}: contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

async function seedOrder() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const boot = await api.bootstrap();
    const product = boot.products.find(
      (candidate) => candidate.code === "MUZG",
    )!;
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Cliente editor legible",
      customerPhone: "1155000707",
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: product.id,
      quantity: 35,
    });
    const order = await api.confirmOrder({ orderId: draft.id });
    const variantBaseName = "E2E Producto variantes legibilidad";
    const base = await api.createProduct({
      categoryId: product.categoryId,
      name: variantBaseName,
      code: "E2EREAD",
      prices: [
        { priceListCode: "TAKEAWAY", amountMinor: 1_200_000 },
        { priceListCode: "DELIVERY", amountMinor: 1_200_000 },
        { priceListCode: "SALON", amountMinor: 1_200_000 },
      ],
    });
    await api.createProduct({
      categoryId: base.categoryId,
      name: `${variantBaseName} Doble`,
      code: "E2EREAD-D",
      parentProductId: base.id,
      prices: [
        { priceListCode: "TAKEAWAY", amountMinor: 1_800_000 },
        { priceListCode: "DELIVERY", amountMinor: 1_800_000 },
        { priceListCode: "SALON", amountMinor: 1_800_000 },
      ],
    });
    return {
      id: order.id,
      number: order.number,
      totalMinor: order.totalMinor,
      variantBaseName,
    };
  });
}

test("editor real: campos, filtros, notas, footer y atajos legibles sin mutar datos al salir", async () => {
  test.setTimeout(90_000);
  await setNativeWindow(1366);
  const fixture = await seedOrder();
  const baseline = await snapshot();
  const catalog = await page.evaluate(async () => {
    const state = await window.gastronomy.bootstrap();
    return {
      categories: state.categories
        .filter((category) => category.active)
        .map((category) => category.name),
      product: state.products.find((product) => product.code === "MUZG")!,
    };
  });
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Cliente editor legible" })
    .click();
  const editor = page.getByRole("dialog", {
    name: new RegExp(`Pedido #${fixture.number}`),
  });
  await expect(editor).toBeVisible();
  const observations = [];
  await settle();
  const saved = editor.getByText(/línea\(s\) · Guardado/);
  await expect(saved).toBeVisible();
  observations.push(await readable(saved, "saved state"));
  const paymentStatus = editor
    .locator("header")
    .getByText(/Impago|Pago parcial|Pagado/);
  await expect(paymentStatus).toBeVisible();
  observations.push(await readable(paymentStatus, "payment status"));
  const search = editor.getByPlaceholder(/Código, nombre, categoría/);
  await expect(search).toBeVisible();
  observations.push(await readable(search, "product search"));
  await search.fill("sin resultados de prueba");
  await expect(
    editor.getByRole("button").filter({ hasText: /#MUZG/ }),
  ).toHaveCount(0);
  await search.fill("");
  await settle();
  const allCategory = editor.getByRole("button", {
    name: "Todos",
    exact: true,
  });
  await expect(allCategory).toBeVisible();
  const allCategoryMetrics = await readable(
    allCategory,
    "selected all category",
  );
  observations.push(allCategoryMetrics);
  expect(allCategoryMetrics.minHeight).toBeGreaterThanOrEqual(40);
  expect(catalog.categories.length).toBeGreaterThan(0);
  const category = editor.getByRole("button", {
    name: catalog.product.categoryName,
    exact: true,
  });
  await expect(category).toBeVisible();
  const inactiveCategoryMetrics = await readable(
    category,
    `inactive category ${catalog.product.categoryName}`,
  );
  observations.push(inactiveCategoryMetrics);
  expect(inactiveCategoryMetrics.minHeight).toBeGreaterThanOrEqual(40);
  await category.hover();
  await settle();
  observations.push(await readable(category, "hover category"));
  await category.click();
  await expect(category).toHaveClass(/bg-brand-50/);
  const activeCategoryMetrics = await readable(
    category,
    `active category ${catalog.product.categoryName}`,
  );
  observations.push(activeCategoryMetrics);
  expect(activeCategoryMetrics.minHeight).toBeGreaterThanOrEqual(40);
  await allCategory.click();
  const productCard = editor
    .getByRole("button")
    .filter({ hasText: `#${catalog.product.code}` });
  await expect(productCard).toBeVisible();
  for (const locator of [
    [
      productCard.getByText(catalog.product.name, { exact: true }),
      "product name",
    ],
    [
      productCard.getByText(catalog.product.categoryName, { exact: true }),
      "product category metadata",
    ],
    [
      productCard.getByText(`#${catalog.product.code}`, { exact: true }),
      "product code",
    ],
    [
      productCard.getByText(formatMoney(fixture.totalMinor / 35), {
        exact: true,
      }),
      "product unit price",
    ],
  ] as const)
    observations.push(await readable(locator[0], locator[1]));
  await search.fill("mitad");
  const halfCard = editor.locator("#order-editor-half-and-half-card");
  await expect(halfCard).toBeVisible();
  observations.push(
    await readable(
      halfCard.getByText("Pizza mitad y mitad", { exact: true }),
      "half-and-half card title",
    ),
  );
  for (const [locator, label] of [
    [
      halfCard.getByText("Pizzas combinadas", { exact: true }),
      "half-and-half card category",
    ],
    [
      halfCard.getByText("Elegir 2 variedades", { exact: true }),
      "half-and-half card helper",
    ],
    [
      halfCard.getByText("Configurar →", { exact: true }),
      "half-and-half card action",
    ],
    [halfCard.getByText("F6", { exact: true }), "half-and-half F6 hint"],
  ] as const)
    observations.push(await readable(locator, label));
  const variantSearch = editor.getByPlaceholder(/Código, nombre, categoría/);
  await variantSearch.fill(fixture.variantBaseName);
  const variantCard = editor
    .getByRole("button")
    .filter({ hasText: fixture.variantBaseName })
    .first();
  await expect(variantCard).toBeVisible();
  const variantName = variantCard.getByText(fixture.variantBaseName, {
    exact: true,
  });
  const variantBaseAction = variantCard.getByRole("button", { name: /Base/ });
  const variantDoubleAction = variantCard.getByRole("button", {
    name: /Doble/,
  });
  await expect(variantName).toBeVisible();
  await expect(variantBaseAction).toBeVisible();
  await expect(variantDoubleAction).toBeVisible();
  observations.push(await readable(variantName, "variant card name"));
  observations.push(
    await readable(variantBaseAction, "variant base price option"),
  );
  observations.push(
    await readable(variantDoubleAction, "variant Doble price option"),
  );
  for (const width of [1100, 1366]) {
    await setNativeWindow(width);
    const geometry = await variantCard.evaluate((card) => {
      const cardRect = card.getBoundingClientRect();
      const nameRect = card.querySelector("p")!.getBoundingClientRect();
      const choices = [...card.querySelectorAll("button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          text: button.innerText.trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          cardTop: cardRect.top,
          cardBottom: cardRect.bottom,
        };
      });
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        card: { left: cardRect.left, right: cardRect.right },
        name: {
          left: nameRect.left,
          right: nameRect.right,
          visible: nameRect.width > 0,
        },
        choices,
      };
    });
    await writeFile(
      join(evidence, `order-editor-variants-${width}.json`),
      JSON.stringify(geometry, null, 2),
    );
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.name.visible).toBe(true);
    expect(geometry.choices.length).toBeGreaterThan(0);
    for (const choice of geometry.choices) {
      expect(choice.left).toBeGreaterThanOrEqual(geometry.card.left - 1);
      expect(choice.right).toBeLessThanOrEqual(geometry.card.right + 1);
      expect(choice.top).toBeGreaterThanOrEqual(choice.cardTop - 1);
      expect(choice.bottom).toBeLessThanOrEqual(choice.cardBottom + 1);
    }
    await variantDoubleAction.scrollIntoViewIfNeeded();
    await expect(variantDoubleAction).toBeInViewport({ ratio: 1 });
    await setNativeWindow(width, 2);
    await variantDoubleAction.scrollIntoViewIfNeeded();
    await expect(variantDoubleAction).toBeInViewport({ ratio: 1 });
    await settle();
    expect(
      (await nativeCapture(`order-editor-variants-${width}-zoom200.png`)).width,
    ).toBeGreaterThan(0);
    const zoomGeometry = await variantCard.evaluate((card) => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      choices: [...card.querySelectorAll("button")].map((button) => {
        const rect = button.getBoundingClientRect();
        const owner = card.getBoundingClientRect();
        return {
          text: button.innerText.trim(),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          cardLeft: owner.left,
          cardRight: owner.right,
          cardTop: owner.top,
          cardBottom: owner.bottom,
        };
      }),
    }));
    await writeFile(
      join(evidence, `order-editor-variants-${width}-zoom200.json`),
      JSON.stringify({ ...zoomGeometry, optionsReachable: true }, null, 2),
    );
    expect(zoomGeometry.pageWidth).toBeLessThanOrEqual(
      zoomGeometry.viewportWidth + 1,
    );
    for (const choice of zoomGeometry.choices) {
      expect(choice.left).toBeGreaterThanOrEqual(choice.cardLeft - 1);
      expect(choice.right).toBeLessThanOrEqual(choice.cardRight + 1);
      expect(choice.top).toBeGreaterThanOrEqual(choice.cardTop - 1);
      expect(choice.bottom).toBeLessThanOrEqual(choice.cardBottom + 1);
    }
    await variantDoubleAction.scrollIntoViewIfNeeded();
    await expect(variantDoubleAction).toBeInViewport({ ratio: 1 });
  }
  await setNativeWindow(1366);
  const item = editor
    .getByRole("article")
    .filter({ hasText: catalog.product.name });
  await expect(item).toBeVisible();
  const notesButton = item.getByRole("button", {
    name: `Agregar observación para ${catalog.product.name}`,
  });
  await expect(notesButton).toBeVisible();
  observations.push(await readable(notesButton, "item notes action"));
  await notesButton.hover();
  await settle();
  observations.push(await readable(notesButton, "hover item notes action"));
  await notesButton.click();
  const notesDialog = page.getByRole("dialog", { name: "Agregar observación" });
  await expect(notesDialog).toBeVisible();
  await settle();
  const notesField = notesDialog.getByLabel("Observación para comanda", {
    exact: true,
  });
  const notesHelper = notesDialog.getByText(
    "Sólo se imprime en la comanda; no aparece en la cuenta del cliente.",
    { exact: true },
  );
  const notesCounter = notesDialog.locator("#item-notes-counter");
  for (const [locator, label] of [
    [notesField, "item notes field"],
    [notesHelper, "item notes helper"],
    [notesCounter, "item notes counter"],
  ] as const)
    observations.push(await readable(locator, label));
  await notesField.fill("Nota temporal de verificación");
  const saveNotes = notesDialog.getByRole("button", {
    name: "Guardar",
    exact: true,
  });
  await expect(saveNotes).toBeEnabled();
  await settle();
  observations.push(await readable(saveNotes, "item notes save action"));
  await expect(notesCounter).toHaveText("29/500");
  observations.push(
    await readable(notesCounter, "item notes counter with value"),
  );
  await notesDialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(notesDialog).toBeHidden();
  expect(await snapshot()).toEqual(baseline);
  const f7 = editor.locator("kbd").filter({ hasText: /^F7$/ });
  const f8 = editor.locator("kbd").filter({ hasText: /^F8$/ });
  await expect(f7).toBeVisible();
  await expect(f8).toBeVisible();
  observations.push(
    await readable(f7, "F7 shortcut"),
    await readable(f8, "F8 shortcut"),
  );
  for (const label of ["Comanda", "Cuenta", "Cobrar"]) {
    const action = editor
      .getByRole("button", { name: new RegExp(label) })
      .first();
    await expect(action).toBeVisible();
    observations.push(await readable(action, `${label} action`));
  }
  await page.screenshot({
    path: join(evidence, "order-editor-1366.png"),
    fullPage: true,
  });
  const layout1366 = await editor.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      dialog: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  await writeFile(
    join(evidence, "order-editor-layout-1366.json"),
    JSON.stringify(layout1366, null, 2),
  );
  expect(layout1366.pageWidth).toBeLessThanOrEqual(
    layout1366.viewport.width + 1,
  );
  expect(layout1366.dialog.x).toBeGreaterThanOrEqual(0);
  expect(layout1366.dialog.x + layout1366.dialog.width).toBeLessThanOrEqual(
    layout1366.viewport.width + 1,
  );
  await setNativeWindow(1100);
  const layout1100 = await editor.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    return {
      dialog: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  await writeFile(
    join(evidence, "order-editor-layout-1100.json"),
    JSON.stringify(layout1100, null, 2),
  );
  expect(layout1100.pageWidth).toBeLessThanOrEqual(
    layout1100.viewport.width + 1,
  );
  expect(layout1100.dialog.x).toBeGreaterThanOrEqual(0);
  expect(layout1100.dialog.x + layout1100.dialog.width).toBeLessThanOrEqual(
    layout1100.viewport.width + 1,
  );
  await setNativeWindow(1366, 2);
  expect(
    (await nativeCapture("order-editor-zoom-200.png")).width,
  ).toBeGreaterThan(0);
  const zoomLayout = await editor.evaluate(
    (dialog, amount) => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      dialog: (() => {
        const rect = dialog.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      })(),
      total: (() => {
        const total = [...dialog.querySelectorAll("footer p")].find((node) =>
          node.textContent?.includes(amount),
        );
        if (!total) return null;
        const rect = total.getBoundingClientRect();
        return { left: rect.left, right: rect.right, text: total.textContent };
      })(),
    }),
    formatMoney(fixture.totalMinor),
  );
  expect(zoomLayout.total).not.toBeNull();
  expect(zoomLayout.pageWidth).toBeLessThanOrEqual(
    zoomLayout.viewportWidth + 1,
  );
  expect(zoomLayout.dialog.left).toBeGreaterThanOrEqual(0);
  expect(zoomLayout.dialog.right).toBeLessThanOrEqual(
    zoomLayout.viewportWidth + 1,
  );
  const cobro = editor.getByRole("button", { name: /Cobrar/ });
  await cobro.scrollIntoViewIfNeeded();
  await expect(cobro).toBeInViewport({ ratio: 1 });
  const totalLocator = editor
    .locator("footer")
    .getByText(formatMoney(fixture.totalMinor), { exact: true });
  await totalLocator.scrollIntoViewIfNeeded();
  await expect(totalLocator).toBeInViewport({ ratio: 1 });
  await settle();
  await nativeCapture("order-editor-footer-zoom200.png");
  observations.push(
    await readable(totalLocator, "zoom footer total"),
    await readable(cobro, "zoom Cobrar action"),
  );
  await writeFile(
    join(evidence, "order-editor-layout-zoom200.json"),
    JSON.stringify({ ...zoomLayout, paymentAndTotalReachable: true }, null, 2),
  );
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  expect(await snapshot()).toEqual(baseline);
  await assertReadability(observations);
});

test("Cobrar: saldo y enlace Restar seña mantienen contraste en superficie oscura; F8/Escape no cobran", async () => {
  test.setTimeout(90_000);
  const fixture = await seedOrder();
  const baseline = await snapshot();
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Cliente editor legible" })
    .click();
  const editor = page.getByRole("dialog", {
    name: new RegExp(`Pedido #${fixture.number}`),
  });
  await expect(editor).toBeVisible();
  await page.keyboard.press("F8");
  const payment = page.getByRole("dialog", { name: "Cobrar pedido" });
  await expect(payment).toBeVisible();
  await settle();
  const observations = [
    await readable(
      payment.getByText("Saldo a cobrar", { exact: true }),
      "payment balance label",
    ),
    await readable(
      payment.getByRole("button", { name: "Restar seña" }),
      "deposit link/action",
    ),
  ];
  expect(
    (await payment.innerText()).includes(formatMoney(fixture.totalMinor)),
  ).toBeTruthy();
  await page.screenshot({
    path: join(evidence, "order-editor-payment.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(payment).toBeHidden();
  await expect(editor).toBeVisible();
  expect(await snapshot()).toEqual(baseline);
  await assertReadability(observations);
});

test("Nueva orden: ayuda y modos rápido/programado legibles; cancelar conserva estado", async () => {
  test.setTimeout(90_000);
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
  await setNativeWindow(1100);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  const baseline = await snapshot();
  await page.keyboard.press("F3");
  const create = page.getByRole("dialog", { name: "Nuevo Para retirar" });
  await expect(create).toBeVisible();
  await settle();
  const observations = [];
  const customerQuery = create.getByPlaceholder("Ej.: Ana o 11 4444");
  const customerQueryHint = create.getByText(
    "Escribí nombre o teléfono para buscar un cliente.",
    { exact: true },
  );
  const customerName = create.getByLabel("Nombre del cliente *", {
    exact: true,
  });
  const customerPhone = create.getByLabel("Teléfono *", { exact: true });
  const address = create.getByLabel("Dirección (opcional)", { exact: true });
  const orderHelp = create.getByText(/Podés comenzar por los productos/);
  await expect(customerQuery).toBeVisible();
  await expect(customerQueryHint).toBeVisible();
  await expect(customerName).toBeVisible();
  await expect(customerPhone).toBeVisible();
  await expect(address).toBeVisible();
  await expect(orderHelp).toBeVisible();
  const requiredHelp = create.getByText("* Campos obligatorios.", {
    exact: true,
  });
  await expect(requiredHelp).toBeVisible();
  observations.push(await readable(requiredHelp, "required customer helper"));
  observations.push(await readable(customerQuery, "customer search selector"));
  observations.push(await readable(customerQueryHint, "customer search hint"));
  observations.push(await readable(customerName, "new order customer name"));
  observations.push(await readable(customerPhone, "new order customer phone"));
  observations.push(await readable(address, "new order address"));
  observations.push(await readable(orderHelp, "new order workflow helper"));
  await customerQuery.fill("Cliente temporal prueba");
  await customerName.fill("Cliente temporal prueba");
  await customerPhone.fill("1155000123");
  await address.fill("Dirección temporal 12");
  await expect(create).toBeVisible();
  await writeFile(
    join(evidence, "create-after-fields.json"),
    JSON.stringify(
      await create.evaluate((el) => ({
        text: el.textContent,
        buttons: [...el.querySelectorAll("button")].map((b) => b.textContent),
      })),
      null,
      2,
    ),
  );
  const quickMode = create
    .locator("button")
    .filter({ hasText: /^Demora rápida$/ });
  const scheduledMode = create.getByRole("button", {
    name: "Fecha y hora",
    exact: true,
  });
  observations.push(await readable(quickMode, "quick mode active"));
  observations.push(await readable(scheduledMode, "scheduled mode inactive"));
  await quickMode.click();
  const quickChoice = create.getByRole("button", { name: /\d+ min/ }).first();
  observations.push(await readable(quickChoice, "quick delay option"));
  await quickChoice.click();
  const delayInput = create.locator('input[inputmode="numeric"]');
  await expect(delayInput).toBeVisible();
  await delayInput.fill("43");
  const quickDate = create.getByText(/Hora de entrega:/);
  await expect(quickDate).toBeVisible();
  observations.push(await readable(quickDate, "quick delivery estimate"));
  await scheduledMode.click();
  observations.push(await readable(scheduledMode, "scheduled mode active"));
  const scheduledPositiveHelper = create.getByText(
    "Se mostrará como pedido programado.",
    { exact: true },
  );
  await expect(scheduledPositiveHelper).toBeVisible();
  observations.push(
    await readable(scheduledPositiveHelper, "scheduled helper"),
  );
  const scheduledDate = create.locator('input[type="datetime-local"]');
  await expect(scheduledDate).toBeVisible();
  const future = await page.evaluate(() => {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  await scheduledDate.fill(future);
  const scheduledValue = await scheduledDate.inputValue();
  await customerQuery.clear();
  await customerQuery.fill("Cliente temporal prueba");
  await expect(customerName).toHaveValue("Cliente temporal prueba");
  await expect(customerPhone).toHaveValue("1155000123");
  await expect(address).toHaveValue("Dirección temporal 12");
  expect(await scheduledDate.inputValue()).toBe(scheduledValue);
  await quickMode.click();
  await expect(delayInput).toHaveValue("43");
  await scheduledMode.click();
  await expect(scheduledDate).toHaveValue(scheduledValue);
  await quickMode.click();
  await expect(delayInput).toHaveValue("43");
  observations.push(await readable(scheduledMode, "scheduled mode inactive"));
  const createButton = create.getByRole("button", {
    name: "Crear pedido",
    exact: true,
  });
  await expect(createButton).toBeVisible();
  await expect(createButton).toBeEnabled();
  await settle();
  observations.push(await readable(createButton, "new order create action"));
  await createButton.scrollIntoViewIfNeeded();
  await expect(createButton).toBeInViewport({ ratio: 1 });
  await settle();
  await nativeCapture("new-order-footer-1100.png");
  observations.push(
    await readable(
      create.getByRole("button", {
        name: "Cargar productos primero",
        exact: true,
      }),
      "new order load-products action",
    ),
  );
  await page.screenshot({
    path: join(evidence, "new-order-1100.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await create.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(create).toBeHidden();
  expect(await snapshot()).toEqual(baseline);
  await assertReadability(observations);
});

test("editor: opciones de mitad y mitad y F6 conservan accesibilidad visual sin alterar pedido", async () => {
  test.setTimeout(90_000);
  const fixture = await seedOrder();
  const baseline = await snapshot();
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Cliente editor legible" })
    .click();
  const editor = page.getByRole("dialog", {
    name: new RegExp(`Pedido #${fixture.number}`),
  });
  await expect(editor).toBeVisible();
  await page.keyboard.press("F6");
  const half = page.getByRole("dialog", { name: "Pizza mitad y mitad" });
  await expect(half).toBeVisible();
  await settle();
  const observations = [];
  const first = half.getByPlaceholder(
    "Buscar primera mitad (ej. Muzzarella, Jamón...)",
  );
  const second = half.getByPlaceholder(
    "Buscar segunda mitad (ej. Muzzarella, Jamón...)",
  );
  const rule = half.getByText(/^Regla:/);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(rule).toBeVisible();
  observations.push(
    await readable(first, "first half selector"),
    await readable(second, "second half selector"),
    await readable(rule, "half-and-half pricing rule"),
  );
  await first.fill("Muzzarella");
  const firstOptions = half.getByRole("option");
  await expect(firstOptions.first()).toBeVisible();
  observations.push(
    await readable(firstOptions.first(), "first half product option"),
  );
  observations.push(
    await readable(
      firstOptions.first().locator("span.font-mono"),
      "first half product code",
    ),
    await readable(
      firstOptions.first().locator("span.block.truncate"),
      "first half product category",
    ),
  );
  const firstOptionName = (await firstOptions.first().innerText())
    .split("\n")[0]!
    .trim();
  await firstOptions.first().click();
  await second.fill("Muzzarella");
  const secondOptions = half.getByRole("option");
  await expect(secondOptions.first()).toBeVisible();
  observations.push(
    await readable(secondOptions.first(), "second half product option"),
  );
  await secondOptions.first().click();
  const calculated = half.getByText(/Precio final calculado/);
  await expect(calculated).toBeVisible();
  observations.push(
    await readable(calculated, "half-and-half calculated-price helper"),
  );
  const addHalf = half.getByRole("button", {
    name: "Agregar pizza",
    exact: true,
  });
  await expect(addHalf).toBeVisible();
  await expect(addHalf).toBeEnabled();
  await settle();
  observations.push(await readable(addHalf, "half-and-half add action"));
  expect(firstOptionName.length).toBeGreaterThan(0);
  await page.screenshot({
    path: join(evidence, "order-editor-half-and-half.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(half).toBeHidden();
  await expect(editor).toBeVisible();
  expect(await snapshot()).toEqual(baseline);
  await assertReadability(observations);
});
