import { launchConfiguredPos } from "./pos-fixture";
import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const profilePrefix = "gastronomy-catalog-3000-";
const prefix = "PERF3000";
const total = 3000;

test("regresión reproducible de catálogo grande, selección y alta rápida", async ({}, testInfo) => {
  let userData = "";
  let app: Awaited<ReturnType<typeof launchConfiguredPos>> | undefined;
  try {
    userData = await mkdtemp(join(tmpdir(), profilePrefix));
    app = await launchConfiguredPos({
      args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
      cwd: process.cwd(),
    });
    const page = await app.firstWindow();
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
    const fixture = await page.evaluate(
      async ({ total, prefix }) => {
        const api = window.gastronomy;
        const category = await api.createCategory({
          name: `${prefix} categoría ordenada`,
          stockControlEnabled: false,
        });
        for (let offset = 0; offset < total; offset += 500) {
          const rows = Array.from(
            { length: Math.min(500, total - offset) },
            (_, j) => {
              const n = offset + j + 1;
              return {
                code: `${prefix}-${String(n).padStart(4, "0")}`,
                name: `${prefix} producto ${String(n).padStart(4, "0")}`,
                categoryId: category.id,
                basePriceMinor: 1250,
              };
            },
          );
          await api.importProducts({
            idempotencyKey: crypto.randomUUID(),
            rows,
          });
        }
        return {
          categoryId: category.id,
          lastName: `${prefix} producto ${String(total).padStart(4, "0")}`,
          lastCode: `${prefix}-${String(total).padStart(4, "0")}`,
        };
      },
      { total, prefix },
    );
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await page.getByRole("button", { name: /Abrir caja/ }).click();
    await page.getByLabel("Cambio / fondo inicial").fill("50000");
    await page
      .getByRole("dialog", { name: "Abrir caja" })
      .getByRole("button", { name: "Abrir caja", exact: true })
      .click();
    await page.getByRole("link", { name: "Salón", exact: true }).click();
    await page.getByLabel("Número de mesa").fill("47");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page
      .getByLabel(/^Nombre de mozo/)
      .selectOption({ label: "Administrador" });
    const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
    await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
    const metrics = async () =>
      app!.evaluate(({ app: electronApp }) =>
        electronApp
          .getAppMetrics()
          .map((m) => ({
            type: m.type,
            pid: m.pid,
            privateKiB: m.memory.privateBytes,
          })),
      );
    const measure = async (name: string, action: () => Promise<void>) => {
      const before = await metrics();
      const t = performance.now();
      await action();
      return {
        name,
        elapsedMs: Math.round(performance.now() - t),
        before,
        after: await metrics(),
      };
    };
    const measures = [];
    measures.push(
      await measure("order-search-last-and-add", async () => {
        const search = editor.getByPlaceholder(/Código, nombre, categoría/);
        await search.fill(fixture.lastCode);
        const card = editor
          .locator('[id^="order-editor-product-"]')
          .filter({ hasText: fixture.lastName });
        await expect(card).toHaveCount(1);
        await card.click();
        await expect(
          editor.getByLabel(`Cantidad de ${fixture.lastName}`),
        ).toHaveValue("1");
      }),
    );
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    const catalogSearch = page.getByLabel("Buscar productos", { exact: true });
    measures.push(
      await measure("catalog-render-and-bounded-rows", async () => {
        await page
          .getByRole("link", { name: "Productos", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Catálogo, modificadores y stock",
          }),
        ).toBeVisible();
        const table = page
          .locator("table")
          .filter({
            has: page.getByLabel("Seleccionar productos visibles", {
              exact: true,
            }),
          });
        await expect(
          table.locator("tbody tr[data-virtual-row]").first(),
        ).toBeVisible();
        expect(await table.locator("tbody tr").count()).toBeLessThan(100);
      }),
    );
    measures.push(
      await measure("catalog-search-last", async () => {
        await catalogSearch.fill(fixture.lastCode);
        await expect(
          page.getByText(fixture.lastName, { exact: true }),
        ).toBeVisible();
      }),
    );
    await catalogSearch.fill("");
    measures.push(
      await measure("global-selection-kept-while-filtered", async () => {
        await page
          .getByLabel("Seleccionar productos visibles", { exact: true })
          .check();
        await catalogSearch.fill(fixture.lastCode);
        await expect(
          page.getByLabel(`Seleccionar ${fixture.lastName}`, { exact: true }),
        ).toBeChecked();
        await page.getByRole("button", { name: /^Operación masiva ·/ }).click();
        const modal = page.getByRole("dialog", { name: /Operación masiva/ });
        await expect(modal.locator("tbody tr")).toHaveCount(50);
        const firstName = await modal
          .locator("tbody tr td")
          .first()
          .innerText();
        await modal
          .getByRole("button", { name: "Siguiente", exact: true })
          .click();
        await expect(modal.locator("tbody tr td").first()).not.toHaveText(
          firstName,
        );
        await modal
          .getByRole("button", { name: "Cancelar", exact: true })
          .click();
      }),
    );
    measures.push(
      await measure("final-scroll-container", async () => {
        await catalogSearch.fill("");
        await page
          .getByLabel("Filtrar por categoría")
          .selectOption(fixture.categoryId);
        const scroll = page
          .getByLabel("Seleccionar productos visibles", { exact: true })
          .locator("xpath=ancestor::table/parent::div");
        await scroll.evaluate((node) => {
          (node as HTMLElement).scrollTop = (node as HTMLElement).scrollHeight;
        });
        await expect(
          page.getByText(fixture.lastName, { exact: true }),
        ).toBeVisible();
      }),
    );
    await writeFile(
      testInfo.outputPath("catalog-3000-performance.json"),
      JSON.stringify(
        { total, fixture, measures, generatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } finally {
    await app?.close();
    if (userData) {
      const absolute = resolve(userData);
      if (
        dirname(absolute) !== resolve(tmpdir()) ||
        !basename(absolute).startsWith(profilePrefix)
      )
        throw new Error("Unsafe disposable profile cleanup");
      await rm(absolute, { recursive: true, force: true });
    }
  }
});
