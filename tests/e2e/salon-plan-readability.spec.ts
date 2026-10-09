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
  "docs/qa/evidence/system-usability-salon-plan-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-salon-readability-"));
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
          .title.slice(0, 32)
          .replace(/[^a-z0-9]/gi, "_")}.json`,
      ),
      JSON.stringify(
        await page.evaluate(() => ({
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
            (el) => ({ text: el.textContent, html: el.outerHTML }),
          ),
          text: document.body.innerText,
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
      !basename(profile).startsWith("gastronomy-salon-readability-")
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

async function nativeCapture(file: string) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const bitmap =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: bitmap.getSize(), data: bitmap.toPNG().toString("base64") };
  });
  expect(image.size.width).toBeGreaterThan(0);
  await writeFile(join(evidence, file), Buffer.from(image.data, "base64"));
  return image.size;
}

async function metrics(locator: Locator, label: string) {
  return {
    ...(await locator.evaluate((el) => {
      const lum = (color: string) =>
        (
          color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? []
        )
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const style = getComputedStyle(el);
      const layers: Element[] = [];
      for (let n: Element | null = el; n; n = n.parentElement)
        layers.unshift(n);
      let bg = [255, 255, 255];
      for (const node of layers) {
        const css = getComputedStyle(node);
        if (Number(css.opacity) !== 1)
          throw new Error("Settle animations before measuring contrast");
        const rgba = css.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const a = rgba[3] ?? 1;
        bg = bg.map((v, i) => (rgba[i] ?? 0) * a + v * (1 - a));
        const opacity = Number(css.opacity);
        if (opacity !== 1) {
          const fg = style.color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? [0, 0, 0];
          // Composite ancestor opacity into foreground as well as the background.
          const foreground = fg.map(
            (v, i) => v * opacity + bg[i]! * (1 - opacity),
          );
          const fl = lum(`rgb(${foreground.join(",")})`),
            bl = lum(`rgb(${bg.join(",")})`);
          return {
            text: el.textContent?.trim(),
            font: parseFloat(style.fontSize),
            ratio: (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05),
            color: style.color,
            bg: `rgb(${bg.join(",")})`,
          };
        }
      }
      const fl = lum(style.color),
        bl = lum(`rgb(${bg.join(",")})`);
      return {
        text: el.textContent?.trim(),
        font: parseFloat(style.fontSize),
        ratio: (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05),
        color: style.color,
        bg: `rgb(${bg.join(",")})`,
      };
    })),
    label,
  };
}

async function evidenceReadability(
  items: Awaited<ReturnType<typeof metrics>>[],
) {
  await writeFile(
    join(
      evidence,
      `readability-${test
        .info()
        .title.slice(0, 25)
        .replace(/[^a-z0-9]/gi, "_")}.json`,
    ),
    JSON.stringify(
      { measurements: items, minimumFontPx: 12, minimumContrast: 4.5 },
      null,
      2,
    ),
  );
  for (const item of items) {
    expect(item.font, `${item.label}: font`).toBeGreaterThanOrEqual(12);
    expect(item.ratio, `${item.label}: contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

async function baseline() {
  return page.evaluate(async () => {
    const s = await window.gastronomy.bootstrap();
    return {
      orders: s.orders,
      cashSession: s.cashSession,
      dashboard: s.dashboard,
      tables: s.tables,
      tableSectors: s.tableSectors,
      floorPlanShapes: s.floorPlanShapes,
    };
  });
}

async function setupOccupiedTable() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const s = await api.bootstrap();
    const table = s.tables.find((t) => t.active)!;
    const tableName = `Mesa E2E con un alias largo de salón ${table.number}`;
    await api.updateTable({
      tableId: table.id,
      number: table.number,
      name: tableName,
      active: true,
      layoutWidth: 7,
      layoutHeight: 7,
    });
    const product = s.products.find((p) => p.code === "MUZG")!;
    const draft = await api.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: product.id,
      quantity: 35,
    });
    const order = await api.confirmOrder({ orderId: draft.id });
    return {
      table: { ...table, name: tableName },
      order,
      totalMinor: order.totalMinor,
    };
  });
}

test("Salón clásico y carga rápida: estados de mesa y ayudas siguen legibles sin cambios de datos", async () => {
  test.setTimeout(90_000);
  const fixture = await setupOccupiedTable();
  const before = await baseline();
  await page.reload();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820),
  );
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getSize(),
    ),
  ).toEqual([1100, 820]);
  await page.getByRole("link", { name: "Salón" }).click();
  await settle();
  const table = page.getByRole("button", {
    name: new RegExp(`Abrir pedido de mesa ${fixture.table.number}`),
  });
  await expect(table).toBeVisible();
  const readings = [
    await metrics(
      page.getByText("Abrí una mesa y asigná quién la atiende", {
        exact: true,
      }),
      "salon subtitle",
    ),
    await metrics(
      page.getByText(fixture.table.name!, { exact: true }),
      "occupied table alias",
    ),
    await metrics(
      page.getByText(formatMoney(fixture.totalMinor), { exact: true }),
      "occupied table amount",
    ),
    await metrics(
      page.getByText(/Administrador ·/).first(),
      "waiter and elapsed-time metadata",
    ),
  ];

  const quick = page.getByText("Carga rápida por teclado", { exact: true });
  await expect(quick).toBeVisible();
  readings.push(await metrics(quick, "keyboard quick-entry heading"));
  readings.push(
    await metrics(
      page.getByText(
        "Enter avanza · Shift+Enter retrocede · Tab conserva el flujo",
        { exact: true },
      ),
      "keyboard quick-entry helper",
    ),
  );
  const badges = await page
    .locator(".border-brand-100")
    .getByText(/^[123] ·/)
    .all();
  expect(badges).toHaveLength(3);
  for (const [i, badge] of badges.entries()) {
    readings.push(await metrics(badge, `quick-entry step badge ${i + 1}`));
  }
  const inactiveTab = page.getByRole("tab", {
    name: "Plano por sectores",
    exact: true,
  });
  readings.push(await metrics(inactiveTab, "inactive view tab"));
  await inactiveTab.hover();
  await settle();
  readings.push(await metrics(inactiveTab, "hover inactive view tab"));
  const freeCard = page
    .getByRole("button", { name: "Abrir mesa 2", exact: true })
    .locator("..")
    .locator("..");
  readings.push(
    await metrics(
      freeCard.getByText("Abrir pedido", { exact: true }),
      "free classic table helper",
    ),
  );
  await nativeCapture("salon-classic-1100.png");
  expect(await baseline()).toEqual(before);
  await evidenceReadability(readings);
});

test("Plano por sectores: mesa libre/ocupada y controles alcanzables a 1100/1366 y zoom 200% sin editar", async () => {
  test.setTimeout(90_000);
  const fixture = await setupOccupiedTable();
  const before = await baseline();
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByRole("tab", { name: "Plano por sectores" }).click();
  const items: Awaited<ReturnType<typeof metrics>>[] = [];
  for (const width of [1100, 1366]) {
    await app.evaluate(
      ({ BrowserWindow }, w) =>
        BrowserWindow.getAllWindows()[0]!.setSize(w, 820),
      width,
    );
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.getSize(),
      ),
    ).toEqual([width, 820]);
    await settle();
    const occupied = page.getByRole("button", {
      name: new RegExp(`Abrir pedido de mesa ${fixture.table.number}\\b`),
    });
    await expect(occupied).toBeVisible();
    items.push(
      await metrics(
        occupied.getByText(fixture.table.name!, { exact: true }),
        `occupied plan alias at ${width}px`,
      ),
    );
    items.push(
      await metrics(
        occupied.locator("span.block.truncate.text-xs.font-bold"),
        `occupied plan amount at ${width}px`,
      ),
    );
    items.push(
      await metrics(
        occupied.locator("span.block.truncate.text-xs").last(),
        `occupied plan waiter/time at ${width}px`,
      ),
    );
    const canvas = page.locator("[data-floor-canvas]");
    const allTables = await page.evaluate(async () =>
      (await window.gastronomy.bootstrap()).tables
        .filter((t) => t.active)
        .map((t) => t.number),
    );
    const freeNumber = allTables.find((n) => n !== fixture.table.number);
    if (freeNumber !== undefined) {
      const free = page.getByRole("button", {
        name: new RegExp(`Abrir mesa ${freeNumber}\\b`),
      });
      await expect(free).toBeVisible();
      items.push(
        await metrics(
          free.locator("span.block.truncate.text-xs.font-bold"),
          `free plan label at ${width}px`,
        ),
      );
    } else {
      throw new Error("Salon fixture must include an active free table");
    }
    const amount = occupied.locator("span.block.truncate.text-xs.font-bold");
    const layout = await amount.evaluate((el) => {
      const text = el.getBoundingClientRect(),
        button = el.closest("button")!.getBoundingClientRect();
      return {
        text: {
          left: text.left,
          right: text.right,
          top: text.top,
          bottom: text.bottom,
          scrollWidth: (el as HTMLElement).scrollWidth,
          clientWidth: (el as HTMLElement).clientWidth,
        },
        button: {
          left: button.left,
          right: button.right,
          top: button.top,
          bottom: button.bottom,
        },
        lineHeight: getComputedStyle(el).lineHeight,
      };
    });
    expect(layout.text.left).toBeGreaterThanOrEqual(layout.button.left);
    expect(layout.text.right).toBeLessThanOrEqual(layout.button.right);
    expect(layout.text.top).toBeGreaterThanOrEqual(layout.button.top);
    expect(layout.text.bottom).toBeLessThanOrEqual(layout.button.bottom);
    expect(layout.text.scrollWidth).toBeLessThanOrEqual(
      layout.text.clientWidth,
    );
    await writeFile(
      join(evidence, `salon-plan-amount-layout-${width}.json`),
      JSON.stringify(layout, null, 2),
    );
    const bounds = await occupied.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) await expect(occupied).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await nativeCapture(`salon-plan-${width}.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
    );
    await settle();
    await occupied.scrollIntoViewIfNeeded();
    await expect(occupied).toBeInViewport({ ratio: 1 });
    await expect(amount).toBeInViewport({ ratio: 1 });
    const zoomAmount = await amount.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        b = el.closest("button")!.getBoundingClientRect();
      return {
        text: {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          scrollWidth: (el as HTMLElement).scrollWidth,
          clientWidth: (el as HTMLElement).clientWidth,
        },
        button: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    });
    expect(zoomAmount.text.left).toBeGreaterThanOrEqual(zoomAmount.button.left);
    expect(zoomAmount.text.right).toBeLessThanOrEqual(zoomAmount.button.right);
    expect(zoomAmount.text.top).toBeGreaterThanOrEqual(zoomAmount.button.top);
    expect(zoomAmount.text.bottom).toBeLessThanOrEqual(
      zoomAmount.button.bottom,
    );
    expect(zoomAmount.text.scrollWidth).toBeLessThanOrEqual(
      zoomAmount.text.clientWidth,
    );
    await writeFile(
      join(evidence, `salon-plan-amount-layout-${width}-zoom200.json`),
      JSON.stringify(zoomAmount, null, 2),
    );
    await settle();
    await nativeCapture(`salon-plan-${width}-zoom200.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    );
    await settle();
    expect(await canvas.count()).toBe(1);
  }
  await expect(
    page.getByRole("button", { name: "Editar plano" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar plano", exact: true }).click();
  await settle();
  const editingTable = page.getByRole("button", {
    name: `Editar mesa ${fixture.table.number}`,
    exact: true,
  });
  const editFit = await editingTable.evaluate((el) => {
    const button = el.getBoundingClientRect();
    return [...el.querySelectorAll("strong,span.block")].map((text) => {
      const r = text.getBoundingClientRect();
      return {
        text: text.textContent,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        button: {
          top: button.top,
          bottom: button.bottom,
          left: button.left,
          right: button.right,
        },
      };
    });
  });
  await writeFile(
    join(evidence, "plan-edit-label-fit.json"),
    JSON.stringify(editFit, null, 2),
  );
  for (const ink of editFit) {
    expect(ink.top).toBeGreaterThanOrEqual(ink.button.top);
    expect(ink.bottom).toBeLessThanOrEqual(ink.button.bottom);
    expect(ink.left).toBeGreaterThanOrEqual(ink.button.left);
    expect(ink.right).toBeLessThanOrEqual(ink.button.right);
  }
  items.push(
    await metrics(
      page.getByText(
        "Arrastrá las mesas y figuras para ubicarlas. También podés dibujar áreas y líneas.",
        { exact: true },
      ),
      "plan editing helper",
    ),
    await metrics(
      page.getByText("Seleccioná una mesa o figura del plano para editarla.", {
        exact: true,
      }),
      "plan property-panel helper",
    ),
  );
  await nativeCapture("salon-plan-editing-1366.png");
  await page
    .getByRole("button", { name: "Terminar edición", exact: true })
    .click();
  expect(await baseline()).toEqual(before);
  await evidenceReadability(items);
});

test("Salón: historial de mesa cerrada muestra cierre y datos, busca y permite abrir sin mutar", async () => {
  test.setTimeout(90_000);
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const state = await api.bootstrap();
    const table = state.tables.find((candidate) => candidate.active)!;
    const product = state.products.find(
      (candidate) => candidate.code === "MUZG",
    )!;
    const draft = await api.createOrder({
      type: "DINE_IN",
      tableId: table.id,
      waiterUserId: "user-admin",
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: product.id,
      quantity: 35,
    });
    const order = await api.confirmOrder({ orderId: draft.id });
    const closed = await api.completeOrder({
      orderId: order.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
      idempotencyKey: crypto.randomUUID(),
    });
    return {
      tableNumber: table.number,
      number: closed.number,
      totalMinor: closed.totalMinor,
    };
  });
  const before = await baseline();
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await expect(
    page.getByText("Historial de mesas cerradas", { exact: true }),
  ).toBeVisible();
  const help = page.getByText(/Mesas cobradas o canceladas en este turno/);
  await expect(help).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: `#${fixture.number}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`Mesa ${fixture.tableNumber}`);
  await expect(row).toContainText("Administrador");
  await expect(row).toContainText(formatMoney(fixture.totalMinor));
  const timestamp = row.locator("td").nth(1).locator("p");
  await expect(timestamp).toBeVisible();
  await settle();
  const observations = [
    await metrics(help, "closed history helper"),
    await metrics(timestamp, "closed-order time leaf"),
    await metrics(row.locator("td").nth(2), "closed-order waiter leaf"),
    await metrics(
      row.locator("td").nth(3).locator("div").first(),
      "closed-order product metadata",
    ),
    await metrics(row.locator("td").nth(6), "closed-order amount leaf"),
  ];
  await row.scrollIntoViewIfNeeded();
  await settle();
  await nativeCapture("salon-history.png");
  const search = page.getByPlaceholder("Buscar por mozo, mesa o producto...");
  await search.fill("Muzzarella");
  await expect(row).toBeVisible();
  const clear = page.getByRole("button", { name: "Limpiar búsqueda" });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue("");
  await row.click();
  const editor = page.getByRole("dialog").last();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(`Pedido #${fixture.number}`);
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  expect(await baseline()).toEqual(before);
  await evidenceReadability(observations);
});

test("Carga rápida abre editor: búsqueda y Escape no agregan productos y devuelven foco a Mesa", async () => {
  test.setTimeout(90_000);
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Salón" }).click();
  await page.getByLabel("Número de mesa").fill("12");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByLabel(/^Nombre de mozo/)
    .selectOption({ label: "Administrador" });
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const beforeSearch = await baseline();
  const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
  await expect(editor).toBeVisible();
  const productName = editor.getByPlaceholder(/Código, nombre, categoría/);
  await productName.fill("MUZG");
  const option = editor.getByRole("button").filter({ hasText: "#MUZG" });
  await expect(option).toBeVisible();
  const codeAndCategory = option.getByText("#MUZG", { exact: true });
  const price = option.getByText(formatMoney(1_500_000), { exact: true });
  const name = option.getByText("Muzzarella grande", { exact: true });
  await settle();
  const observations = [
    await metrics(name, "quick suggestion product name"),
    await metrics(codeAndCategory, "quick suggestion code and category"),
    await metrics(price, "quick suggestion salon price"),
  ];
  await expect(codeAndCategory).toContainText("MUZG");
  await expect(price).not.toBeEmpty();
  await productName.press("Escape");
  await expect(editor).toBeHidden();
  await expect(
    page.getByLabel("Número de mesa", { exact: true }),
  ).toBeFocused();
  expect(await baseline()).toEqual(beforeSearch);
  await evidenceReadability(observations);
});
