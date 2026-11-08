import { launchConfiguredPos } from "./pos-fixture";
import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("la ficha protege el borrador antes de editar una variante y reinicia sus pestañas", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-product-tabs-"));
  const app = await launchConfiguredPos({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    expect(resolve(await app.evaluate(({ app }) => app.getPath("userData")))).toBe(resolve(profile));
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
    const baseName = await page.evaluate(async () => {
      const api = window.gastronomy;
      const item = (await api.bootstrap()).products.find(p => p.active && !p.parentProductId && !p.comboDefinition)!;
      await api.createProduct({
        name: "Variante de prueba", categoryId: item.categoryId, parentProductId: item.id,
        prices: item.prices, stockMinor: null,
      });
      return item.name;
    });
    await page.reload();
    await page.getByRole("link", { name: "Productos", exact: true }).click();
    await page.getByRole("button", { name: `Editar ${baseName}`, exact: true }).click();
    const base = page.getByRole("dialog", { name: `Editar · ${baseName}`, exact: true });
    await base.getByRole("tab", { name: "General", exact: true }).press("Tab");
    await expect(base.getByRole("combobox", { name: "Categoría", exact: true })).toBeFocused();
    await base.getByLabel("Nombre", { exact: true }).fill("Nombre sin guardar");
    await base.getByRole("tab", { name: "General", exact: true }).press("End");
    await expect(base.getByRole("tab", { name: "Historial" })).toBeFocused();
    await base.getByRole("tab", { name: "Historial" }).press("ArrowLeft");
    await expect(base.getByRole("tab", { name: "Variantes" })).toBeFocused();
    const editVariant = base.getByRole("button", { name: "Editar Variante de prueba" });
    const cancel = page.waitForEvent("dialog").then(async confirm => {
      expect(confirm.message()).toContain("cambios sin guardar");
      await confirm.dismiss();
    });
    await Promise.all([editVariant.click(), cancel]);
    await base.getByRole("tab", { name: "General" }).click();
    await expect(base.getByLabel("Nombre", { exact: true })).toHaveValue("Nombre sin guardar");
    await base.getByRole("tab", { name: "Variantes" }).click();
    const discard = page.waitForEvent("dialog").then(confirm => confirm.accept());
    await Promise.all([editVariant.click(), discard]);
    const variant = page.getByRole("dialog", { name: "Editar variante · Variante de prueba", exact: true });
    await expect(variant.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    await expect(variant.getByRole("tab", { name: "Variantes" })).toHaveCount(0);
    await variant.getByRole("button", { name: "Ir a producto base" }).click();
    await expect(base.getByLabel("Nombre", { exact: true })).toHaveValue(baseName);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
