import { test, expect } from "@playwright/test";
import type {
  AppSettingsDto,
  CashSessionReportDto,
} from "@gastronomy/contracts";
import { cashSessionReportHtml } from "../../apps/desktop-shell/src/cash-session-ticket";

const settings = {
  businessName: "La cocina <central> & socios",
  printing: {
    terminalLabel: 'Caja "principal"',
    bill: { paperWidth: "80mm", feedLinesBeforeCut: 1 },
  },
} as AppSettingsDto;
function report(): CashSessionReportDto {
  return {
    session: {
      id: "test",
      number: 12,
      businessDate: "2026-10-12",
      openedAt: "2026-10-12T22:00:00-03:00",
      closedAt: "2026-10-13T01:00:00-03:00",
      openedByUserId: "admin",
      openedByName: "Emir",
      status: "CLOSED",
      openingAmountMinor: 100_000,
      expectedAmountMinor: 600_000,
      countedAmountMinor: 590_000,
      closingFloatAmountMinor: 150_000,
      differenceMinor: -10_000,
      cashIncomeMinor: 500_000,
      movements: [],
    },
    detailAvailable: true,
    retentionCutoff: "2026-08-13",
    totals: {
      salesMinor: 700_000,
      orderCount: 3,
      averageTicketMinor: 233_333,
      discountsMinor: 2_000,
      refundsMinor: 1_000,
    },
    byProduct: [
      {
        productId: "p",
        name: "Producto <especial>",
        amountMinor: 100_000,
        quantity: 2,
      },
    ],
    byCategory: [],
    byTable: [],
    byWaiter: [],
    byType: [{ type: "TAKEAWAY", amountMinor: 700_000, orderCount: 3 }],
    byPaymentMethod: [
      { code: "TRANSFER", name: "Transferencia", amountMinor: 700_000 },
    ],
    orders: [],
    movements: [],
    filters: { cashSessionId: "test" },
  };
}

test("ticket prioriza ventas totales y separa medios, arqueo y movimientos", () => {
  const html = cashSessionReportHtml(report(), settings, {});
  const sequence = [
    "Resumen de ventas",
    "Por medio de pago",
    "Por tipo",
    "Resultado del cierre",
    "Movimientos de efectivo",
  ];
  const indexes = sequence.map((title) => html.indexOf(`>${title}</h3>`));
  expect(indexes.every((index) => index >= 0)).toBe(true);
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  for (const text of [
    "Cierre de caja",
    "Ventas totales",
    "Faltante",
    "Esperado sin cambio",
    "$ 4.500",
    "Contado sin cambio",
    "$ 4.400",
    "Cambio final",
    "$ 1.500",
    "Diferencia",
    "Ventas de todos los medios",
  ])
    expect(html.replaceAll("\u00a0", " ")).toContain(text);
  expect(html).toContain("12/10/2026, 22:00:00");
  expect(html).toContain("13/10/2026, 01:00:00");
  expect(html).toContain("La cocina &lt;central&gt; &amp; socios");
  expect(html).toContain("Caja &quot;principal&quot;");
  expect(html).not.toContain("Por producto</h3>");
});

test("turno abierto no inventa cierre, conteo ni diferencia", () => {
  const data = report();
  Object.assign(data.session, {
    status: "OPEN",
    closedAt: null,
    countedAmountMinor: null,
    closingFloatAmountMinor: null,
    differenceMinor: null,
  });
  const html = cashSessionReportHtml(data, settings, {});
  expect(html).toContain("Informe provisorio");
  expect(html).toContain("TURNO EN CURSO");
  expect(html).toContain("Movimientos de efectivo");
  for (const text of [
    ">Contado sin cambio</span>",
    ">Cambio final</span>",
    ">Diferencia</span>",
    ">Cuadra</p>",
    "Cierre de caja",
  ])
    expect(html).not.toContain(text);
});

test("cuadre y sobrante se expresan sin alterar importes", () => {
  for (const [differenceMinor, label] of [
    [0, "Cuadra"],
    [10_000, "Sobrante"],
  ] as const) {
    const data = report();
    data.session.differenceMinor = differenceMinor;
    data.session.countedAmountMinor =
      data.session.expectedAmountMinor + differenceMinor;
    expect(cashSessionReportHtml(data, settings, {})).toContain(
      `<p class="result-status">${label}</p>`,
    );
  }
});

test("filtros se distinguen del arqueo completo y se escapan; detalle retenido no se inventa", () => {
  const data = report();
  data.filters.categoryName = '<script>alert("x")</script>';
  const html = cashSessionReportHtml(data, settings, { byProduct: true });
  expect(html).toContain("Ventas filtradas");
  expect(html).not.toContain(">Ventas totales</span>");
  expect(html).toContain("El arqueo corresponde al turno completo.");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Producto &lt;especial&gt;");
  data.detailAvailable = false;
  const summary = cashSessionReportHtml(data, settings, { byProduct: true });
  expect(summary).toContain("resumen conservado");
  expect(summary).not.toContain("Por producto</h3>");
});

test("motivo de cierre usa movimiento de la sesión completa y se escapa", () => {
  const data = report();
  data.session.movements = [
    {
      id: "closing",
      type: "CLOSING",
      amountMinor: 590_000,
      affectsCash: false,
      paymentMethodCode: null,
      orderId: null,
      userId: "admin",
      reason: "Faltante <revisar>",
      createdAt: data.session.closedAt!,
    },
  ];
  data.movements = []; // A sales filter must not hide the closing reason.
  expect(cashSessionReportHtml(data, settings, {})).toContain(
    "Motivo del cierre:</strong> Faltante &lt;revisar&gt;",
  );
  data.detailAvailable = false;
  expect(cashSessionReportHtml(data, settings, {})).not.toContain(
    "Motivo del cierre:",
  );
});

test("detalle informativo lista egresos del turno completo con anulaciones", () => {
  const data = report();
  data.session.movements = [
    {
      id: "expense",
      type: "EXPENSE",
      amountMinor: 12_345,
      affectsCash: true,
      paymentMethodCode: "CASH",
      orderId: null,
      userId: "admin",
      reason: '<compra> & "urgente"',
      createdAt: "2026-10-13T00:15:00-03:00",
      reversedById: "reversal",
    },
    {
      id: "reversal",
      type: "ADJUSTMENT",
      amountMinor: -12_345,
      affectsCash: true,
      paymentMethodCode: "CASH",
      orderId: null,
      userId: "admin",
      reason: "Reversión",
      createdAt: "2026-10-13T00:20:00-03:00",
      referenceId: "expense",
    },
    {
      id: "noncash",
      type: "EXPENSE",
      amountMinor: 99_000,
      affectsCash: false,
      paymentMethodCode: "TRANSFER",
      orderId: null,
      userId: "admin",
      reason: "No efectivo",
      createdAt: "2026-10-13T00:25:00-03:00",
    },
  ];
  // Los filtros de ventas vacíos no deben reemplazar ni borrar los movimientos del turno.
  data.movements = [];
  const html = cashSessionReportHtml(data, settings, {});
  expect(html).toContain("Detalle de egresos en efectivo");
  expect(html).toContain("Gasto");
  expect(html).toContain("Ajustes de salida");
  expect(html).toContain("&lt;compra&gt; &amp; &quot;urgente&quot;");
  expect(html).toContain("13/10, 00:15");
  expect(html).not.toContain("13/10/2026, 00:15:00");
  expect(html).toContain("Anulado · Compensado en el arqueo");
  expect(html).toContain("Anulación");
  expect(html).toContain(
    "Detalle informativo; estos importes ya están incluidos en el arqueo.",
  );
  expect(html.replaceAll("\u00a0", " ")).toContain("$ 123,45");
  expect(html).not.toContain("No efectivo");
  expect(html).not.toContain("Sin egresos en efectivo registrados.");

  // Una sesión con movimientos=[] es autoritativa aunque el informe filtrado trajera datos.
  data.movements = data.session.movements;
  data.session.movements = [];
  expect(cashSessionReportHtml(data, settings, {})).toContain(
    "Sin egresos en efectivo registrados.",
  );
});

test("gastos compactos y delivery agrupado conservan importes, conceptos y anulaciones", async ({
  page,
}) => {
  const data = report();
  data.session.movements = Array.from({ length: 60 }, (_, index) => ({
    id: `delivery-${index}`,
    type: "EXPENSE" as const,
    amountMinor: 1_000,
    affectsCash: true,
    paymentMethodCode: null,
    orderId: `order-${index}`,
    userId: "admin",
    reason: `Rendición individual ${index}`,
    createdAt: "2026-10-13T00:15:00-03:00",
    ...(index === 0 ? { reversedById: "compensation" } : {}),
    ...(index === 1 ? { referenceId: "original-income" } : {}),
  }));
  data.session.movements.push(
    ...["Compra de harina", "Pago de envío sin vínculo"].map(
      (reason, index) => ({
        id: `expense-${index}`,
        type: "EXPENSE" as const,
        amountMinor: 2_000,
        affectsCash: true,
        paymentMethodCode: "CASH",
        orderId: null,
        userId: "admin",
        reason,
        createdAt: "2026-10-13T00:05:59-03:00",
      }),
    ),
  );
  data.session.cashExpenseMinor = 64_000;
  const before = structuredClone(data);
  const html = cashSessionReportHtml(data, settings, {});
  expect(data).toEqual(before);
  await page.setContent(html);
  const groups = page.locator(".outflow-group");
  await expect(groups).toHaveCount(2);
  await expect(groups.first().locator("h3")).toHaveText("Gastos");
  await expect(groups.first().locator(".outflow-item")).toHaveCount(2);
  await expect(
    groups.first().locator(".outflow-item .row").first(),
  ).toContainText("Compra de harina");
  await expect(groups.first().locator(".outflow-meta").first()).toHaveText(
    "13/10, 00:05",
  );
  const delivery = page.locator(".delivery-summary");
  await expect(delivery.locator(".row")).toHaveCount(1);
  await expect(delivery).toContainText("Total envíos y rendiciones (60)");
  await expect(delivery.locator(".row strong")).toHaveText(/\$\s*600/);
  await expect(delivery).toContainText("1 anulados · 1 anulaciones");
  await expect(delivery).toContainText(
    "Importe bruto; las compensaciones están incluidas en el arqueo.",
  );
  expect(html).not.toContain("Rendición individual");
  // No duplicated generic labels per expense, nor timestamps with seconds.
  expect(html).not.toContain(">Gasto</");
  expect(html).not.toContain("00:05:59");
  await expect(
    page.locator("body > section.sales-summary .total span"),
  ).toHaveText("Ventas totales");
});

for (const paperWidth of ["58mm", "80mm"] as const) {
  test(`muchas rendiciones no alargan ni desbordan el ticket de ${paperWidth}`, async ({
    page,
  }) => {
    const data = report();
    const profile = {
      ...settings,
      printing: {
        ...settings.printing,
        bill: { ...settings.printing.bill, paperWidth },
      },
    };
    const heights: number[] = [];
    for (const count of [2, 100]) {
      data.session.movements = Array.from({ length: count }, (_, index) => ({
        id: `delivery-${index}`,
        type: "EXPENSE",
        amountMinor: 100,
        affectsCash: true,
        paymentMethodCode: null,
        orderId: `order-${index}`,
        userId: "admin",
        reason: "Detalle innecesariamente extenso ".repeat(10),
        createdAt: "2026-10-13T00:15:00-03:00",
      }));
      data.session.cashExpenseMinor = count * 100;
      await page.setContent(cashSessionReportHtml(data, profile, {}));
      await expect(page.locator(".delivery-summary .row")).toHaveCount(1);
      const bounds = await page.locator("body").evaluate((body) => ({
        client: body.clientWidth,
        scroll: body.scrollWidth,
        height: body.scrollHeight,
      }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
      heights.push(bounds.height);
    }
    expect(heights[1]! - heights[0]!).toBeLessThanOrEqual(20);
    await page.screenshot({
      path: test.info().outputPath(`compacto-${paperWidth}.png`),
      fullPage: true,
    });
  });
}

test("histórico sin detalle no revela motivos y los resúmenes no inventan filas", () => {
  const data = report();
  data.detailAvailable = false;
  data.session.cashExpenseMinor = 500;
  data.session.movements = [
    {
      id: "old",
      type: "EXPENSE",
      amountMinor: 500,
      affectsCash: true,
      paymentMethodCode: "CASH",
      orderId: null,
      userId: "admin",
      reason: "Secreto histórico",
      createdAt: data.session.closedAt!,
    },
  ];
  const html = cashSessionReportHtml(data, settings, {});
  expect(html).toContain("Detalle de egresos no disponible.");
  expect(html).not.toContain("Secreto histórico");
  expect(html).not.toContain("Sin egresos en efectivo registrados.");

  data.detailAvailable = true;
  data.session.movements = [];
  expect(cashSessionReportHtml(data, settings, {})).toContain(
    "Detalle de egresos no disponible.",
  );
});

test("conceptos largos no desbordan el ancho del ticket de 58 ni 80 mm", async ({
  page,
}) => {
  const data = report();
  data.session.movements = [
    {
      id: "long",
      type: "REFUND",
      amountMinor: 123_456_789,
      affectsCash: true,
      paymentMethodCode: "CASH",
      orderId: null,
      userId: "admin",
      reason:
        "Concepto extenso de una devolución ".repeat(24) +
        "SinEspacios".repeat(24),
      createdAt: data.session.closedAt!,
    },
  ];
  for (const paperWidth of ["58mm", "80mm"] as const) {
    const html = cashSessionReportHtml(
      data,
      {
        ...settings,
        printing: {
          ...settings.printing,
          bill: { ...settings.printing.bill, paperWidth },
        },
      },
      {},
    );
    await page.setContent(html);
    const width = await page.locator("body").evaluate((body) => ({
      client: body.clientWidth,
      scroll: body.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    const bounds = await page.locator(".outflow-item .row").evaluate((row) => {
      const [label, amount] = [...row.children].map((child) =>
        child.getBoundingClientRect(),
      );
      return { labelRight: label.right, amountLeft: amount.left };
    });
    expect(bounds.labelRight).toBeLessThanOrEqual(bounds.amountLeft);
    await page.screenshot({
      path: test.info().outputPath(`egresos-${paperWidth}.png`),
      fullPage: true,
    });
  }
});
