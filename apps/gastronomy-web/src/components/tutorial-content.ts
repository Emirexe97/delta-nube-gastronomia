import type { BootstrapDto, TutorialStepId } from "@gastronomy/contracts";

export const TUTORIAL_STEPS: {
  id: TutorialStepId;
  label: string;
  title: string;
}[] = [
  { id: "welcome", label: "Ubicate", title: "Tu primera venta, paso a paso" },
  { id: "preparation", label: "Prepará", title: "Antes de empezar el turno" },
  { id: "order", label: "Tomá el pedido", title: "Del producto a la comanda" },
  {
    id: "payment",
    label: "Cobrá",
    title: "Confirmá el pago, no solo el pedido",
  },
  {
    id: "finish",
    label: "Seguí adelante",
    title: "Ya conocés el recorrido esencial",
  },
];

export function tutorialCapabilities(data: BootstrapDto) {
  const can = (permission: string) =>
    data.currentUser.permissions.includes("*") ||
    data.currentUser.permissions.includes(permission);
  return {
    cash: can("cash.open"),
    closeCash: can("cash.close"),
    orders: can("orders.create"),
    settings: can("settings.manage"),
    reports: can("reports.view"),
    channels: [
      ...(data.settings.modules.diningRoom ? ["Salón"] : []),
      ...(data.settings.modules.takeaway ? ["Para llevar"] : []),
      ...(data.settings.modules.delivery ? ["Delivery"] : []),
    ],
  };
}

export function tutorialStepIndex(id: string) {
  return Math.max(
    0,
    TUTORIAL_STEPS.findIndex((step) => step.id === id),
  );
}
