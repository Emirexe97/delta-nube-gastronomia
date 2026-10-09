import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-summary-table-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function settleRenderer() {
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

test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-summary-table-"));
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
      !basename(profile).startsWith("gastronomy-summary-table-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

test("Resumen mantiene la tabla de retiros y envíos legible en tamaños y zoom", async () => {
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const initial = await api.bootstrap();
    const product = initial.products.find(
      (candidate) => candidate.code === "MUZG",
    )!;
    const expected: Array<{
      number: number;
      totalMinor: number;
      status: string;
    }> = [];

    async function makeOrder(
      type: "TAKEAWAY" | "DELIVERY",
      status: "DRAFT" | "READY" | "IN_PREPARATION",
      suffix: string,
    ) {
      const draft = await api.createOrder({
        type,
        customerName: `Cliente con nombre deliberadamente extenso para probar el ancho de la tabla ${suffix}`,
        customerPhone: "1155000707",
        deliveryAddress:
          type === "DELIVERY"
            ? "Av. Siempre Viva 742, piso 12, departamento A, localidad de prueba"
            : undefined,
      });
      await api.addOrderItem({
        orderId: draft.id,
        productId: product.id,
        quantity: 35,
      });
      if (status === "DRAFT") {
        const stored = (await api.bootstrap()).orders.find(
          (candidate) => candidate.id === draft.id,
        )!;
        expected.push({
          number: stored.number,
          totalMinor: stored.totalMinor,
          status: "Borrador",
        });
        return;
      }
      const confirmed = await api.confirmOrder({ orderId: draft.id });
      if (confirmed.operationalStatus !== status)
        await api.updateOrderStatus({ orderId: draft.id, status });
      expected.push({
        number: confirmed.number,
        totalMinor: confirmed.totalMinor,
        status: status === "READY" ? "Listo" : "En preparación",
      });
    }

    await makeOrder("TAKEAWAY", "DRAFT", "retiro");
    await makeOrder("TAKEAWAY", "READY", "listo");
    await makeOrder("DELIVERY", "IN_PREPARATION", "envío");
    const seeded = await api.bootstrap();
    return {
      expected,
      baseline: {
        orders: seeded.orders,
        cashSession: seeded.cashSession,
        dashboard: seeded.dashboard,
      },
    };
  });

  await page.reload();
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  const heading = page.getByRole("heading", {
    name: "Retiros y envíos en curso",
    exact: true,
  });
  const panel = heading.locator("..").locator("..").locator("..");
  await expect(panel.getByRole("link", { name: "Ver todos" })).toHaveAttribute(
    "href",
    /#\/pedidos$/,
  );
  const table = panel.getByRole("table");
  await expect(table.locator("thead th")).toHaveText([
    "Pedido",
    "Tipo",
    "Cliente / Mesa",
    "Hora de entrega",
    "Estado",
    "Total",
  ]);
  await expect(table.locator("tbody tr")).toHaveCount(fixture.expected.length);

  for (const viewport of [
    { width: 1100, zoom: 1 },
    { width: 1280, zoom: 1 },
    { width: 1366, zoom: 1 },
    { width: 1366, zoom: 2 },
  ]) {
    await app.evaluate(({ BrowserWindow }, { width, zoom }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(width, 820);
      window.webContents.setZoomFactor(zoom);
    }, viewport);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
        ),
      )
      .toBe(viewport.zoom);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.getSize(),
      ),
    ).toEqual([viewport.width, 820]);
    await settleRenderer();

    const layout = await table.evaluate((element) => {
      const wrapper = element.parentElement!;
      const wrapperBox = wrapper.getBoundingClientRect();
      const headerLabels = [...element.querySelectorAll("thead th")].map(
        (cell) => cell.textContent?.trim(),
      );
      const badges = [...element.querySelectorAll("tbody td span")].map(
        (badge) => ({
          text: badge.textContent?.trim(),
          fontSize: Number.parseFloat(getComputedStyle(badge).fontSize),
        }),
      );
      const rows = [...element.querySelectorAll("tbody tr")].map((row) => {
        const cells = [...row.querySelectorAll("td")];
        const amount = cells[5]!;
        const range = document.createRange();
        range.selectNodeContents(amount);
        const ink = range.getBoundingClientRect();
        const cellBox = amount.getBoundingClientRect();
        return {
          number: cells[0]?.textContent?.trim(),
          client: cells[2]?.textContent?.trim(),
          status: cells[4]?.textContent?.trim(),
          amount: amount.textContent?.trim(),
          amountFontSize: Number.parseFloat(getComputedStyle(amount).fontSize),
          amountNoWrap: getComputedStyle(amount).whiteSpace === "nowrap",
          amountDoesNotWrap: range.getClientRects().length === 1,
          totalVisibleAtScrollEnd:
            ink.right <= wrapperBox.right + 1 &&
            ink.left >= wrapperBox.left - 1,
          cellFits:
            ink.right <= cellBox.right + 1 && ink.left >= cellBox.left - 1,
        };
      });
      return {
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        wrapperClientWidth: wrapper.clientWidth,
        wrapperScrollWidth: wrapper.scrollWidth,
        wrapperScrollLeft: wrapper.scrollLeft,
        headerLabels,
        badges,
        rows,
      };
    });
    const isTargetDesktop = viewport.width === 1366 && viewport.zoom === 1;
    expect(
      layout.documentScrollWidth,
      "el documento no presenta overflow horizontal a nivel de página",
    ).toBeLessThanOrEqual(layout.documentClientWidth + 1);
    expect(layout.headerLabels).toHaveLength(6);
    expect(layout.rows).toHaveLength(3);
    for (const badge of layout.badges)
      expect(
        badge.fontSize,
        `badge ${badge.text} conserva 12px`,
      ).toBeGreaterThanOrEqual(12);
    for (const row of layout.rows) {
      expect(row.client).toContain(
        "Cliente con nombre deliberadamente extenso",
      );
      expect(row.status).toBeTruthy();
      expect(row.amountNoWrap).toBe(true);
      expect(row.amountDoesNotWrap).toBe(true);
      expect(row.amountFontSize).toBeGreaterThanOrEqual(12);
      expect(row.cellFits).toBe(true);
    }
    for (const item of fixture.expected) {
      const row = layout.rows.find(
        (candidate) => candidate.number === `#${item.number}`,
      );
      expect(row, `fila del pedido ${item.number}`).toBeTruthy();
      expect(row!.amount).toBe(formatMoney(item.totalMinor));
      expect(row!.status).toBe(item.status);
      if (isTargetDesktop)
        expect(
          row!.totalVisibleAtScrollEnd,
          `total completo del pedido ${item.number} visible sin scroll a 1366`,
        ).toBe(true);
    }
    if (isTargetDesktop)
      expect(
        layout.wrapperScrollWidth,
        "la tabla cabe sin desplazamiento horizontal innecesario a 1366px",
      ).toBeLessThanOrEqual(layout.wrapperClientWidth + 1);
    else {
      await table.evaluate((element) => {
        element.parentElement!.scrollLeft = element.parentElement!.scrollWidth;
      });
      await settleRenderer();
      const totalsVisible = await table.evaluate((element) => {
        const wrapper = element.parentElement!;
        const bounds = wrapper.getBoundingClientRect();
        return [...element.querySelectorAll("tbody tr td:last-child")].map(
          (cell) => {
            const range = document.createRange();
            range.selectNodeContents(cell);
            const ink = range.getBoundingClientRect();
            return ink.left >= bounds.left - 1 && ink.right <= bounds.right + 1;
          },
        );
      });
      expect(
        totalsVisible.every(Boolean),
        "los totales se alcanzan al desplazar la tabla",
      ).toBe(true);
    }

    if (viewport.zoom === 2) {
      // Electron zoom can crop Playwright's fullPage capture; use native pixels.
      await table.scrollIntoViewIfNeeded();
      await table.evaluate((element) => {
        element.parentElement!.scrollLeft = element.parentElement!.scrollWidth;
      });
      await settleRenderer();
      const nativePixels = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
          .toPNG()
          .toString("base64"),
      );
      await writeFile(
        join(out, `summary-table-${viewport.width}-200.png`),
        Buffer.from(nativePixels, "base64"),
      );
    } else {
      await page.screenshot({
        path: join(out, `summary-table-${viewport.width}-100.png`),
        fullPage: true,
      });
    }
    const finalScrollLeft = await table.evaluate(
      (element) => element.parentElement!.scrollLeft,
    );
    await writeFile(
      join(out, `summary-table-${viewport.width}-${viewport.zoom * 100}.json`),
      JSON.stringify(
        {
          ...viewport,
          ...layout,
          finalScrollLeft,
          expected: fixture.expected.map((item) => ({
            ...item,
            formattedTotal: formatMoney(item.totalMinor),
          })),
          realElectronSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
  }

  await page.getByRole("link", { name: "Ver todos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  const afterNavigation = await page.evaluate(async () => {
    const current = await window.gastronomy.bootstrap();
    return {
      orders: current.orders,
      cashSession: current.cashSession,
      dashboard: current.dashboard,
    };
  });
  expect(afterNavigation).toEqual(fixture.baseline);
  await writeFile(
    join(out, "summary-table-state-integrity.json"),
    JSON.stringify(
      {
        navigationLinkPreserved: true,
        stateUnchangedAfterNavigation: true,
        realElectronSqliteAndIpc: true,
      },
      null,
      2,
    ),
  );
});
