import type { OrderComboComponentDto } from "@gastronomy/contracts";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

/** Bill and kitchen consume the same immutable selections, not today's catalog. */
export function comboComponentsHtml(
  components?: OrderComboComponentDto[],
): string {
  return (components ?? [])
    .map(
      (component) =>
        `<div class="detail"><strong>${escape(component.slotName)}: ${component.quantity}× ${escape(component.nameSnapshot)}</strong>${component.modifiers.map((extra) => `<span class="modifier">+ ${escape(extra.nameSnapshot)}</span>`).join("")}</div>`,
    )
    .join("");
}
