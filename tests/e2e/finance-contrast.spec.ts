import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us01-fix-2026-10-06",
);
let app: ElectronApplication;
let page: Page;
let profile: string;

test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us01-contrast-"));
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
  if (
    dirname(resolve(profile)) !== resolve(tmpdir()) ||
    !basename(profile).startsWith("gastronomy-us01-contrast-")
  )
    throw new Error("Unsafe disposable profile path");
  await rm(profile, { recursive: true, force: true });
});

const scenarios = [
  ...[1280, 1100].flatMap((width) =>
    ["positive", "zero", "negative"].map((state) => ({
      width,
      state,
      zoom: 1,
    })),
  ),
  { width: 1100, state: "positive", zoom: 2 },
];
for (const { width, state, zoom } of scenarios) {
  test(`operating result contrast ${state} at ${width}px and ${zoom * 100}% zoom`, async () => {
    await app.evaluate(
      ({ BrowserWindow }, { width, zoom }) => {
        const window = BrowserWindow.getAllWindows()[0]!;
        window.setSize(width, width === 1100 ? 680 : 820);
        window.webContents.setZoomFactor(zoom);
      },
      { width, zoom },
    );
    const fixture = await page.evaluate(async (state) => {
      const api = window.gastronomy;
      await api.openCashSession({ openingAmountMinor: 0 });
      const data = await api.bootstrap();
      const date = data.cashSession!.businessDate;
      if (state === "positive") {
        const product = data.products.find(
          (product) => product.code === "MUZG",
        )!;
        await api.setFinanceProductCost({
          productId: product.id,
          unitCostMinor: 300_000,
        });
        const order = await api.createOrder({
          type: "TAKEAWAY",
          customerName: "US01 contraste",
          customerPhone: "1155000100",
        });
        await api.addOrderItem({ orderId: order.id, productId: product.id });
        await api.confirmOrder({ orderId: order.id });
      } else if (state === "negative") {
        await api.createFinanceExpense({
          title: "US01 gasto de prueba",
          category: "Prueba aislada",
          kind: "GENERAL",
          amountMinor: 500_000,
          incurredOn: date,
          dueOn: date,
          idempotencyKey: crypto.randomUUID(),
        });
      }
      return {
        date,
        report: await api.getFinanceReport({ from: date, to: date }),
      };
    }, state);
    const profit = fixture.report.estimatedOperatingProfitMinor;
    if (state === "positive") expect(profit).toBeGreaterThan(0);
    else if (state === "negative") expect(profit).toBe(-500_000);
    else expect(profit).toBe(0);
    await page.reload();
    await page.getByRole("link", { name: "Finanzas", exact: true }).click();
    await page.getByLabel("Desde", { exact: true }).fill(fixture.date);
    await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);
    const card = page
      .getByText("Resultado operativo estimado", { exact: true })
      .locator("..");
    await expect(card).toBeVisible();
    await expect(card.locator("p").nth(1)).toHaveText(formatMoney(profit));
    // Reload/navigation may reset per-origin zoom. Verify magnification after navigation.
    await app.evaluate(({ BrowserWindow }, zoom) => {
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom);
    }, zoom);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
        ),
      )
      .toBe(zoom);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const contentWidth = await app.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.getContentSize()[0],
    );
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(Math.abs(viewportWidth - contentWidth / zoom)).toBeLessThanOrEqual(
      2,
    );
    const actual = await card.evaluate((element) => {
      const rgb = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = (value: string) =>
        rgb(value)
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, channel, index) =>
              sum + channel * [0.2126, 0.7152, 0.0722][index]!,
            0,
          );
      const background = getComputedStyle(element).backgroundColor;
      const backgroundLuminance = luminance(background);
      const children = [...element.querySelectorAll("p")].map((paragraph) => {
        const color = getComputedStyle(paragraph).color;
        const foreground = luminance(color);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const ink = range.getBoundingClientRect();
        const box = paragraph.getBoundingClientRect();
        return {
          text: paragraph.textContent,
          color,
          contrast:
            (Math.max(foreground, backgroundLuminance) + 0.05) /
            (Math.min(foreground, backgroundLuminance) + 0.05),
          fits: ink.left >= box.left - 1 && ink.right <= box.right + 1,
        };
      });
      const section = element.parentElement!;
      return {
        background,
        children,
        neighboringBackgrounds: [...section.children]
          .filter((child) => child !== element)
          .map((child) => getComputedStyle(child).backgroundColor),
        opacity: getComputedStyle(element).opacity,
      };
    });
    const tag = `${process.env.FINANCE_CONTRAST_PHASE ?? "after"}-${state}-${width}-${zoom * 100}`;
    if (zoom === 1)
      await card.screenshot({ path: join(out, `${tag}-card.png`) });
    else
      await card.evaluate(async (element) => {
        element.scrollIntoView({ block: "center", behavior: "instant" });
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
    await expect(card).toBeInViewport({ ratio: 1 });
    if (zoom === 1)
      await page.screenshot({
        path: join(out, `${tag}-page.png`),
        fullPage: true,
      });
    else
      await app.evaluate(
        async ({ app, BrowserWindow }, { profile, file }) => {
          const path = process.getBuiltinModule("path");
          const artifactRoot = path.resolve(
            process.cwd(),
            "docs/qa/evidence/system-usability-us01-fix-2026-10-06",
          );
          if (
            path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
            path.dirname(path.resolve(file)) !== artifactRoot
          )
            throw new Error(
              "Screenshot outside disposable test/evidence context",
            );
          // Electron's native bitmap includes the entire zoomed content. Playwright's
          // CSS-sized capture may cut it off when Electron zoom is above 100%.
          const bitmap =
            await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
          await process
            .getBuiltinModule("fs")
            .promises.writeFile(file, bitmap.toPNG());
        },
        { profile, file: join(out, `${tag}-page.png`) },
      );
    await writeFile(
      join(out, `${tag}.json`),
      JSON.stringify(
        {
          ...actual,
          profitMinor: profit,
          state,
          width,
          zoom,
          contentWidth,
          viewportWidth,
          realSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
    for (const paragraph of actual.children) {
      expect(
        paragraph.contrast,
        `contrast for ${paragraph.text}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(paragraph.fits, `no clipping for ${paragraph.text}`).toBe(true);
    }
    expect(actual.opacity).toBe("1");
    expect(actual.neighboringBackgrounds).toEqual(
      Array(5).fill("rgb(255, 255, 255)"),
    );
    expect(
      await page.evaluate(
        ({ date }) =>
          window.gastronomy.getFinanceReport({ from: date, to: date }),
        fixture,
      ),
    ).toEqual(fixture.report);
  });
}
