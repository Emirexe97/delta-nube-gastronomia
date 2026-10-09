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
  "docs/qa/evidence/system-usability-navigation-frame-fix-2026-10-07",
);
const expectedLinks = [
  "Resumen",
  "Salón",
  "Pedidos",
  "Productos",
  "Compras",
  "Clientes",
  "Repartidores",
  "Usuarios",
  "Caja",
  "Finanzas",
  "Informes",
  "Auditoría",
  "Configuración",
];
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-navigation-readability-"));
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
    .poll(async () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(process.env.GASTRONOMY_E2E_BACKGROUND !== "1");
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
          text: document.body.innerText,
          url: location.href,
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
      !basename(profile).startsWith("gastronomy-navigation-readability-")
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
  await settle();
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

async function saveAndAssertReadability(
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
      tables: s.tables,
      products: s.products,
      users: s.users,
    };
  });
}

async function checkWindowMode() {
  const expectedVisible = process.env.GASTRONOMY_E2E_BACKGROUND !== "1";
  await expect
    .poll(async () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(expectedVisible);
  // Do not assert focus: a foreground window may lose focus to the user during a run.
}

test("Navegación y cabecera: marca, cinco grupos, estados de links y caja abierta conservan legibilidad", async () => {
  test.setTimeout(90_000);
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 52_500_000 }),
  );
  await page.reload();
  await settle();
  const initial = await baseline();
  const readings = [
    await metrics(
      page.getByText("Gastronomía", { exact: true }).first(),
      "brand Gastronomía",
    ),
    ...["General", "Operación", "Gestión", "Control", "Sistema"].map(
      async (group) =>
        metrics(
          page.locator("nav").getByText(group, { exact: true }),
          `nav group ${group}`,
        ),
    ),
    await metrics(
      page.getByText("Operación local", { exact: true }),
      "local operation label",
    ),
    await metrics(
      page.locator("main > header .border-l p").nth(1),
      "current role",
    ),
  ];
  const settled = await Promise.all(readings);
  settled.push(
    await metrics(
      page.getByRole("button", { name: "Contraer", exact: true }),
      "collapse control",
    ),
  );
  // Native width1366 exposes the existing xl clock.
  settled.push(
    await metrics(
      page.locator("main > header .xl\\:flex span"),
      "main > header clock",
    ),
  );
  const inactive = page.getByRole("link", { name: "Pedidos", exact: true });
  settled.push(await metrics(inactive, "inactive navigation link"));
  await inactive.hover();
  await settle();
  settled.push(await metrics(inactive, "hover navigation link"));
  const active = page.getByRole("link", { name: "Resumen", exact: true });
  settled.push(await metrics(active, "active navigation link"));
  const cashLabel = page.getByText(/Caja #\d+ abierta/);
  const cashAmount = page
    .locator("main > header")
    .getByText(formatMoney(52_500_000), { exact: true });
  await expect(cashLabel).toBeVisible();
  await expect(cashAmount).toBeVisible();
  settled.push(
    await metrics(cashLabel, "open cash-session label"),
    await metrics(cashAmount, "open cash-session amount"),
  );
  await nativeCapture("navigation-open-cash.png");
  await page.getByRole("button", { name: "Contraer" }).click();
  await settle();
  await expect(page.getByRole("link", { name: "Pedidos" })).toBeVisible();
  expect(await baseline()).toEqual(initial);
  await saveAndAssertReadability(settled);
  await checkWindowMode();
});

test("Menú: trece rutas, grupos ordenados, colapsar/reexpandir persiste tras reload sin alterar datos", async () => {
  test.setTimeout(90_000);
  await settle();
  const closed = await metrics(
    page.locator("main > header").getByText("Caja cerrada", { exact: true }),
    "closed cash badge",
  );
  await saveAndAssertReadability([closed]);
  const before = await baseline();
  const links = page.locator("aside nav a");
  await expect(links).toHaveCount(13);
  await expect(links).toHaveText(expectedLinks);
  await expect(
    page.locator("nav").getByText("General", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("nav").getByText("Operación", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("nav").getByText("Gestión", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("nav").getByText("Control", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("nav").getByText("Sistema", { exact: true }),
  ).toBeVisible();
  const order = await links.evaluateAll((els) =>
    els.map((el) =>
      (el as HTMLAnchorElement).getAttribute("href")?.replace(/^#/, ""),
    ),
  );
  expect(order).toEqual([
    "/resumen",
    "/salon",
    "/pedidos",
    "/catalogo",
    "/compras",
    "/clientes",
    "/repartidores",
    "/usuarios",
    "/caja",
    "/finanzas",
    "/informes",
    "/auditoria",
    "/configuracion",
  ]);
  for (const [index, label] of expectedLinks.entries()) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page.locator("main > header h1")).toHaveText(label);
    await expect
      .poll(() => page.evaluate(() => location.hash.slice(1).split("?")[0]))
      .toBe(order[index]);
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator("main > header h1")).toBeVisible();
  }
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.getByRole("button", { name: "Contraer" }).click();
  await expect(page.locator("aside nav a")).toHaveCount(13);
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(page.locator("main > header h1")).toHaveText("Pedidos");
  await page.reload();
  await expect(page.locator("aside")).toHaveCSS("width", "64px");
  await expect(page.locator("aside nav a")).toHaveCount(13);
  // Collapsed button has no accessible name by design today; use the existing aside>button, don't alter product.
  await page.locator("aside > button").click();
  await expect(page.locator("aside")).toHaveCSS("width", "214px");
  await page.reload();
  await expect(page.locator("aside")).toHaveCSS("width", "214px");
  expect(await baseline()).toEqual(before);
  await nativeCapture("navigation-reexpanded-after-reload.png");
  await checkWindowMode();
});

test("Cabecera y navegación caben en 1100/1366 y zoom 200%, la caja completa sigue alcanzable", async () => {
  test.setTimeout(90_000);
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 52_500_000 }),
  );
  await page.reload();
  const before = await baseline();
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
    await page.getByRole("link", { name: "Resumen", exact: true }).click();
    const issues = await page.locator("main > header").evaluate((header) => {
      const elements = [...header.querySelectorAll("div, p, h1, span")]
        .filter((el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return (
            s.display !== "none" &&
            r.width > 0 &&
            r.height > 0 &&
            (el.children.length === 0 || el.tagName === "H1")
          );
        })
        .map((el) => ({
          text: el.textContent?.trim(),
          r: el.getBoundingClientRect().toJSON(),
        }));
      const collisions: string[] = [];
      for (let i = 0; i < elements.length; i++)
        for (let j = i + 1; j < elements.length; j++) {
          const a = elements[i]!.r,
            b = elements[j]!.r;
          if (
            a.width > 0 &&
            b.width > 0 &&
            a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom &&
            elements[i]!.text &&
            elements[j]!.text
          )
            collisions.push(`${elements[i]!.text} <> ${elements[j]!.text}`);
        }
      return {
        width: header.getBoundingClientRect().width,
        scrollWidth: (header as HTMLElement).scrollWidth,
        elements,
        collisions,
      };
    });
    expect(issues.collisions, JSON.stringify(issues)).toEqual([]);
    await writeFile(
      join(evidence, `navigation-header-layout-${width}.json`),
      JSON.stringify(issues, null, 2),
    );
    const total = page
      .locator("main > header")
      .getByText(formatMoney(52_500_000), { exact: true });
    await expect(total).toBeVisible();
    await total.scrollIntoViewIfNeeded();
    await expect(total).toBeInViewport({ ratio: 1 });
    await expect(page.locator("aside nav")).toHaveCSS("overflow-y", "auto");
    await expect(page.locator("aside nav a")).toHaveCount(13);
    await nativeCapture(`navigation-frame-${width}.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
    );
    await settle();
    await expect(total).toBeVisible();
    await total.scrollIntoViewIfNeeded();
    await expect(total).toBeInViewport({ ratio: 1 });
    await expect(page.locator("aside nav a")).toHaveCount(13);
    const zoomLayout = await page
      .locator("main > header")
      .evaluate((header) => ({
        width: header.getBoundingClientRect().width,
        scrollWidth: (header as HTMLElement).scrollWidth,
      }));
    const amountLayout = await total.evaluate((el) => ({
      rect: el.getBoundingClientRect().toJSON(),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      text: el.textContent,
    }));
    expect(amountLayout.scrollWidth).toBeLessThanOrEqual(
      amountLayout.clientWidth,
    );
    expect(zoomLayout.scrollWidth).toBeLessThanOrEqual(zoomLayout.width + 1);
    await writeFile(
      join(evidence, `navigation-header-layout-${width}-zoom200.json`),
      JSON.stringify({ ...zoomLayout, amount: amountLayout }, null, 2),
    );
    await nativeCapture(`navigation-frame-${width}-zoom200.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    );
    await settle();
  }
  expect(await baseline()).toEqual(before);
  await checkWindowMode();
});
