/** Shared data only; safe to import in the offline renderer. */
export const POS_AI_INTENTS = [
  {
    id: "cash-status",
    category: "caja",
    question: "¿Cómo está la caja actual?",
  },
  {
    id: "cash-sales",
    category: "caja",
    question: "¿Cuánto vendimos en esta caja?",
    permission: "reports.view",
  },
  {
    id: "cash-difference",
    category: "caja",
    question: "¿Cómo fue el cierre de las cajas de hoy?",
    permission: "reports.view",
  },
  {
    id: "sales-today",
    category: "ventas",
    question: "¿Cuánto vendimos hoy?",
    permission: "reports.view",
  },
  {
    id: "sales-ticket",
    category: "ventas",
    question: "¿Cuál es el ticket promedio de hoy?",
    permission: "reports.view",
  },
  {
    id: "sales-payment",
    category: "ventas",
    question: "¿Cuánto se vendió por medio de pago hoy?",
    permission: "reports.view",
  },
  {
    id: "sales-products",
    category: "ventas",
    question:
      "¿Cuáles fueron los productos más vendidos en los últimos 7 días?",
    permission: "reports.view",
  },
  {
    id: "ops-pending",
    category: "operacion",
    question: "¿Cuántos pedidos siguen abiertos en esta caja?",
  },
  {
    id: "guide-close",
    category: "guia",
    question: "¿Cómo cierro la caja?",
    permission: "cash.close",
  },
  {
    id: "guide-refund",
    category: "guia",
    question: "¿Cómo registro una devolución?",
    permission: "payments.refund",
  },
] as const;
