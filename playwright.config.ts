import { defineConfig } from "@playwright/test";

// Headed execution is only for intentionally requested interactive debugging.
if (process.env.GASTRONOMY_E2E_FOREGROUND === "1") {
  delete process.env.GASTRONOMY_E2E_BACKGROUND;
} else {
  process.env.GASTRONOMY_E2E_BACKGROUND = "1";
}

export default defineConfig({
  testDir: "./tests/e2e",
  // Hidden native windows paint more slowly on Windows; keep all actionability
  // and rendering assertions, allowing a bounded budget for multi-state audits.
  timeout: process.env.GASTRONOMY_E2E_BACKGROUND === "1" ? 90_000 : 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
