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

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us07a-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

async function stableScreenshot(path: string) {
  await page.evaluate(async () => {
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
  await page.screenshot({ path, fullPage: true });
}

test.beforeEach(async () => {
  await mkdir(out, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us07-readability-"));
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
      !basename(profile).startsWith("gastronomy-us07-readability-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function inspectReadableText(route: string, width: number) {
  await stableScreenshot(join(out, `us07-${route}-${width}.png`));
  const measured = await page.evaluate(() => {
    const rgb = (value: string) =>
      value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [];
    const luminance = (value: string) => {
      const channels = rgb(value);
      if (channels.length !== 3) return null;
      return channels
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
    };
    const opaqueBackground = (element: Element) => {
      let node: Element | null = element;
      while (node) {
        const style = getComputedStyle(node);
        const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
        const alpha = match?.[1]?.split(",")[3];
        if (match && (alpha === undefined || Number(alpha) >= 0.999))
          return style.backgroundColor;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const entries = [
      ...document.querySelectorAll(
        ".panel-enter p, .panel-enter span, .panel-enter th, .panel-enter dt, .panel-enter a, .panel-enter h3",
      ),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const text = element.textContent?.trim() ?? "";
        // Badge values are intentionally compact labels, not explanatory text.
        const badge =
          element.matches("span") &&
          element.className.includes("inline-flex") &&
          element.className.includes("rounded-md");
        return (
          !badge &&
          text &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .map((element) => {
        const style = getComputedStyle(element);
        const background = opaqueBackground(element);
        const foregroundLum = luminance(style.color);
        const backgroundLum = luminance(background);
        const range = document.createRange();
        range.selectNodeContents(element);
        const ink = range.getBoundingClientRect();
        const card =
          element.closest("td, th") ??
          element.closest(".rounded-xl") ??
          element.parentElement ??
          element;
        const bounds = card.getBoundingClientRect();
        return {
          text: element.textContent!.trim().replace(/\s+/g, " "),
          tag: element.tagName.toLowerCase(),
          fontSize: Number.parseFloat(style.fontSize),
          contrast:
            foregroundLum === null || backgroundLum === null
              ? null
              : (Math.max(foregroundLum, backgroundLum) + 0.05) /
                (Math.min(foregroundLum, backgroundLum) + 0.05),
          fitsCard:
            element.matches(".font-mono.truncate") ||
            (ink.left >= bounds.left - 1 && ink.right <= bounds.right + 1),
          background,
        };
      });
    const viewport = document.documentElement;
    const buttons = [...document.querySelectorAll("main button")]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return (
          getComputedStyle(button).display !== "none" &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .map((button) => {
        const box = button.getBoundingClientRect();
        return {
          label:
            button.textContent?.trim() || button.getAttribute("aria-label"),
          reachable: box.right <= window.innerWidth + 1 && box.left >= -1,
        };
      });
    return {
      entries,
      documentOverflow: viewport.scrollWidth > viewport.clientWidth + 1,
      buttons,
    };
  });
  expect(
    measured.entries.length,
    `${route} has measured explanatory text`,
  ).toBeGreaterThan(0);
  for (const entry of measured.entries) {
    expect(
      entry.fontSize,
      `${route} font size for ${entry.text}`,
    ).toBeGreaterThanOrEqual(12);
    expect(
      entry.contrast,
      `${route} contrast for ${entry.text}`,
    ).not.toBeNull();
    expect(
      entry.contrast!,
      `${route} contrast for ${entry.text}`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(entry.fitsCard, `${route} text fits its card: ${entry.text}`).toBe(
      true,
    );
  }
  expect(
    measured.documentOverflow,
    `${route} has no document-level horizontal overflow`,
  ).toBe(false);
  for (const button of measured.buttons)
    expect(button.reachable, `${route} button reachable: ${button.label}`).toBe(
      true,
    );
  await stableScreenshot(join(out, `us07-${route}-${width}.png`));
  await writeFile(
    join(out, `us07-${route}-${width}.json`),
    JSON.stringify(
      { width, ...measured, realElectronSqliteAndIpc: true },
      null,
      2,
    ),
  );
}

for (const width of [1100, 1366]) {
  test(`Dashboard, informes y auditoría mantienen texto secundario legible a ${width}px`, async () => {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0]!.setSize(width, 820),
      width,
    );
    const fixture = await page.evaluate(async () => {
      const api = window.gastronomy;
      const session = await api.openCashSession({
        openingAmountMinor: 100_000,
      });
      await api.registerCashMovement({
        type: "EXPENSE",
        amountMinor: 12_500,
        reason: "US07 gasto de caja para auditoría",
        paymentMethodCode: "CASH",
        idempotencyKey: crypto.randomUUID(),
      });
      const boot = await api.bootstrap();
      const date = boot.cashSession!.businessDate;
      const product = boot.products.find((item) => item.code === "MUZG")!;
      const order = await api.createOrder({
        type: "TAKEAWAY",
        customerName: "US07 pedido pagado",
        customerPhone: "1155000700",
      });
      await api.addOrderItem({ orderId: order.id, productId: product.id });
      const confirmed = await api.confirmOrder({ orderId: order.id });
      await api.payOrder({
        orderId: confirmed.id,
        collectedByDriver: false,
        payments: [{ methodCode: "CASH", amountMinor: confirmed.totalMinor }],
      });
      const afterSeed = await api.bootstrap();
      return {
        sessionId: session.id,
        date,
        orderNumber: confirmed.number,
        cashReport: await api.getCashSessionReport({
          cashSessionId: session.id,
        }),
        detailedReport: await api.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
        audit: await api.getAuditLog({
          dateFrom: date,
          dateTo: date,
          action: "CASH_EXPENSE",
          search: "US07 gasto de caja para auditoría",
          offset: 0,
          limit: 20,
        }),
        bootstrap: afterSeed,
      };
    });

    await page.reload();
    await expect(
      page.getByText(`${1} pedido con pago · día comercial`, { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText("Incluye pagos parciales y cuenta corriente", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    if (width === 1366) {
      const activeTable = page
        .getByRole("heading", {
          name: "Retiros y envíos en curso",
          exact: true,
        })
        .locator("../../..")
        .getByRole("table");
      const layout = await activeTable.evaluate((table) => ({
        contentWidth: table.parentElement!.clientWidth,
        scrollWidth: table.parentElement!.scrollWidth,
      }));
      expect(
        layout.scrollWidth,
        "importe de pedido visible sin nuevo desplazamiento a 1366",
      ).toBeLessThanOrEqual(layout.contentWidth + 1);
    }
    await inspectReadableText("dashboard", width);

    await page.getByRole("link", { name: "Informes", exact: true }).click();
    await page.getByLabel("Día comercial desde").fill(fixture.date);
    await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);
    await expect(
      page.getByText("Importes de envío", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Ventas, productos, caja, personal y envíos por día comercial/i,
      ),
    ).toBeVisible();
    await inspectReadableText("informes", width);

    await page.getByRole("link", { name: "Auditoría", exact: true }).click();
    await page.getByLabel("Desde", { exact: true }).fill(fixture.date);
    await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);
    await page.getByRole("combobox").selectOption("CASH_EXPENSE");
    await page
      .getByPlaceholder("Entidad, usuario o motivo")
      .fill("US07 gasto de caja para auditoría");
    await expect(
      page.getByText("US07 gasto de caja para auditoría", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("table").getByText(/\d{1,2}:\d{2}/),
    ).toBeVisible();
    await expect(
      page.getByRole("table").getByText("Gasto de caja", { exact: true }),
    ).toBeVisible();
    await inspectReadableText("auditoria", width);

    const afterNavigation = await page.evaluate(
      async ({ date, sessionId }) => ({
        bootstrap: await window.gastronomy.bootstrap(),
        cashReport: await window.gastronomy.getCashSessionReport({
          cashSessionId: sessionId,
        }),
        detailedReport: await window.gastronomy.getDetailedReport({
          dateFrom: date,
          dateTo: date,
        }),
        audit: await window.gastronomy.getAuditLog({
          dateFrom: date,
          dateTo: date,
          action: "CASH_EXPENSE",
          search: "US07 gasto de caja para auditoría",
          offset: 0,
          limit: 20,
        }),
      }),
      { date: fixture.date, sessionId: fixture.sessionId },
    );
    expect(afterNavigation.bootstrap).toEqual(fixture.bootstrap);
    expect(afterNavigation.cashReport).toEqual(fixture.cashReport);
    expect(afterNavigation.detailedReport).toEqual(fixture.detailedReport);
    expect(afterNavigation.audit).toEqual(fixture.audit);
    expect(fixture.audit).toHaveLength(1);
    expect(fixture.audit[0]?.action).toBe("CASH_EXPENSE");
    await writeFile(
      join(out, `us07-fixture-${width}.json`),
      JSON.stringify(
        {
          width,
          orderNumber: fixture.orderNumber,
          expenseAction: fixture.audit[0]?.action,
          reportsAndAuditUnchangedAfterNavigation: true,
          realElectronSqliteAndIpc: true,
        },
        null,
        2,
      ),
    );
  });
}

test("la ayuda de campo al crear pedido no modifica datos al cancelar", async () => {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setSize(1100, 820),
  );
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 0 }),
  );
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await page.getByRole("button", { name: "Nuevo pedido", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const hint = dialog.getByText(
    "Escribí nombre o teléfono para buscar un cliente.",
    { exact: true },
  );
  await expect(hint).toBeVisible();
  await stableScreenshot(join(out, "us07-ayuda-pedido-1100.png"));
  const measurement = await hint.evaluate((element) => {
    const rgba = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.map(Number);
      return [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1];
    };
    const ancestors: Element[] = [];
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
    )
      ancestors.push(current);
    let background = [255, 255, 255];
    for (const ancestor of ancestors.reverse()) {
      const color = rgba(getComputedStyle(ancestor).backgroundColor);
      background = background.map(
        (channel, index) =>
          color[index]! * color[3]! + channel * (1 - color[3]!),
      );
    }
    const foreground = rgba(getComputedStyle(element).color);
    const luminance = (channels: number[]) =>
      channels.slice(0, 3).reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum +
          (value <= 0.04045
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]!
        );
      }, 0);
    const fg = luminance(foreground),
      bg = luminance(background);
    return {
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      foreground,
      background,
      contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
    };
  });
  await writeFile(
    join(out, "us07-ayuda-pedido-1100.json"),
    JSON.stringify(measurement, null, 2),
  );
  expect(
    measurement.fontSize,
    "sharedField hint font size",
  ).toBeGreaterThanOrEqual(12);
  expect(
    measurement.contrast,
    "sharedField hint contrast with composed background",
  ).toBeGreaterThanOrEqual(4.5);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    before,
  );
});
