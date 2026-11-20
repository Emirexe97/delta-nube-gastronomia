import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("la portada se previsualiza como borrador y solo se publica al confirmar", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(join(tmpdir(), "gastronomy-website-banner-"));
  const imagePath = join(userData, "hero.png");

  let app: ElectronApplication | undefined;
  try {
    app = await launchConfiguredPos({
      args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
      cwd: process.cwd(),
      env: {
        ...process.env,
        GASTRONOMY_WEB_PROVISION_URL: "",
        GASTRONOMY_WEB_ORDERS_URL: "",
        GASTRONOMY_WEB_ORDERS_TOKEN: "",
        GASTRONOMY_WEB_ORDERS_STORE_ID: "",
      },
    });
    const page: Page = await app.firstWindow();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#864039";
      ctx.fillRect(0, 0, 320, 128);
      return canvas.toDataURL("image/png").split(",")[1]!;
    });
    await writeFile(imagePath, Buffer.from(png, "base64"));

    // Stub only the website IPC boundary; Settings/WebSitePanel and its preview
    // stay the real renderer implementation exercised by the operator.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers as Map<
        string,
        (...args: any[]) => Promise<unknown>
      >;
      const calls: unknown[] = [];
      let failOnce = true;
      handlers.set("gastronomy:getWebSiteStatus", async () => ({
        state: "ACTIVE",
        slug: "banner-qa",
        url: "https://banner-qa.deltanubeweb.com",
        displayName: "Bonis al horno",
        tagline: "Pastas frescas, salsas lentas y cocina de casa.",
        accent: "#773311",
        designMode: "STANDARD",
        message: "Tienda web lista",
      }));
      handlers.set(
        "gastronomy:updateWebSiteBranding",
        async (_event: unknown, input: Record<string, unknown>) => {
          calls.push(structuredClone(input));
          if (failOnce) {
            failOnce = false;
            throw new Error("No se pudo publicar la portada");
          }
          return {
            state: "ACTIVE",
            slug: "banner-qa",
            url: "https://banner-qa.deltanubeweb.com",
            displayName: input.displayName,
            tagline: input.tagline,
            accent: "#773311",
            designMode: "STANDARD",
            message: "Tienda web lista",
            bannerDataUrl: input.bannerDataUrl ?? null,
          };
        },
      );
      (globalThis as any).__websiteBannerCalls = calls;
    });

    await page.getByRole("link", { name: "Configuración" }).click();
    await page.getByRole("tab", { name: "Página web", exact: true }).click();
    const panel = page.locator("#settings-website");
    await expect(panel.getByText("Activa", { exact: true })).toBeVisible();

    const imageInput = panel.getByLabel("Elegir imagen de portada");
    await imageInput.setInputFiles(imagePath);
    const preview = panel.getByLabel("Vista previa móvil");
    await expect(preview).toBeVisible();
    await expect(preview.getByText("Borrador · sin publicar")).toBeVisible();
    const hero = preview.locator("[data-storefront-cover] img");
    await expect(hero).toBeVisible();
    await expect
      .poll(() => hero.getAttribute("src"))
      .toMatch(/^data:image\/jpeg/);
    expect(
      await app.evaluate(() => (globalThis as any).__websiteBannerCalls),
    ).toEqual([]);

    // Discard resets the local draft without invoking updateWebSiteBranding.
    await panel.getByRole("button", { name: "Descartar cambios" }).click();
    await expect(preview.getByText("Borrador · sin publicar")).toHaveCount(0);
    expect(
      await app.evaluate(() => (globalThis as any).__websiteBannerCalls),
    ).toEqual([]);

    // Verify removal and replacement are also draft-only before publishing.
    await imageInput.setInputFiles(imagePath);
    await panel.getByRole("button", { name: "Quitar portada" }).click();
    await expect(preview.locator("[data-storefront-cover] img")).toHaveCount(0);
    await imageInput.setInputFiles(
      join(
        process.cwd(),
        "apps/gastronomy-portal/public/portal-assets/mesa.webp",
      ),
    );
    await expect(preview.locator("[data-storefront-cover] img")).toBeVisible();
    await preview.screenshot({
      path: testInfo.outputPath("vista-previa-pos.png"),
    });
    expect(
      await app.evaluate(() => (globalThis as any).__websiteBannerCalls),
    ).toEqual([]);

    await panel
      .getByRole("button", { name: "Publicar cambios", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "No se pudo publicar la portada",
    );
    const afterFailure = await app.evaluate(
      () => (globalThis as any).__websiteBannerCalls as unknown[],
    );
    expect(afterFailure).toHaveLength(1);
    await expect(
      panel.getByRole("button", { name: "Publicar cambios", exact: true }),
    ).toBeEnabled();

    await panel
      .getByRole("button", { name: "Publicar cambios", exact: true })
      .click();
    await expect(preview.getByText("Publicado", { exact: true })).toBeVisible();
    const calls = await app.evaluate(
      () =>
        (globalThis as any).__websiteBannerCalls as Array<
          Record<string, unknown>
        >,
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[1]?.bannerDataUrl).toMatch(/^data:image\/jpeg;base64,/);

    // Removing an already-published image is another explicit publish action.
    await panel.getByRole("button", { name: "Quitar portada" }).click();
    await expect(preview.getByText("Borrador · sin publicar")).toBeVisible();
    expect(
      (await app.evaluate(() => (globalThis as any).__websiteBannerCalls))
        .length,
    ).toBe(2);
    await panel
      .getByRole("button", { name: "Publicar cambios", exact: true })
      .click();
    await expect(preview.getByText("Publicado", { exact: true })).toBeVisible();
    const afterRemoval = await app.evaluate(
      () =>
        (globalThis as any).__websiteBannerCalls as Array<
          Record<string, unknown>
        >,
    );
    expect(afterRemoval).toHaveLength(3);
    expect(afterRemoval[2]?.bannerDataUrl).toBeNull();
  } finally {
    await app?.close();
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 150,
    });
  }
});
