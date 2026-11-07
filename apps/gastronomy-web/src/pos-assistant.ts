import { POS_AI_INTENTS } from "@gastronomy/licensing/pos-ai-intents";
import type {
  BootstrapDto,
  CashSessionReportDto,
  DetailedReportDto,
  ReportFilters,
  CashSessionReportFilters,
} from "@gastronomy/contracts";
import type { Permission } from "@gastronomy/domain";
import { countPendingCashOrders, formatMoney, localDateValue } from "./lib";

export type PosAssistantCategory = "caja" | "ventas" | "operacion" | "guia";
export interface PosAssistantQuestion {
  id: string;
  category: PosAssistantCategory;
  question: string;
  permission?: Permission;
}

export const POS_ASSISTANT_QUESTIONS: readonly PosAssistantQuestion[] = POS_AI_INTENTS;

export interface PosAssistantContext {
  data: BootstrapDto;
  getDetailedReport?: (filters: ReportFilters) => Promise<DetailedReportDto>;
  getCashSessionReport?: (
    filters: CashSessionReportFilters,
  ) => Promise<CashSessionReportDto>;
}
export interface PosAssistantAnswer {
  answer: string;
  questionId: string | null;
  source:
    "local" | "dashboard" | "report" | "guide" | "permission" | "not_found";
}

const result = (
  answer: string,
  questionId: string | null,
  source: PosAssistantAnswer["source"],
): PosAssistantAnswer => ({ answer, questionId, source });
export const canAskPosQuestion = (
  permissions: readonly string[],
  question: PosAssistantQuestion,
) =>
  !question.permission ||
  permissions.includes("*") ||
  permissions.includes(question.permission);
const dateOffset = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateValue(value);
};
const dayLabel = (iso: string) => iso.split("-").reverse().join("/");
const orderLabel = (count: number) => `${count} ${count === 1 ? "pedido" : "pedidos"}`;

export async function answerPosQuestion(
  questionId: string,
  context: PosAssistantContext,
): Promise<PosAssistantAnswer> {
  const question = POS_ASSISTANT_QUESTIONS.find(
    (item) => item.id === questionId,
  );
  if (!question)
    return result(
      "No reconocí esa consulta. Probá con una de las preguntas sugeridas.",
      null,
      "not_found",
    );
  const { data } = context;
  if (!canAskPosQuestion(data.currentUser.permissions, question)) {
    return result(
      `No tenés permiso para esta consulta (${question.permission}).`,
      question.id,
      "permission",
    );
  }
  const session = data.cashSession;
  const today = session?.businessDate ?? localDateValue();

  if (question.id === "cash-status") {
    return result(
      session
        ? `La caja #${session.number} está ${session.status === "OPEN" ? "abierta" : "cerrada"} (día comercial ${dayLabel(session.businessDate)}).`
        : "No hay una caja abierta actualmente.",
      question.id,
      "dashboard",
    );
  }
  if (question.id === "ops-pending") {
    const count = countPendingCashOrders(data.orders, session?.id);
    return result(
      session
        ? `Hay ${orderLabel(count)} ${count === 1 ? "abierto" : "abiertos"} en la caja actual.`
        : "No hay una caja abierta actualmente.",
      question.id,
      "local",
    );
  }
  if (question.id === "guide-close") {
    return result(
      "En Caja, contá todo el efectivo, incluido el cambio que vas a dejar. Ingresá el total contado y el cambio final. Si hay una diferencia, indicá el motivo. Revisá el resumen y elegí «Confirmar cierre definitivo». Si el sistema solicita autorización, necesitás el PIN.",
      question.id,
      "guide",
    );
  }
  if (question.id === "guide-refund") {
    return result(
      "En Pedidos, abrí la edición del pedido y revisá «Pagos registrados». Elegí «Devolver pago», seleccioná el pago y cargá el motivo y el PIN de autorización; luego confirmá «Confirmar devolución». El asistente solo explica el proceso y no registra devoluciones.",
      question.id,
      "guide",
    );
  }

  if (question.id === "cash-sales") {
    if (!session)
      return result(
        "No hay una caja actual para consultar.",
        question.id,
        "report",
      );
    const inlineSales = session.salesTotalMinor;
    if (inlineSales !== undefined) {
      return result(
        `La caja #${session.number} registra ${formatMoney(inlineSales)} en ventas.`,
        question.id,
        "report",
      );
    }
    if (!context.getCashSessionReport)
      return result(
        "El informe de caja no está disponible en este momento.",
        question.id,
        "report",
      );
    const report = await context.getCashSessionReport({
      cashSessionId: session.id,
    });
    return result(
      `La caja #${session.number} registra ${formatMoney(report.totals.salesMinor)} en ventas.`,
      question.id,
      "report",
    );
  }
  if (!context.getDetailedReport)
    return result(
      "El informe no está disponible en este momento.",
      question.id,
      "report",
    );
  const filters =
    question.id === "sales-products"
      ? { dateFrom: dateOffset(today, -6), dateTo: today }
      : { dateFrom: today, dateTo: today };
  const report = await context.getDetailedReport(filters);
  if (question.id === "cash-difference") {
    const closed = report.cash.sessions.filter(
      (item) => item.status === "CLOSED",
    );
    return result(
      closed.length
        ? closed
            .map((item) => {
              if (item.differenceMinor == null)
                return `Caja #${item.number} (${dayLabel(item.businessDate)}): sin diferencia informada`;
              if (item.differenceMinor < 0)
                return `Caja #${item.number} (${dayLabel(item.businessDate)}): faltante de ${formatMoney(Math.abs(item.differenceMinor))}`;
              if (item.differenceMinor > 0)
                return `Caja #${item.number} (${dayLabel(item.businessDate)}): sobrante de ${formatMoney(item.differenceMinor)}`;
              return `Caja #${item.number} (${dayLabel(item.businessDate)}): sin diferencia`;
            })
            .join(" · ")
        : `No hay cajas cerradas el ${dayLabel(today)}.`,
      question.id,
      "report",
    );
  }
  if (question.id === "sales-today") {
    return result(
      `Día comercial ${dayLabel(today)}: ${formatMoney(report.salesTotalMinor)} en ${orderLabel(report.orderCount)}.`,
      question.id,
      "report",
    );
  }
  if (question.id === "sales-ticket") {
    return result(
      `El ticket promedio del ${dayLabel(today)} es ${formatMoney(report.averageTicketMinor)} (sobre ${orderLabel(report.orderCount)}).`,
      question.id,
      "report",
    );
  }
  if (question.id === "sales-payment") {
    return result(
      report.byPaymentMethod.length
        ? report.byPaymentMethod
            .map((item) => `${item.name}: ${formatMoney(item.amountMinor)}`)
            .join(" · ")
        : `No hay ventas por medio de pago el ${dayLabel(today)}.`,
      question.id,
      "report",
    );
  }
  const products = [...report.byProduct].sort(
    (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "es"),
  );
  return result(
    products.length
      ? `Productos más vendidos (${dayLabel(filters.dateFrom)} a ${dayLabel(filters.dateTo)}): ${products
          .slice(0, 5)
          .map((item) => `${item.name}: ${item.quantity.toLocaleString("es-AR")} ${item.quantity === 1 ? "unidad" : "unidades"}`)
          .join(" · ")}`
      : `No hay productos vendidos entre ${dayLabel(filters.dateFrom)} y ${dayLabel(filters.dateTo)}.`,
    question.id,
    "report",
  );
}
