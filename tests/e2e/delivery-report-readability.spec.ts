import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { basename, dirname, join, resolve } from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-delivery-report-fix-2026-10-08",
);
const prefix = "gastronomy-delivery-report-readability-";
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), prefix));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  const expectedVisible = process.env.GASTRONOMY_E2E_BACKGROUND !== "1";
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(expectedVisible);
});

test.afterEach(async () => {
  if (
    test.info().status !== test.info().expectedStatus &&
    page &&
    !page.isClosed()
  )
    await writeFile(
      join(
        evidence,
        `failed-${test
          .info()
          .title.slice(0, 24)
          .replace(/[^a-z0-9]/gi, "_")}.json`,
      ),
      JSON.stringify(
        await page.evaluate(() => ({
          text: document.body.innerText,
          dialogs: [...document.querySelectorAll("[role=dialog]")].map(
            (x) => x.outerHTML,
          ),
        })),
        null,
        2,
      ),
    ).catch(() => {});
  if (app) {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    );
    await app.close();
  }
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith(prefix)
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

async function capture(file: string) {
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

async function metric(locator: Locator, label: string) {
  return {
    label,
    ...(await locator.evaluate((element) => {
      const luminance = (value: string) => {
        const rgb =
          value
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number) ?? [];
        return rgb
          .map((channel) => {
            const c = channel / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      };
      const style = getComputedStyle(element);
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement)
        ancestors.unshift(node);
      let background = [255, 255, 255];
      for (const node of ancestors) {
        const rgba =
          getComputedStyle(node)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [];
        const alpha = rgba[3] ?? 1;
        background = background.map(
          (channel, i) => (rgba[i] ?? 0) * alpha + channel * (1 - alpha),
        );
      }
      const foregroundLum = luminance(style.color);
      const backgroundLum = luminance(`rgb(${background.join(",")})`);
      return {
        text: element.textContent?.trim().replace(/\s+/g, " "),
        fontPx: Number.parseFloat(style.fontSize),
        color: style.color,
        background: `rgb(${background.join(",")})`,
        contrast:
          (Math.max(foregroundLum, backgroundLum) + 0.05) /
          (Math.min(foregroundLum, backgroundLum) + 0.05),
      };
    })),
  };
}

async function writeReadability(
  name: string,
  values: Awaited<ReturnType<typeof metric>>[],
) {
  // Persist all observed values before making thresholds assert-fail (RED evidence).
  await writeFile(
    join(evidence, `${name}.json`),
    JSON.stringify(
      { minimumFontPx: 12, minimumContrast: 4.5, measurements: values },
      null,
      2,
    ),
  );
  for (const value of values) {
    expect(value.fontPx, `${value.label} font size`).toBeGreaterThanOrEqual(12);
    expect(value.contrast, `${value.label} contrast`).toBeGreaterThanOrEqual(
      4.5,
    );
  }
}

async function seedDelivery() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    const initial = await api.bootstrap();
    await api.saveSettings({
      ...initial.settings,
      deliverySettlementEnabled: true,
      deliveryFeeBelongsToDriver: true,
      deliveryDriverPaymentMode: "ACCUMULATED",
    });
    const session = await api.openCashSession({
      openingAmountMinor: 1_000_000,
    });
    const driver = await api.createDriver({
      fullName:
        "Repartidor fixture US07C4 con apellido extraordinariamente largo",
      authorizerPin: "1234",
    });
    const draft = await api.createOrder({
      type: "DELIVERY",
      customerName: "Cliente fixture US07C4",
      customerPhone: "1155550704",
      deliveryAddress: "Calle de prueba 704",
      deliveryFeeMinor: 250_000,
      driverUserId: driver.id,
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: initial.products[0]!.id,
    });
    const confirmed = await api.confirmOrder({ orderId: draft.id });
    await api.completeOrder({
      orderId: draft.id,
      finalStatus: "DELIVERED",
      payments: [{ methodCode: "TRANSFER", amountMinor: confirmed.totalMinor }],
    });
    return {
      sessionId: session.id,
      driverId: driver.id,
      orderId: draft.id,
      number: confirmed.number,
    };
  });
}

async function baseline() {
  return page.evaluate(async () => {
    const state = await window.gastronomy.bootstrap();
    return {
      orders: state.orders,
      cashSession: state.cashSession,
      deliveryLedger: state.deliveryLedger,
      users: state.users,
      settings: state.settings,
    };
  });
}

test("Repartidores vacío y con pendiente: ayudas, card y revisión cancelable legibles sin liquidar", async () => {
  test.setTimeout(90_000);
  await page.getByRole("link", { name: "Repartidores", exact: true }).click();
  await expect(
    page.getByText("Todavía no hay repartidores cargados."),
  ).toBeVisible();
  await writeReadability("delivery-empty-state-readability", [
    await metric(
      page.getByText("Todavía no hay repartidores cargados.", { exact: true }),
      "empty-state caption",
    ),
  ]);
  await capture("delivery-empty-state.png");
  await seedDelivery();
  await page.reload();
  await page.getByRole("link", { name: "Repartidores", exact: true }).click();
  await expect(
    page.getByText("Resumen por repartidor", { exact: true }),
  ).toBeVisible();
  const driver = page
    .locator("tbody td")
    .getByText(
      "Repartidor fixture US07C4 con apellido extraordinariamente largo",
      { exact: true },
    );
  await expect(driver.first()).toBeVisible();
  await driver.first().click();
  // The order number is sourced from the rendered real ledger row, not mocked API state.
  const rowCheckbox = page
    .locator("input[aria-label^='Seleccionar movimiento del pedido']")
    .first();
  await expect(rowCheckbox).toBeVisible();
  const before = await baseline();
  await settle();
  const pageReadings = await Promise.all(
    [
      "Consultá las ganancias y los saldos pendientes de cada repartidor.",
      "Elegí una fila para revisar y seleccionar sus movimientos pendientes.",
      "La ganancia incluye el envío cuando corresponde al repartidor; si el negocio lo retiene, el repartidor rinde el cobro completo.",
      "Ganancia de repartidores",
      "Pendiente: repartidor rinde al negocio",
      "Pendiente: negocio paga al repartidor",
      "Ya liquidado en el período",
    ].map((text) => metric(page.getByText(text, { exact: true }), text)),
  );
  await rowCheckbox.check();
  const settlement = page.getByRole("button", { name: /Pagar envío/ });
  await settlement.click();
  const review = page.getByRole("dialog", {
    name: "Revisar pago o rendición",
    exact: true,
  });
  await expect(review).toBeVisible();
  await review.getByLabel("PIN de autorización", { exact: true }).fill("1234");
  await review
    .getByRole("button", { name: "Revisar liquidación", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Confirmar movimiento de caja",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Volver a revisar", exact: true })
    .click();
  await expect(review).toBeVisible();

  const summary = review.locator("div.grid.gap-px");
  await settle();
  const values = [
    ...pageReadings,
    await metric(
      summary.getByText("Repartidor rinde al negocio · ingresa a caja", {
        exact: true,
      }),
      "settlement driver owes label",
    ),
    await metric(
      summary.getByText("Negocio paga al repartidor · sale de caja", {
        exact: true,
      }),
      "settlement business owes label",
    ),
    await metric(
      summary.getByText("Efecto neto", { exact: true }),
      "settlement net effect label on dark surface",
    ),
  ];
  await capture("delivery-settlement-review.png");
  await writeReadability("delivery-settlement-readability", values);
  await review.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(review).toBeHidden();
  await expect(rowCheckbox).toBeChecked();
  const after = await baseline();
  expect(after).toEqual(before);
  await writeFile(
    join(evidence, "delivery-settlement-cancel-state.json"),
    JSON.stringify(
      { before, after, selectedLedgerCheckboxRemainsChecked: true },
      null,
      2,
    ),
  );
});

async function openPrintReport() {
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.getByRole("button", { name: /^Conciliar y cerrar caja/ }).click();
  await page
    .getByRole("dialog", { name: "Conciliar y cerrar caja" })
    .getByRole("button", { name: /Ver informe del turno/ })
    .click();
  const report = page.getByRole("dialog", { name: "Informe de caja" });
  await report
    .getByRole("button", { name: "Imprimir informe", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Imprimir informe de caja",
    exact: true,
  });
}

test("Imprimir informe de caja: controles de secciones y filtros claros; cancelar conserva datos", async () => {
  test.setTimeout(90_000);
  await seedDelivery();
  await page.reload();
  const before = await baseline();
  const printModal = await openPrintReport();
  await expect(
    printModal.getByText("Secciones obligatorias (siempre incluidas)", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    printModal.getByText("Secciones opcionales", { exact: true }),
  ).toBeVisible();
  const labels = [
    "Por producto",
    "Por categoría",
    "Por mesa",
    "Por mozo",
    "Detalle de pedidos",
  ];
  await expect(printModal.getByRole("checkbox")).toHaveCount(5);
  await expect(
    printModal.getByText("Sin filtros", { exact: true }),
  ).toBeVisible();
  const descriptions = [
    "Cantidades y ventas desglosadas por cada artículo",
    "Ventas agrupadas por rubro o categoría",
    "Ventas y pedidos agrupados por mesa",
    "Mesas atendidas de cada mozo y total acumulado",
    "Listado correlativo de comandas individuales",
  ];
  for (const description of descriptions)
    await expect(
      printModal.getByText(description, { exact: true }),
    ).toBeVisible();
  await settle();
  const normalAll = await metric(
    printModal.getByRole("button", { name: "Todas", exact: true }),
    "select all normal",
  );
  await printModal.getByRole("button", { name: "Todas", exact: true }).hover();
  await settle();
  const readings = [
    normalAll,
    await metric(
      printModal.getByText("Secciones opcionales", { exact: true }),
      "optional header",
    ),
    await metric(
      printModal.getByText("Vista previa del ticket", { exact: true }),
      "preview screen header",
    ),
    ...(await Promise.all(
      descriptions.map((description) =>
        metric(
          printModal
            .locator("label")
            .filter({ hasText: description })
            .locator("span")
            .nth(1),
          `count ${description}`,
        ),
      ),
    )),
    await metric(
      printModal.getByText("Secciones obligatorias (siempre incluidas)", {
        exact: true,
      }),
      "mandatory sections header",
    ),
    await metric(
      printModal.getByRole("button", { name: "Todas", exact: true }),
      "select all optional sections",
    ),
    await metric(
      printModal.getByRole("button", {
        name: "Solo obligatorias",
        exact: true,
      }),
      "mandatory only toggle",
    ),
    await metric(
      printModal.getByText("Sin filtros", { exact: true }),
      "no active filters",
    ),
    ...(await Promise.all(
      labels.map((label) =>
        metric(
          printModal.getByText(label, { exact: true }),
          `optional ${label}`,
        ),
      ),
    )),
    ...(await Promise.all(
      descriptions.map((description) =>
        metric(
          printModal.getByText(description, { exact: true }),
          `description ${description}`,
        ),
      ),
    )),
  ];
  await capture("cash-report-print-options.png");
  await writeReadability("cash-report-print-options-readability", readings);
  await printModal.getByRole("button", { name: "Todas", exact: true }).click();
  await expect(printModal.locator("input[type=checkbox]:checked")).toHaveCount(
    5,
  );
  await printModal
    .getByRole("button", { name: "Solo obligatorias", exact: true })
    .click();
  await expect(printModal.locator("input[type=checkbox]:checked")).toHaveCount(
    0,
  );
  await printModal
    .locator("label", { hasText: "Por producto" })
    .locator("input")
    .check();
  await expect(printModal.locator("input[type=checkbox]:checked")).toHaveCount(
    1,
  );
  await printModal
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(printModal).toBeHidden();
  await expect(
    page.getByRole("dialog", { name: "Informe de caja" }),
  ).toBeVisible();
  expect(await baseline()).toEqual(before);
  await writeFile(
    join(evidence, "cash-report-cancel-state.json"),
    JSON.stringify(
      {
        baselineUnchanged: true,
        selectedOptionsWereResetOnReopen: await (async () => {
          await page
            .getByRole("dialog", { name: "Informe de caja" })
            .getByRole("button", { name: "Imprimir informe", exact: true })
            .click();
          const reopened = page.getByRole("dialog", {
            name: "Imprimir informe de caja",
            exact: true,
          });
          const count = await reopened
            .locator("input[type=checkbox]:checked")
            .count();
          await reopened
            .getByRole("button", { name: "Cancelar", exact: true })
            .click();
          await page.keyboard.press("Escape");
          await page
            .getByRole("dialog", { name: "Conciliar y cerrar caja" })
            .getByRole("button", { name: "Cancelar", exact: true })
            .click();
          expect(count).toBe(0);
          return count === 0;
        })(),
      },
      null,
      2,
    ),
  );
});

test("Repartidores e informe: controles alcanzables en 1100/1366 y zoom 200%", async () => {
  test.setTimeout(90_000);
  await seedDelivery();
  await page.reload();
  const initialState = await baseline();
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
    await page.getByRole("link", { name: "Repartidores", exact: true }).click();
    await page
      .locator("input[aria-label^='Seleccionar movimiento del pedido']")
      .first()
      .check();
    const button = page.getByRole("button", { name: /Pagar envío/ });
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 1 });
    await capture(`delivery-controls-${width}.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
    );
    await settle();
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport({ ratio: 1 });
    const buttonGeometry = await button.evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      text: element.textContent?.trim(),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(buttonGeometry.scrollWidth).toBeLessThanOrEqual(
      buttonGeometry.clientWidth,
    );
    await writeFile(
      join(evidence, `delivery-controls-${width}-zoom200.json`),
      JSON.stringify(buttonGeometry, null, 2),
    );
    await capture(`delivery-controls-${width}-zoom200.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    );
    const printModal = await openPrintReport();
    const toggle = printModal.getByRole("button", {
      name: "Solo obligatorias",
      exact: true,
    });
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toBeInViewport({ ratio: 1 });
    await capture(`cash-report-controls-${width}.png`);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2),
    );
    await settle();
    await expect(toggle).toBeVisible();
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toBeInViewport({ ratio: 1 });
    const controlGeometry = await toggle.evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      text: element.textContent?.trim(),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(controlGeometry.scrollWidth).toBeLessThanOrEqual(
      controlGeometry.clientWidth,
    );
    await writeFile(
      join(evidence, `cash-report-controls-${width}-zoom200.json`),
      JSON.stringify(controlGeometry, null, 2),
    );
    await capture(`cash-report-controls-${width}-zoom200.png`);
    await printModal
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "Conciliar y cerrar caja" })
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    );
  }
  expect(await baseline()).toEqual(initialState);
});
