import { describe, expect, it, vi } from "vitest";
import { initializeRenderer, resetDemoAndReload } from "../demo/startup";

describe("desktop demo startup and reset", () => {
  it("resets demo data before reloading", async () => {
    const events: string[] = [];
    const result = await resetDemoAndReload(
      async () => () => events.push("reset"),
      () => events.push("reload"),
      () => events.push("error"),
    );
    expect(result).toBe(true);
    expect(events).toEqual(["reset", "reload"]);
  });

  it("does not reload when the reset module import fails", async () => {
    const reload = vi.fn();
    const reportError = vi.fn();
    const result = await resetDemoAndReload(
      async () => { throw new Error("import failed"); },
      reload,
      reportError,
    );
    expect(result).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
  });

  it("shows a retryable startup error instead of leaving a blank window", async () => {
    const renderApp = vi.fn();
    const renderError = vi.fn();
    const result = await initializeRenderer({
      installApi: async () => { throw new Error("demo api import failed"); },
      renderApp,
      renderError,
    });
    expect(result).toBe(false);
    expect(renderApp).not.toHaveBeenCalled();
    expect(renderError).toHaveBeenCalledOnce();
  });
});
