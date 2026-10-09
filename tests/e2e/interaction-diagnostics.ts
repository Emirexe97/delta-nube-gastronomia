import type { ElectronApplication, Page, TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Observation only: do not prevent events, move focus, alter values or wrap APIs.
function observe() {
  const host = window as typeof window & { __interactionEvents?: unknown[] };
  if (host.__interactionEvents) return;
  const events: unknown[] = (host.__interactionEvents = []);
  for (const type of [
    "keydown",
    "keyup",
    "focusin",
    "focusout",
    "beforeinput",
    "input",
    "change",
  ]) {
    document.addEventListener(
      type,
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const field = target as HTMLInputElement;
        const entry = {
          time: performance.now(),
          type,
          tag: target.tagName,
          label: target.closest("label")?.textContent,
          key: event instanceof KeyboardEvent ? event.key : undefined,
          value: field.value,
          selectionStart: field.selectionStart,
          selectionEnd: field.selectionEnd,
          focused: document.activeElement === target,
          documentFocused: document.hasFocus(),
          defaultPrevented: event.defaultPrevented,
        };
        events.push(entry);
        if (events.length > 500) events.shift();
        queueMicrotask(() => {
          entry.defaultPrevented = event.defaultPrevented;
        });
      },
      true,
    );
  }
}

export async function installInteractionDiagnostics(page: Page) {
  await page.addInitScript(observe);
  await page.evaluate(observe);
}

export async function attachInteractionDiagnostics(
  page: Page,
  app: ElectronApplication,
  info: TestInfo,
  name: string,
) {
  if (!page || page.isClosed()) return;
  const renderer = await page.evaluate(() => ({
    events: (window as typeof window & { __interactionEvents?: unknown[] })
      .__interactionEvents,
    activeElement: document.activeElement?.outerHTML,
    documentFocused: document.hasFocus(),
    inputs: Array.from(
      document.querySelectorAll("input, select, textarea"),
    ).map((el) => ({
      html: el.outerHTML,
      value: (el as HTMLInputElement).value,
      label: el.closest("label")?.textContent,
    })),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(
      (el) => el.textContent,
    ),
  }));
  const native = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      focused: w.isFocused(),
      visible: w.isVisible(),
    })),
  );
  const path = process.env.GASTRONOMY_DIAGNOSTIC_DIR
    ? join(
        process.env.GASTRONOMY_DIAGNOSTIC_DIR,
        `${info.testId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${info.repeatEachIndex}-${name}.json`,
      )
    : info.outputPath(`${name}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      { title: info.title, status: info.status, renderer, native },
      null,
      2,
    ),
  );
  await info.attach(name, { path, contentType: "application/json" });
}
