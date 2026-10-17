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

test("ticket jerarquiza arqueo y separa ventas, medios y movimientos", () => {
  const html = cashSessionReportHtml(report(), settings, {});
  const sequence = [
    "Resultado del cierre",
    "Resumen",
    "Por medio de pago",
    "Por tipo",
    "Movimientos de efectivo",
  ];
  const indexes = sequence.map((title) => html.indexOf(`>${title}</h3>`));
  expect(indexes.every((index) => index >= 0)).toBe(true);
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  for (const text of [
    "Cierre definitivo",
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
    "Cierre definitivo",
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
  expect(html).toContain("Ajuste de salida");
  expect(html).toContain("&lt;compra&gt; &amp; &quot;urgente&quot;");
  expect(html).toContain("13/10/2026, 00:15:00");
  expect(html).toContain("Anulado · Compensado en el arqueo");
  expect(html).toContain("Anulación");
  expect(html).toContain("Detalle informativo; estos importes ya están incluidos en el arqueo.");
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
  expect(cashSessionReportHtml(data, settings, {})).toContain("Detalle de egresos no disponible.");
});

test("conceptos largos no desbordan el ancho del ticket de 58 ni 80 mm", async ({ page }) => {
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
      reason: "Concepto extenso de una devolución ".repeat(24) + "SinEspacios".repeat(24),
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
      const [label, amount] = [...row.children].map(child => child.getBoundingClientRect());
      return { labelRight: label.right, amountLeft: amount.left };
    });
    expect(bounds.labelRight).toBeLessThanOrEqual(bounds.amountLeft);
    await page.screenshot({ path: test.info().outputPath(`egresos-${paperWidth}.png`), fullPage: true });
  }
});
