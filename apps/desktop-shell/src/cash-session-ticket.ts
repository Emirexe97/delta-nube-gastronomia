import type {
  AppSettingsDto,
  CashSessionReportDto,
  CashSessionReportPrintSections,
  CashSessionReportWaiterDto,
} from "@gastronomy/contracts";
import {
  cashClosingTotals,
  cashReportBreakdown,
  formatMoney,
} from "@gastronomy/domain";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function cashSessionReportHtml(
  report: CashSessionReportDto,
  settings: AppSettingsDto,
  sections?: CashSessionReportPrintSections,
) {
  const session = report.session;
  const profile = settings.printing.bill;
  const paperMm = profile.paperWidth === "58mm" ? 58 : 72;
  const marginMm = profile.paperWidth === "58mm" ? 2 : 1.5;
  const contentMm = paperMm - marginMm * 2;
  const fontSizePx = profile.paperWidth === "58mm" ? 12.8 : 14.1;
  const money = (value: unknown) => escapeHtml(formatMoney(Number(value) || 0));
  const date = (value: unknown) =>
    value
      ? escapeHtml(
          new Date(String(value)).toLocaleString("es-AR", {
            timeZone: "America/Buenos_Aires",
            hourCycle: "h23",
          }),
        )
      : "—";
  const filterLabels: Record<string, string> = {
    tableId: "Mesa",
    waiterUserId: "Mozo",
    productId: "Producto",
    categoryName: "Categoría",
    orderType: "Tipo de pedido",
    paymentMethodCode: "Medio de pago",
    operationalStatus: "Estado",
  };
  const filterValue = (key: string, value: unknown) => {
    if (key === "tableId")
      return report.byTable.find((row) => row.tableId === value)?.name ?? value;
    if (key === "waiterUserId")
      return (
        report.byWaiter.find((row) => row.waiterUserId === value)?.name ?? value
      );
    if (key === "productId")
      return (
        report.byProduct.find((row) => row.productId === value)?.name ?? value
      );
    if (key === "paymentMethodCode")
      return (
        report.byPaymentMethod.find((row) => row.code === value)?.name ?? value
      );
    if (key === "orderType")
      return (
        { DINE_IN: "Salón", TAKEAWAY: "Para retirar", DELIVERY: "Delivery" }[
          String(value)
        ] ?? value
      );
    if (key === "operationalStatus")
      return (
        {
          OPEN: "Abierto",
          IN_PREPARATION: "En preparación",
          READY: "Listo",
          DELIVERED: "Entregado",
          CANCELLED: "Cancelado",
        }[String(value)] ?? value
      );
    return value;
  };
  const filters = Object.entries(report.filters ?? {})
    .filter(([key, value]) => key !== "cashSessionId" && value)
    .map(
      ([key, value]) =>
        `<p class="meta-line"><strong>${escapeHtml(filterLabels[key] ?? key)}:</strong> ${escapeHtml(filterValue(key, value))}</p>`,
    )
    .join("");
  const aggregate = (
    title: string,
    rows: Array<{ name: string; amountMinor: number; quantity?: number }>,
  ) =>
    rows.length
      ? `<h3 class="section-title">${escapeHtml(title)}</h3>${rows
          .map(
            (row) =>
              `<div class="row"><span>${escapeHtml(row.name)}${
                row.quantity == null ? "" : ` ×${row.quantity}`
              }</span><strong>${money(row.amountMinor)}</strong></div>`,
          )
          .join("")}`
      : "";

  const waiterSection = (waiters: CashSessionReportWaiterDto[]) => {
    if (!waiters.length) return "";
    return `<h3 class="section-title">Por mozo</h3>${waiters
      .map((w) => {
        const tablesHtml = (w.tables ?? [])
          .map(
            (t) =>
              `<div class="row waiter-table-row"><span>${escapeHtml(t.name)}</span><span>${money(t.amountMinor)}</span></div>`,
          )
          .join("");
        return `<div class="waiter-group"><div class="row waiter-name-row"><strong>${escapeHtml(w.name)}</strong></div>${tablesHtml}<div class="row waiter-total-row"><span>Total ${escapeHtml(w.name)}:</span><strong>${money(w.amountMinor)}</strong></div></div>`;
      })
      .join("")}`;
  };

  const typeLabels: Record<string, string> = {
    DINE_IN: "Salón",
    TAKEAWAY: "Para retirar",
    DELIVERY: "Delivery",
  };

  // Secciones obligatorias que se imprimen SIEMPRE:
  // 1. Resumen
  // 2. Arqueo
  // 3. Por tipo (canales de venta)
  // 4. Por medio de pago
  const alwaysSections = `${aggregate("Por medio de pago", report.byPaymentMethod)}${aggregate(
    "Por tipo",
    report.byType.map((row) => ({
      ...row,
      name: typeLabels[row.type] ?? row.type,
    })),
  )}`;

  // Secciones opcionales seleccionables:
  const includeProduct = sections ? Boolean(sections.byProduct) : true;
  const includeCategory = sections ? Boolean(sections.byCategory) : true;
  const includeTable = sections ? Boolean(sections.byTable) : true;
  const includeWaiter = sections ? Boolean(sections.byWaiter) : true;
  const includeOrderDetails = sections ? Boolean(sections.orderDetails) : true;

  const optionalSections = report.detailAvailable
    ? `${includeProduct ? aggregate("Por producto", report.byProduct) : ""}${
        includeCategory ? aggregate("Por categoría", report.byCategory) : ""
      }${includeTable ? aggregate("Por mesa", report.byTable) : ""}${
        includeWaiter ? waiterSection(report.byWaiter) : ""
      }${
        includeOrderDetails && report.orders.length
          ? `<h3 class="section-title">Detalle de pedidos</h3>${report.orders
              .map(
                (order) =>
                  `<div class="row"><span>#${escapeHtml(
                    order.number,
                  )} · ${escapeHtml(
                    order.items[0]?.productNameSnapshot ?? order.type,
                  )}</span><strong>${money(order.totalMinor)}</strong></div>`,
              )
              .join("")}`
          : ""
      }`
    : `<div class="divider"></div><p class="notice">El detalle de este turno ya no está disponible; se muestra el resumen conservado.</p>`;

  const closing = cashClosingTotals(session);
  const closed = session.status === "CLOSED";
  const reconciled =
    closed &&
    session.countedAmountMinor != null &&
    session.differenceMinor != null;
  const closingReason =
    closed && report.detailAvailable
      ? session.movements
          ?.find((movement) => movement.type === "CLOSING")
          ?.reason?.trim()
      : null;
  const resultLabel = !reconciled
    ? "Arqueo no disponible"
    : session.differenceMinor === 0
      ? "Cuadra"
      : session.differenceMinor! < 0
        ? "Faltante"
        : "Sobrante";
  const row = (label: string, value: string, className = "") =>
    `<div class="row ${className}"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  const heading = (title: string) => `<h3 class="section-title">${title}</h3>`;
  const cashRows = cashReportBreakdown(session, closing.closingFloatAmountMinor)
    .map((item) => row(item.label, money(item.amountMinor)))
    .join("");
  const result = `<section class="closing-result">${heading("Resultado del cierre")}
    <p class="result-status">${closed ? escapeHtml(resultLabel) : "TURNO EN CURSO · PROVISORIO"}</p>
    ${row("Esperado sin cambio", money(closing.expectedAmountMinor))}
    ${
      closed
        ? `${row("Contado sin cambio", closing.countedAmountMinor == null ? "—" : money(closing.countedAmountMinor), "key-total")}
      ${row("Cambio final", money(closing.closingFloatAmountMinor))}
      ${row("Diferencia", session.differenceMinor == null ? "—" : money(session.differenceMinor), "difference")}`
        : `<p class="hint">El conteo, el cambio final y la diferencia se informan al cerrar la caja.</p>`
    }
    ${closingReason ? `<p class="hint"><strong>Motivo del cierre:</strong> ${escapeHtml(closingReason)}</p>` : ""}
    <p class="hint">${closed ? "Esperado y contado excluyen el cambio final que queda en caja." : "El esperado excluye el cambio inicial; todavía no es un cierre definitivo."}</p>
  </section>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de caja #${escapeHtml(session.number)}</title><style>
    @page{size:${paperMm}mm auto;margin:${marginMm}mm}
    *{box-sizing:border-box}body{font-family:Verdana,Arial,sans-serif;width:${contentMm}mm;margin:0;color:#000;background:#fff;font-size:${fontSizePx}px;font-weight:400;line-height:1.35;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
    h1,h2,h3,p{margin:0}.center{text-align:center}.title{font-size:18px;font-weight:900;line-height:1.15;text-transform:uppercase}.subtitle{font-size:14px;font-weight:700;margin:5px 0 3px}.terminal{font-size:12px}.state{display:inline-block;border:1px solid #000;padding:2px 6px;margin:7px 0;font-size:12px;font-weight:700;text-transform:uppercase}
    .metadata{padding:7px 0;border-top:1px solid #000}.meta-line{margin:3px 0;font-size:12px}.meta-line strong{font-weight:700}.section-title{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 5px;padding-top:7px;border-top:1px solid #000;break-after:avoid}
    .row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:8px;margin:5px 0;line-height:1.3;break-inside:avoid}.row>span:first-child{min-width:0;overflow-wrap:anywhere}.row strong,.row>span:last-child:not(:first-child){font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}.total,.key-total{font-size:${profile.paperWidth === "58mm" ? 14 : 16}px;font-weight:900;border-top:1px solid #000;padding-top:6px;margin-top:7px}.difference{border-top:1px dashed #000;padding-top:5px;font-weight:700}
    .closing-result{border:2px solid #000;padding:8px 6px;margin:6px 0 10px}.closing-result .section-title{border:0;padding:0;margin:0 0 5px}.result-status{font-size:13px;text-transform:uppercase;font-weight:900;margin-bottom:6px}.hint{font-size:12px;margin-top:6px;line-height:1.3}.divider{border-top:1px dashed #000;margin:8px 0}.notice{border:1px dashed #000;padding:6px;font-size:12px;margin:6px 0}.printed-footer{font-size:12px;margin:10px 0 4px}.waiter-group{margin:8px 0;break-inside:avoid}.waiter-name-row{font-weight:900}.waiter-table-row{padding-left:8px}.waiter-total-row{border-top:1px dashed #000;padding-top:4px}
  </style></head><body>
    <header class="center"><h1 class="title">${escapeHtml(settings.businessName)}</h1><h2 class="subtitle">INFORME DE CAJA #${escapeHtml(session.number)}</h2><p class="terminal">${escapeHtml(settings.printing.terminalLabel)}</p><p class="state">${closed ? "Cierre definitivo" : "Informe provisorio"}</p></header>
    <section class="metadata"><p class="meta-line"><strong>Día comercial:</strong> ${escapeHtml(session.businessDate)}</p><p class="meta-line"><strong>Apertura:</strong> ${date(session.openedAt)}</p><p class="meta-line"><strong>Cierre:</strong> ${closed ? date(session.closedAt) : "En curso"}</p><p class="meta-line"><strong>Responsable:</strong> ${escapeHtml(session.openedByName)}</p></section>
    ${result}
    ${filters ? `<section class="notice"><strong>Ventas filtradas</strong>${filters}<p class="hint">Los filtros sólo afectan el detalle de ventas. El arqueo corresponde al turno completo.</p></section>` : ""}
    <section>${heading("Resumen")}${row("Ventas", money(report.totals.salesMinor), "total")}${row("Pedidos", escapeHtml(report.totals.orderCount))}${row("Ticket promedio", money(report.totals.averageTicketMinor))}${row("Descuentos", money(report.totals.discountsMinor))}${row("Devoluciones", money(report.totals.refundsMinor))}<p class="hint">Ventas de todos los medios; no equivalen al efectivo disponible.</p></section>
    ${alwaysSections}
    <section>${heading("Movimientos de efectivo")}${cashRows}<p class="hint">Arqueo del turno completo. Los envíos y rendiciones se descuentan una sola vez.</p></section>
    ${optionalSections}
    <footer class="center printed-footer"><div class="divider"></div><strong>Impreso:</strong> ${escapeHtml(new Date().toLocaleString("es-AR", { timeZone: "America/Buenos_Aires", hourCycle: "h23" }))}<p>Informe interno · No fiscal</p></footer>
    <div aria-hidden="true" style="height:${Math.max(0, profile.feedLinesBeforeCut) * 3.5}mm"></div>
  </body></html>`;
}
