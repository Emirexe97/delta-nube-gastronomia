import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-orders-list-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-orders-list-"));
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
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-orders-list-")
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

async function fixture() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const boot = await api.bootstrap();
    const product = boot.products.find((p) => p.code === "MUZG")!;
    async function make(
      type: "TAKEAWAY" | "DELIVERY",
      suffix: string,
      paid: boolean,
    ) {
      const draft = await api.createOrder({
        type,
        customerName: `Cliente largo Pedidos ${suffix} con texto deliberadamente extenso`,
        customerPhone: "1155000707",
        deliveryAddress:
          type === "DELIVERY"
            ? "Av. Siempre Viva 742, piso 12, departamento A, localidad de prueba extensa"
            : undefined,
      });
      await api.addOrderItem({
        orderId: draft.id,
        productId: product.id,
        quantity: 35,
      });
      const order = await api.confirmOrder({ orderId: draft.id });
      if (order.totalMinor !== 52_500_000)
        throw new Error(`Unexpected fixture total: ${order.totalMinor}`);
      if (paid)
        await api.payOrder({
          orderId: order.id,
          payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
          idempotencyKey: crypto.randomUUID(),
        });
      return {
        id: order.id,
        number: order.number,
        type,
        customer: `Cliente largo Pedidos ${suffix} con texto deliberadamente extenso`,
        totalMinor: order.totalMinor,
        paid,
      };
    }
    const expected = [
      await make("TAKEAWAY", "pendiente", false),
      await make("DELIVERY", "pagado", true),
    ];
    const state = await api.bootstrap();
    return {
      expected,
      baseline: {
        orders: state.orders,
        cashSession: state.cashSession,
        dashboard: state.dashboard,
      },
    };
  });
}

async function contrast(locator: Locator, label: string) {
  const result = await locator.evaluate((el) => {
    const luminance = (rgb: string) => {
      const c =
        rgb
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      return c
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    };
    const style = getComputedStyle(el);
    const layers: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement)
      layers.unshift(node);
    let channels = [255, 255, 255];
    for (const node of layers) {
      const css = getComputedStyle(node);
      if (Number(css.opacity) !== 1)
        throw new Error("Settle animations before measuring contrast");
      const rgba = css.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      const alpha = rgba[3] ?? 1;
      channels = channels.map(
        (value, index) => (rgba[index] ?? 0) * alpha + value * (1 - alpha),
      );
    }
    const bg = `rgb(${channels.join(", ")})`;
    const fg = luminance(style.color),
      back = luminance(bg);
    return {
      text: el.textContent?.trim(),
      font: parseFloat(style.fontSize),
      ratio: (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05),
      color: style.color,
      bg,
    };
  });
  return { ...result, label };
}

test("Pedidos: filtros y filas conservan legibilidad, límites y datos inalterados", async () => {
  test.setTimeout(90_000);
  const data = await fixture();
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  const root = page.locator("main .panel-enter");
  await expect(
    root.getByRole("heading", { name: "Para retirar y envíos" }),
  ).toBeVisible();
  const subtitle = root.getByText(
    "Consultá los pedidos para retirar y los envíos.",
  );
  const filters = ["Todos", "Pendientes", "Pagados"];
  await expect(root.locator("button.h-9")).toHaveText([
    "Todos",
    "Para retirar",
    "Envío",
    "Pendientes",
    "Atrasados",
    "Listos / reparto",
    "Pagados",
  ]);
  await settle();
  const observations: Array<{ font: number; ratio: number; label: string }> = [
    await contrast(subtitle, "subtitle"),
  ];
  for (const label of filters) {
    const button = root.getByRole("button", { name: label, exact: true });
    observations.push(
      await contrast(
        button,
        label === "Todos" ? "selected filter" : `filter ${label}`,
      ),
    );
    await button.hover();
    await settle();
    observations.push(await contrast(button, `hover filter ${label}`));
  }
  const table = root.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  for (const item of data.expected) {
    const row = table
      .locator("tbody tr")
      .filter({ hasText: `#${item.number}` });
    await expect(row).toHaveCount(1);
    const cells = row.locator("td");
    const creation = cells.nth(0).locator("p");
    const destination = cells.nth(2).locator("p").nth(1);
    observations.push(
      await contrast(creation, `creation time #${item.number}`),
    );
    observations.push(
      await contrast(destination, `destination #${item.number}`),
    );
    await row.hover();
    await settle();
    observations.push(
      await contrast(creation, `muted row hover #${item.number}`),
    );
    expect(
      (await row.innerText()).includes(formatMoney(52_500_000)),
    ).toBeTruthy();
  }
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
    await table.evaluate((element) => {
      element.parentElement!.scrollLeft = element.parentElement!.scrollWidth;
    });
    await settle();
    const layout = await page.evaluate(() => {
      const scroller = document.querySelector(
        "main .panel-enter table",
      )!.parentElement!;
      const bounds = scroller.getBoundingClientRect();
      const totalsVisibleAtScrollEnd = [
        ...scroller.querySelectorAll("tbody tr td:last-child"),
      ].map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const ink = range.getBoundingClientRect();
        return ink.left >= bounds.left - 1 && ink.right <= bounds.right + 1;
      });
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        tableWidth: scroller.querySelector("table")!.scrollWidth,
        totalsVisibleAtScrollEnd,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.scrollWidth).toBeGreaterThanOrEqual(layout.clientWidth);
    expect(layout.totalsVisibleAtScrollEnd.every(Boolean)).toBe(true);
    await writeFile(
      join(evidence, `orders-layout-${width}.json`),
      JSON.stringify(layout, null, 2),
    );
    await page.screenshot({
      path: join(evidence, `orders-${width}.png`),
      fullPage: true,
    });
  }
  await root.getByRole("button", { name: "Pendientes", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await root.getByRole("button", { name: "Pagados", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await settle();
  observations.push(
    await contrast(
      root.getByRole("button", { name: "Pagados", exact: true }),
      "selected Pagados",
    ),
  );
  await root
    .getByPlaceholder("Pedido, cliente, teléfono o dirección")
    .fill("Av. Siempre Viva");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await root
    .getByPlaceholder("Pedido, cliente, teléfono o dirección")
    .fill("sin coincidencias");
  await expect(root.getByText("No hay pedidos para este filtro")).toBeVisible();
  observations.push(
    await contrast(
      root.getByText("No hay pedidos para este filtro"),
      "empty state",
    ),
  );
  await page.screenshot({
    path: join(evidence, "orders-empty-filter.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(async () => {
      const s = await window.gastronomy.bootstrap();
      return {
        orders: s.orders,
        cashSession: s.cashSession,
        dashboard: s.dashboard,
      };
    }),
  ).toEqual(data.baseline);
  await writeFile(
    join(evidence, "orders-readability.json"),
    JSON.stringify(
      {
        widths: [1100, 1366],
        exactTotalMinor: 52500000,
        filters,
        measurements: observations,
        filtersSearchPreserveData: true,
      },
      null,
      2,
    ),
  );
  for (const item of observations) {
    expect(item.font, `${item.label}: font size`).toBeGreaterThanOrEqual(12);
    expect(item.ratio, `${item.label}: contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("Pedidos: zoom nativo y Escape de búsqueda no mutan estado", async () => {
  test.setTimeout(90_000);
  const data = await fixture();
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  const root = page.locator("main .panel-enter");
  const input = root.getByPlaceholder("Pedido, cliente, teléfono o dirección");
  const before = await page.evaluate(async () => {
    const s = await window.gastronomy.bootstrap();
    return {
      orders: s.orders,
      cashSession: s.cashSession,
      dashboard: s.dashboard,
    };
  });
  await input.fill("texto temporal");
  await page.keyboard.press("Escape");
  await input.fill("");
  const entryRow = root.getByRole("table").locator("tbody tr").first();
  await entryRow.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setSize(1366, 820);
    w.webContents.setZoomFactor(2);
  });
  await settle();
  expect(
    await app.evaluate(({ BrowserWindow }) => ({
      size: BrowserWindow.getAllWindows()[0]!.getSize(),
      zoom: BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
      visible: BrowserWindow.getAllWindows()[0]!.isVisible(),
      focused: BrowserWindow.getAllWindows()[0]!.isFocused(),
    })),
  ).toEqual({ size: [1366, 820], zoom: 2, visible: false, focused: false });
  const table = root.getByRole("table");
  await table.scrollIntoViewIfNeeded();
  await table.evaluate((el) => {
    el.parentElement!.scrollLeft = el.parentElement!.scrollWidth;
  });
  await settle();
  const zoomLayout = await table.evaluate((el) => {
    const bounds = el.parentElement!.getBoundingClientRect();
    return {
      pageWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      totalReachable: [...el.querySelectorAll("tbody td:last-child")].every(
        (cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const ink = range.getBoundingClientRect();
          return (
            ink.left >= bounds.left - 1 &&
            ink.right <= bounds.right + 1 &&
            range.getClientRects().length === 1
          );
        },
      ),
    };
  });
  expect(zoomLayout.pageWidth).toBeLessThanOrEqual(zoomLayout.clientWidth + 1);
  expect(zoomLayout.totalReachable).toBe(true);
  const zoomText = [
    await contrast(
      root.getByText("Consultá los pedidos para retirar y los envíos."),
      "zoom subtitle",
    ),
    await contrast(
      table.locator("tbody tr").first().locator("td").first().locator("p"),
      "zoom creation time",
    ),
    await contrast(
      table
        .locator("tbody tr")
        .first()
        .locator("td")
        .nth(2)
        .locator("p")
        .nth(1),
      "zoom destination",
    ),
  ];
  for (const item of zoomText) {
    expect(item.font, item.label).toBeGreaterThanOrEqual(12);
    expect(item.ratio, item.label).toBeGreaterThanOrEqual(4.5);
  }
  await writeFile(
    join(evidence, "orders-layout-zoom200.json"),
    JSON.stringify({ ...zoomLayout, measurements: zoomText }, null, 2),
  );
  const rows = root.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  for (const item of data.expected)
    await expect(rows.filter({ hasText: `#${item.number}` })).toContainText(
      formatMoney(52_500_000),
    );
  const native = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    const image = await w.webContents.capturePage();
    return {
      width: image.getSize().width,
      height: image.getSize().height,
      data: image.toPNG().toString("base64"),
    };
  });
  await writeFile(
    join(evidence, "orders-1366-zoom200.png"),
    Buffer.from(native.data, "base64"),
  );
  expect(native.width).toBeGreaterThan(0);
  expect(
    await page.evaluate(async () => {
      const s = await window.gastronomy.bootstrap();
      return {
        orders: s.orders,
        cashSession: s.cashSession,
        dashboard: s.dashboard,
      };
    }),
  ).toEqual(before);
});
