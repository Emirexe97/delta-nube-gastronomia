import { useEffect } from "react";

const NAVIGATION_SELECTOR = "input, select";

function isVisible(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    (element as HTMLElement).getClientRects().length > 0
  );
}

export function getTopVisibleDialog(): HTMLElement | null {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ];
  return (
    dialogs
      .filter(
        (dialog) =>
          dialog.getAttribute("aria-hidden") !== "true" && isVisible(dialog),
      )
      .at(-1) ?? null
  );
}

export function getNavigationScope(target: Element): HTMLElement | null {
  const topDialog = getTopVisibleDialog();
  if (topDialog && !topDialog.contains(target)) return null;
  return target.closest<HTMLElement>(
    'form, [role="dialog"], [data-enter-navigation]',
  );
}

export function isEligibleEnterControl(
  element: Element,
): element is HTMLInputElement | HTMLSelectElement {
  if (!(
    element instanceof HTMLInputElement || element instanceof HTMLSelectElement
  ))
    return false;
  if (element.disabled || element.tabIndex === -1 || !isVisible(element))
    return false;
  if (
    element.closest(
      '[contenteditable="true"], [data-enter-navigation="ignore"]',
    )
  )
    return false;
  if (element.closest("textarea, button")) return false;
  if (
    element instanceof HTMLInputElement &&
    [
      "button",
      "checkbox",
      "file",
      "hidden",
      "image",
      "radio",
      "reset",
      "submit",
    ].includes(element.type)
  )
    return false;
  if (
    element.getAttribute("role") === "combobox" &&
    element.getAttribute("aria-expanded") === "true"
  )
    return false;
  return true;
}

export function getEligibleControls(
  scope: HTMLElement,
): Array<HTMLInputElement | HTMLSelectElement> {
  return [
    ...scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      NAVIGATION_SELECTOR,
    ),
  ].filter(isEligibleEnterControl);
}

export function getNavigationAction(
  index: number,
  count: number,
  backwards: boolean,
): "previous" | "next" | "submit" | "none" {
  if (index < 0 || index >= count) return "none";
  if (backwards) return index > 0 ? "previous" : "none";
  return index < count - 1 ? "next" : "submit";
}

export function handleEnterNavigation(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.key !== "Enter" || event.isComposing)
    return false;
  const target = event.target;
  if (!(target instanceof Element) || !isEligibleEnterControl(target))
    return false;
  const scope = getNavigationScope(target);
  if (!scope) return false;
  const controls = getEligibleControls(scope);
  const index = controls.indexOf(
    target as HTMLInputElement | HTMLSelectElement,
  );
  if (index < 0) return false;
  const action = getNavigationAction(index, controls.length, event.shiftKey);
  if (event.shiftKey) {
    event.preventDefault();
    if (action === "previous") controls[index - 1]?.focus();
    return true;
  }
  if (action === "next") {
    event.preventDefault();
    controls[index + 1]?.focus();
    return true;
  }
  return false;
}

export function useEnterNavigation(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleEnterNavigation(event);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}
