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

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-report-tables-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-report-tables-"));
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
    window.gastronomy.openCashSession({ openingAmountMinor: 100_000 }),
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
      !basename(profile).startsWith("gastronomy-report-tables-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function seedReportData() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    const boot = await api.bootstrap();
    const date = boot.cashSession!.businessDate;
    const product = boot.products.find((item) => item.code === "MUZG")!;
    const longProduct = await api.createProduct({
      categoryId: boot.categories[0]!.id,
      name: "Producto gastronómico de nombre deliberadamente largo para comprobar ajuste visual sin perder lectura tokenextraordinariamentelargo",
      code: `US09${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
      prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
        priceListCode: priceListCode as "SALON" | "TAKEAWAY" | "DELIVERY",
        amountMinor: 234_567,
      })),
    });
    const makePaidTakeaway = async (
      productId: string,
      customerName: string,
    ) => {
      const order = await api.createOrder({
        type: "TAKEAWAY",
        customerName,
        customerPhone: "1155000909",
      });
      await api.addOrderItem({ orderId: order.id, productId });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      await api.payOrder({
        orderId: confirmed.id,
        collectedByDriver: false,
        payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
      });
      return confirmed;
    };
    const ordinaryOrder = await makePaidTakeaway(
      product.id,
      "US09 MUZG pagado",
    );
    const longOrder = await makePaidTakeaway(
      longProduct.id,
      "US09 producto largo pagado",
    );
    return {
      date,
      orderNumbers: [ordinaryOrder.number, longOrder.number],
      longProductName: longProduct.name,
      ordinaryProductName: product.name,
      detailedReport: await api.getDetailedReport({
        dateFrom: date,
        dateTo: date,
      }),
      bootstrap: await api.bootstrap(),
    };
  });
}

async function openReports(date: string) {
  await page.getByRole("link", { name: "Informes", exact: true }).click();
  await page.getByLabel("Día comercial desde").fill(date);
  await page.getByLabel("Hasta", { exact: true }).fill(date);
  await expect(
    page.getByRole("heading", { name: "Informes operativos" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Productos más vendidos" }),
  ).toBeVisible();
  await expect(
    page.getByText("Sin datos para el rango", { exact: true }),
  ).toHaveCount(0);
}

async function settleAndCapture(name: string) {
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
  const shot = await app.evaluate(async ({ BrowserWindow }) => {
    const image =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: image.getSize(), data: image.toPNG().toString("base64") };
  });
  expect(shot.size.width).toBeGreaterThan(0);
  await writeFile(
    join(evidence, `${name}.png`),
    Buffer.from(shot.data, "base64"),
  );
}

test("las seis tablas de tres columnas caben a 1100 y 1366 px con texto y montos completos", async () => {
  test.setTimeout(120_000);
  const fixture = await seedReportData();
  const titles = [
    "Productos más vendidos",
    "Categorías",
    "Canales",
    "Medios de pago",
    "Ventas por hora",
    "Por mozo / operador",
  ];
  for (const width of [1100, 1366]) {
    await app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0]!.setSize(width, 900);
    }, width);
    await openReports(fixture.date);
    const measured = await page.evaluate((titles) => {
      const cashHeading = [...document.querySelectorAll("h3")].find(
        (item) => item.textContent?.trim() === "Diferencias de caja por turno",
      )!;
      const cashWrapper = cashHeading
        .closest(".rounded-xl")!
        .querySelector(".overflow-x-auto")! as HTMLElement;
      const cashTable = cashWrapper.querySelector("table")! as HTMLElement;
      const tables = titles.map((title) => {
        const heading = [...document.querySelectorAll("h3")].find(
          (item) => item.textContent?.trim() === title,
        )!;
        const card = heading.closest(".rounded-xl")!;
        const wrapper = card.querySelector(".overflow-x-auto")! as HTMLElement;
        const table = wrapper.querySelector("table")! as HTMLElement;
        return {
          title,
          wrapperClientWidth: wrapper.clientWidth,
          tableScrollWidth: table.scrollWidth,
          tableWidth: table.getBoundingClientRect().width,
          headers: [...table.querySelectorAll("th")].map((cell) =>
            cell.innerText.trim(),
          ),
          cells: [...table.querySelectorAll("tbody td")].map((cell) => ({
            text: cell.innerText.trim(),
            scrollWidth: cell.scrollWidth,
            clientWidth: cell.clientWidth,
            whiteSpace: getComputedStyle(cell).whiteSpace,
            overflow: getComputedStyle(cell).overflow,
            textOverflow: getComputedStyle(cell).textOverflow,
          })),
        };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        cashTable: {
          wrapperClientWidth: cashWrapper.clientWidth,
          tableScrollWidth: cashTable.scrollWidth,
          headerCount: cashTable.querySelectorAll("th").length,
          minWidth: getComputedStyle(cashTable).minWidth,
          wrapperOverflow: getComputedStyle(cashWrapper).overflowX,
        },
        tables,
      };
    }, titles);
    await settleAndCapture(`report-tables-${width}`);
    await writeFile(
      join(evidence, `report-tables-${width}.json`),
      JSON.stringify({ ...measured, realElectronSqliteAndIpc: true }, null, 2),
    );
    expect(measured.tables).toHaveLength(6);
    expect(measured.cashTable.headerCount).toBe(7);
    expect(measured.cashTable.minWidth).toBe("640px");
    expect(measured.cashTable.wrapperOverflow).toBe("auto");
    for (const table of measured.tables) {
      expect(table.headers).toHaveLength(3);
      expect(
        table.tableScrollWidth,
        `${table.title}: table fits its horizontal wrapper at ${width}px`,
      ).toBeLessThanOrEqual(table.wrapperClientWidth + 1);
      expect(
        table.cells.length,
        `${table.title} contains visible report rows`,
      ).toBeGreaterThan(0);
      for (const cell of table.cells.filter((item) => /\$/.test(item.text))) {
        expect(
          cell.textOverflow,
          `${table.title} monetary text is not ellipsized`,
        ).not.toBe("ellipsis");
        expect(
          cell.scrollWidth,
          `${table.title} monetary text is not clipped`,
        ).toBeLessThanOrEqual(cell.clientWidth + 1);
      }
    }
    const productNames = measured.tables[0]!.cells.map((cell) => cell.text);
    expect(productNames).toContain(fixture.longProductName);
    expect(productNames).toContain(fixture.ordinaryProductName);
  }
});

test("al 200% el primer campo envuelve sin truncar importes y filtros vacíos/inválidos no mutan datos", async () => {
  test.setTimeout(120_000);
  const fixture = await seedReportData();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 900),
  );
  await openReports(fixture.date);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
  );
  await expect(
    page.getByRole("heading", { name: "Productos más vendidos" }),
  ).toBeVisible();
  const longName = page
    .getByRole("table")
    .getByText(fixture.longProductName, { exact: true });
  await expect(longName).toBeVisible();
  // Wait for the existing 200ms sidebar width transition after native zoom.
  await expect
    .poll(() =>
      page.locator("aside").evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBe(56);
  const measured = await longName.evaluate((element) => {
    const cell = element.closest("td")!;
    const table = cell.closest("table")!;
    const moneyCells = [...table.querySelectorAll("tbody td")]
      .filter((item) => item.textContent?.includes("$"))
      .map((item) => ({
        text: item.textContent!.trim(),
        clientWidth: (item as HTMLElement).clientWidth,
        scrollWidth: (item as HTMLElement).scrollWidth,
        textOverflow: getComputedStyle(item).textOverflow,
        overflow: getComputedStyle(item).overflow,
      }));
    return {
      tableWidth: table.scrollWidth,
      wrapperWidth: table.parentElement!.clientWidth,
      firstCell: {
        text: cell.textContent!.trim(),
        whiteSpace: getComputedStyle(cell).whiteSpace,
        height: cell.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(cell).lineHeight),
      },
      moneyCells,
    };
  });
  await longName.scrollIntoViewIfNeeded();
  await settleAndCapture("report-tables-zoom-200");
  await writeFile(
    join(evidence, "report-tables-zoom-200.json"),
    JSON.stringify({ ...measured, realElectronSqliteAndIpc: true }, null, 2),
  );
  expect(measured.tableWidth).toBeLessThanOrEqual(measured.wrapperWidth + 1);
  expect(measured.firstCell.whiteSpace).not.toBe("nowrap");
  expect(measured.firstCell.height).toBeGreaterThan(
    measured.firstCell.lineHeight + 1,
  );
  expect(measured.moneyCells.length).toBeGreaterThan(0);
  for (const cell of measured.moneyCells) {
    expect(cell.textOverflow).not.toBe("ellipsis");
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1);
  }

  const start = page.getByLabel("Día comercial desde");
  const end = page.getByLabel("Hasta", { exact: true });
  await start.fill("2000-01-01");
  await end.fill("2000-01-01");
  await expect(
    page.getByText("Sin datos para el rango", { exact: true }),
  ).toHaveCount(7);
  await expect(
    page.getByRole("button", { name: "Exportar ventas CSV" }),
  ).toBeEnabled();
  await start.fill("");
  await expect(
    page.getByRole("heading", { name: "Productos más vendidos" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Exportar ventas CSV" }),
  ).toBeDisabled();
  await start.fill(fixture.date);
  await end.fill(fixture.date);
  await expect(
    page.getByRole("heading", { name: "Productos más vendidos" }),
  ).toBeVisible();
  await start.fill("2026-10-09");
  await end.fill("2026-10-08");
  await expect(page.getByRole("alert")).toContainText(
    "la fecha inicial no puede ser posterior",
  );
  await expect(
    page.getByRole("heading", { name: "Productos más vendidos" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  const afterNavigation = await page.evaluate(
    async (date) => ({
      bootstrap: await window.gastronomy.bootstrap(),
      detailedReport: await window.gastronomy.getDetailedReport({
        dateFrom: date,
        dateTo: date,
      }),
    }),
    fixture.date,
  );
  expect(afterNavigation.bootstrap).toEqual(fixture.bootstrap);
  expect(afterNavigation.detailedReport).toEqual(fixture.detailedReport);
  await writeFile(
    join(evidence, "report-tables-filters-and-data.json"),
    JSON.stringify(
      {
        emptyAndInvalidRangesDidNotChangeBusinessData: true,
        afterNavigation,
        realElectronSqliteAndIpc: true,
      },
      null,
      2,
    ),
  );
});
