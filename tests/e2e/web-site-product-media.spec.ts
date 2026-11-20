import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const status = {
  state: "ACTIVE",
  slug: "media-qa",
  url: "https://media-qa.deltanubeweb.com",
  displayName: "Media QA",
  tagline: "Carta para pruebas",
  accent: "#773311",
  designMode: "STANDARD",
  message: "Tienda web lista",
  bannerDataUrl: null,
  logoDataUrl: null,
};

test("logo y foto de producto se editan en borrador y solo publican al confirmar", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const userData = await mkdtemp(join(tmpdir(), "gastronomy-site-media-"));
  const logoPath = join(userData, "logo.png");
  const productPhotoPath = join(userData, "product.png");
  const replacementPath = join(userData, "replacement.png");
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
    const fixtures = await page.evaluate(() => {
      const image = (width: number, height: number, color: string, type: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No se pudo crear canvas para fixtures E2E");
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
        const dataUrl = canvas.toDataURL(type);
        if (!dataUrl.startsWith(`data:${type};base64,`)) throw new Error(`Canvas no generó ${type}`);
        return dataUrl;
      };
      return {
        pos: image(320, 128, "#dc6420", "image/webp"),
        logo: image(128, 128, "#1f6f50", "image/png"),
        product: image(320, 128, "#dc6420", "image/png"),
        replacement: image(320, 128, "#3c50d2", "image/png"),
      };
    });
    const writeImage = (path: string, dataUrl: string) =>
      writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    await Promise.all([
      writeImage(logoPath, fixtures.logo),
      writeImage(productPhotoPath, fixtures.product),
      writeImage(replacementPath, fixtures.replacement),
    ]);
    const posImageDataUrl = fixtures.pos;
    const { withPhoto, withoutPhoto } = await page.evaluate(async (imageDataUrl) => {
      const api = window.gastronomy;
      const data = await api.bootstrap();
      const category = data.categories.find((item) => item.active);
      if (!category) throw new Error("Fixture POS sin categoría activa");
      const prices = [
        { priceListCode: "SALON" as const, amountMinor: 12500 },
        { priceListCode: "TAKEAWAY" as const, amountMinor: 14500 },
        { priceListCode: "DELIVERY" as const, amountMinor: 16000 },
      ];
      const withPhoto = await api.createProduct({
        categoryId: category.id,
        name: "Producto Media QA con foto POS",
        code: "MEDIA-POS-QA",
        imageDataUrl,
        prices,
      });
      const withoutPhoto = await api.createProduct({
        categoryId: category.id,
        name: "Producto Media QA sin foto",
        code: "MEDIA-NO-PHOTO-QA",
        prices,
      });
      return { withPhoto, withoutPhoto };
    }, posImageDataUrl);
    const storedPosPhoto = await page.evaluate(
      (productId) => window.gastronomy.getProductImage({ productId }),
      withPhoto.id,
    );
    if (!storedPosPhoto) throw new Error("No se persistió la foto del producto QA en el POS");

    // Website reads and update are mocked at IPC; the catalog and POS product
    // image remain real data in the disposable profile.
    await app.evaluate(({ ipcMain }, fixture) => {
      const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => Promise<unknown>>;
      const calls: Array<Record<string, unknown>> = [];
      const photoReads: string[] = [];
      const previewCalls: unknown[] = [];
      const publishedPhotos = new Map<string, string | null>();
      let site = structuredClone(fixture.initialStatus);
      let failOnce = true;
      handlers.set("gastronomy:getWebSiteStatus", async () => structuredClone(site));
      handlers.set("gastronomy:getWebProductPhoto", async (_event: unknown, input: { productRef: string }) => {
        photoReads.push(input.productRef);
        return { productRef: input.productRef, dataUrl: publishedPhotos.get(input.productRef) ?? null };
      });
      handlers.set("gastronomy:updateWebSiteBranding", async (_event: unknown, input: Record<string, unknown>) => {
        calls.push(structuredClone(input));
        if (failOnce) {
          failOnce = false;
          throw new Error("No se pudo publicar la marca");
        }
        if (Object.hasOwn(input, "logoDataUrl")) site.logoDataUrl = input.logoDataUrl as string | null;
        if (input.productPhoto && typeof input.productPhoto === "object") {
          const photo = input.productPhoto as { productRef: string; dataUrl: string | null };
          publishedPhotos.set(photo.productRef, photo.dataUrl);
        }
        return structuredClone(site);
      });
      handlers.set("gastronomy:createWebSitePreview", async (_event: unknown, input: unknown) => {
        previewCalls.push(structuredClone(input));
        return {
          url: "https://media-qa.deltanubeweb.com/vista-previa#qa-private-token",
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          qrDataUrl: fixture.qrDataUrl,
        };
      });
      (globalThis as any).__siteMediaCalls = { calls, photoReads, previewCalls };
    }, { initialStatus: status, qrDataUrl: fixtures.logo });
    await page.reload();
    await page.getByRole("link", { name: "Productos", exact: true }).click();
    await expect(page.getByText("Producto Media QA con foto POS", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Configuración" }).click();
    await page.getByRole("tab", { name: "Página web", exact: true }).click();
    const panel = page.locator("#settings-website");
    const preview = panel.getByLabel("Vista previa móvil");
    await expect(panel.getByText("Activa", { exact: true })).toBeVisible();

    const calls = () => app!.evaluate(() => (globalThis as any).__siteMediaCalls as {
      calls: Array<Record<string, unknown>>;
      photoReads: string[];
      previewCalls: unknown[];
    });

    await panel.getByLabel("Elegir logo del negocio").setInputFiles(logoPath);
    await expect(panel.getByAltText("Vista previa del logo")).toBeVisible();
    await panel.getByLabel("Buscar producto").fill("Producto Media QA con foto POS");
    await panel.getByRole("button", { name: /Producto Media QA con foto POS/ }).click();
    await expect(panel.getByRole("button", { name: "Usar foto del POS" })).toBeVisible();
    await panel.getByRole("button", { name: "Usar foto del POS" }).click();
    await expect(preview.locator(".dn-cover__logo")).toBeVisible();
    await expect(preview.locator(".dn-product__photo")).toBeVisible();
    const posPhotoSrc = await preview.locator(".dn-product__photo").getAttribute("src");
    const firstLogoSrc = await preview.locator(".dn-cover__logo").getAttribute("src");
    expect((await calls()).photoReads).toContain(withPhoto.id);
    expect((await calls()).calls).toEqual([]);
    expect((await calls()).previewCalls).toEqual([]);

    // Changing product with an uncommitted POS photo is cancellable; then replace
    // and remove both brand assets to prove draft operations never publish.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await panel.getByLabel("Buscar producto").fill("Producto Media QA sin foto");
    await panel.getByRole("button", { name: /Producto Media QA sin foto/ }).click();
    await expect(panel.getByLabel("Foto de producto").getByText("Producto Media QA con foto POS", { exact: true })).toBeVisible();
    await panel.getByLabel("Elegir logo del negocio").setInputFiles(replacementPath);
    await panel.getByLabel("Elegir foto del producto").setInputFiles(replacementPath);
    await expect(preview.locator(".dn-product__photo")).toBeVisible();
    await expect.poll(() => preview.locator(".dn-product__photo").getAttribute("src")).not.toBe(posPhotoSrc);
    await expect.poll(() => preview.locator(".dn-cover__logo").getAttribute("src")).not.toBe(firstLogoSrc);
    await panel.getByLabel("Descripción breve").fill("Cambio temporal para descartar");
    await panel.getByRole("button", { name: "Quitar logo" }).click();
    await panel.getByRole("button", { name: "Quitar foto del producto" }).click();
    await expect(preview.locator(".dn-cover__logo")).toHaveCount(0);
    await expect(preview.locator(".dn-product__photo")).toHaveCount(0);
    expect((await calls()).calls).toEqual([]);

    // Canceling edits restores the POS photo source and does not publish. Select
    // a product without an image to cover the empty-photo path too.
    await panel.getByRole("button", { name: "Descartar cambios" }).click();
    await panel.getByLabel("Buscar producto").fill("Producto Media QA sin foto");
    await panel.getByRole("button", { name: /Producto Media QA sin foto/ }).click();
    await expect(panel.getByText(/No hay foto seleccionada para la carta web/)).toBeVisible();
    await expect(preview.locator(".dn-product__photo")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Usar foto del POS" })).toHaveCount(0);
    await panel.getByLabel("Buscar producto").fill("Producto Media QA con foto POS");
    await panel.getByRole("button", { name: /Producto Media QA con foto POS/ }).click();
    await panel.getByRole("button", { name: "Usar foto del POS" }).click();
    await panel.getByLabel("Elegir logo del negocio").setInputFiles(logoPath);
    await panel.getByLabel("Elegir foto del producto").setInputFiles(productPhotoPath);
    await expect.poll(() => preview.locator(".dn-product__photo").getAttribute("src")).not.toBe(posPhotoSrc);
    await panel.getByLabel("Elegir foto del producto").setInputFiles(replacementPath);
    await expect(preview.locator(".dn-cover__logo")).toBeVisible();
    await expect(preview.locator(".dn-product__photo")).toBeVisible();
    const finalProductPhotoSrc = await preview.locator(".dn-product__photo").getAttribute("src");

    // The private QR is generated only on an explicit action, never by loading
    // or editing the preview. Capture the actual combined panel preview for QA.
    await expect(panel.getByRole("button", { name: "Ver en mi celular" })).toBeVisible();
    expect((await calls()).previewCalls).toEqual([]);
    const phoneFrame = preview.locator("div.mx-auto").first();
    await page.evaluate(() => {
      const previewElement = document.querySelector('[aria-label="Vista previa móvil"]');
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        if (previewElement?.contains(element)) continue;
        const position = getComputedStyle(element).position;
        if (position === "fixed" || position === "sticky")
          element.style.setProperty("visibility", "hidden", "important");
      }
    });
    await phoneFrame.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      window.scrollBy(0, top - 32);
    });
    await phoneFrame.screenshot({ path: testInfo.outputPath("web-site-product-media-preview.png") });
    await preview.getByRole("button", { name: "Ver en mi celular" }).click();
    await expect(preview.getByAltText("Código QR de vista previa privada")).toBeVisible();
    await expect(preview.getByLabel("Enlace privado de vista previa")).toHaveValue(/media-qa\.deltanubeweb\.com\/vista-previa#/);
    await expect(preview.getByText(/Vence en 10 minutos y no permite hacer pedidos/)).toBeVisible();
    expect((await calls()).previewCalls).toHaveLength(1);
    expect((await calls()).calls).toEqual([]);

    await panel.getByRole("button", { name: "Publicar cambios", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("No se pudo publicar la marca");
    expect((await calls()).calls).toHaveLength(1);
    await panel.getByRole("button", { name: "Publicar cambios", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Cambios publicados correctamente.");
    const publishedCalls = (await calls()).calls;
    expect(publishedCalls).toHaveLength(2);
    expect(publishedCalls[0]).toEqual(publishedCalls[1]);
    expect(publishedCalls[1]?.logoDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(publishedCalls[1]?.productPhoto).toEqual({ productRef: withPhoto.id, dataUrl: finalProductPhotoSrc });
    const unchangedPosPhoto = await page.evaluate(
      (productId) => window.gastronomy.getProductImage({ productId }),
      withPhoto.id,
    );
    expect(unchangedPosPhoto).toBe(storedPosPhoto);
    expect(withoutPhoto.id).toBeTruthy();
  } finally {
    await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => {});
    await app?.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
