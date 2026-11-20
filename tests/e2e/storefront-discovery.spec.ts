import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://storefront.local.test";
const photoPath = resolve(
  "apps/gastronomy-portal/public/portal-assets/mesa.webp",
);
const catalog = {
  products: [
    {
      productRef: "tagliatelle-ragu",
      name: "Tagliatelle al ragú",
      category: "Especiales",
      takeawayPriceMinor: 850000,
      deliveryPriceMinor: 990000,
    },
    {
      productRef: "noquis-casa",
      name: "Ñoquis de la casa",
      category: "Pastas",
      takeawayPriceMinor: 720000,
      deliveryPriceMinor: 840000,
    },
    {
      productRef: "ensalada-verde",
      name: "Ensalada verde",
      category: "Ensaladas",
      takeawayPriceMinor: 500000,
      deliveryPriceMinor: 600000,
    },
  ],
};
const nineCategoryCatalog = {
  products: [
    ...catalog.products,
    {
      productRef: "sopas",
      name: "Sopa del día",
      category: "Sopas",
      takeawayPriceMinor: 400000,
      deliveryPriceMinor: 450000,
    },
    {
      productRef: "postres",
      name: "Postre casero",
      category: "Postres",
      takeawayPriceMinor: 350000,
      deliveryPriceMinor: 390000,
    },
    {
      productRef: "bebidas",
      name: "Limonada",
      category: "Bebidas",
      takeawayPriceMinor: 250000,
      deliveryPriceMinor: 300000,
    },
    {
      productRef: "cafes",
      name: "Café de especialidad",
      category: "Cafetería",
      takeawayPriceMinor: 280000,
      deliveryPriceMinor: 320000,
    },
    {
      productRef: "sandwiches",
      name: "Sándwich de la casa",
      category: "Sándwiches",
      takeawayPriceMinor: 620000,
      deliveryPriceMinor: 700000,
    },
    {
      productRef: "brunch",
      name: "Brunch de temporada",
      category: "Brunch",
      takeawayPriceMinor: 900000,
      deliveryPriceMinor: 1000000,
    },
  ],
};

async function openCarta(
  page: Page,
  branding = true,
  fixture = catalog,
  displayName = branding ? "Bonis" : "Casa Oliva",
) {
  const { renderTenantStorefront } =
    await import("../../apps/orders-service/dist/storefront-page.js");
  const html = renderTenantStorefront(
    {
      display_name: displayName,
      tagline: "Hecho al momento, sin vueltas.",
      accent: "#1f6f50",
      design_mode: "STANDARD",
      template_key: null,
      has_banner: branding,
      has_logo: branding,
    },
    true,
  );
  const image = await readFile(photoPath);
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== "GET")
      return route.abort();
    if (url.pathname === "/")
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    if (url.pathname === "/api/catalog")
      return route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          published: true,
          snapshot: fixture,
          productPhotos: [
            { productRef: "tagliatelle-ragu", version: "a".repeat(64) },
          ],
        }),
      });
    if (url.pathname === "/media/logo.jpg")
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="128" fill="#1f6f50"/><text x="128" y="160" text-anchor="middle" font-family="Georgia" font-size="120" fill="white">B</text></svg>`,
      });
    if (
      url.pathname === "/media/banner.jpg" ||
      url.pathname.startsWith("/media/products/")
    )
      return route.fulfill({
        status: 200,
        contentType: "image/webp",
        body: image,
      });
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(displayName);
  await expect(
    page.locator("#menu").getByText("Tagliatelle al ragú"),
  ).toBeVisible();
}

test.describe("carta pública editorial", () => {
  test("mantiene navegación y filtros en móvil estrecho (320px)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openCarta(page);
    const search = page.locator("#catalogSearch");
    await search.fill("pastas");
    await expect(
      page.locator("#menu").getByText("Ñoquis de la casa"),
    ).toBeVisible();
    await expect(
      page.locator("#menu").getByText("Tagliatelle al ragú"),
    ).toBeHidden();
    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(search).toBeFocused();
    await expect(page.getByRole("button", { name: "Todos" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("expone novena categoría y conserva filtros, búsqueda y foco al cambiar canal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCarta(page, true, nineCategoryCatalog);
    await expect(page.locator("#categoryJump")).toBeVisible();
    await page.locator("#categoryJump").selectOption("category-8");
    await expect(page.locator("#menu").getByText("Sopa del día")).toBeVisible();
    const search = page.locator("#catalogSearch");
    await search.fill("sopa");
    await expect(page.locator("#menu").getByText("Sopa del día")).toBeVisible();
    const channel = page.getByLabel("¿Cómo lo recibís?");
    await channel.focus();
    await channel.selectOption("DELIVERY");
    await expect(page.locator("#categoryJump")).toHaveValue("category-8");
    await expect(search).toHaveValue("sopa");
    await expect(channel).toBeFocused();
    await page.getByRole("button", { name: "Todos" }).click();
    await expect(page.locator("#categoryJump")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Todos" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  for (const width of [320, 390]) {
    test(`no desborda el viewport móvil (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await openCarta(
        page,
        false,
        catalog,
        "Casa Oliva · Cocina de estación y pastas artesanales para compartir",
      );
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      const add = page.getByRole("button", {
        name: "Agregar Tagliatelle al ragú",
      });
      await add.scrollIntoViewIfNeeded();
      await expect(add).toBeInViewport({ ratio: 1 });
    });
  }

  test("el acceso móvil muestra cantidad y total y lleva al pedido", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCarta(page, true, nineCategoryCatalog);
    const jump = page.locator("#cartJump");
    await expect(jump).toBeHidden();
    const add = page.getByRole("button", {
      name: "Agregar Tagliatelle al ragú",
    });
    await add.click();
    await add.click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(jump).toBeInViewport({ ratio: 1 });
    await expect(jump).toContainText("Ver mi pedido · 2");
    await expect(jump).toContainText("17.000");
    await jump.click();
    await expect(page.locator("#cartTitle")).toBeInViewport();
    await expect(page.locator("#cartTitle")).toBeFocused();
  });

  test("busca sin tildes, combina categoría, limpia y conserva carrito/precio", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCarta(page);
    const search = page.locator("#catalogSearch");
    await search.fill("noquis");
    await expect(page.getByText("Ñoquis de la casa")).toBeVisible();
    await expect(
      page.locator("#menu").getByText("Tagliatelle al ragú"),
    ).toBeHidden();
    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(search).toBeFocused();
    await page.getByRole("button", { name: "Especiales" }).click();
    await search.fill("ragu");
    await expect(
      page.locator("#menu").getByText("Tagliatelle al ragú"),
    ).toBeVisible();
    await expect(
      page.locator("#menu").getByText("Ñoquis de la casa"),
    ).toBeHidden();
    await page
      .getByRole("button", { name: "Agregar Tagliatelle al ragú" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Tu pedido" }),
    ).toBeVisible();
    await expect(page.locator("#total")).toContainText("8.500");
    await page.getByLabel("¿Cómo lo recibís?").selectOption("DELIVERY");
    await expect(page.getByLabel("Dirección de entrega")).toBeVisible();
    await expect(page.locator("#total")).toContainText("9.900");
    await search.fill("zzzz-no-existe");
    await expect(
      page.getByText("No encontramos opciones con esos filtros."),
    ).toBeVisible();
    await expect(
      page.locator("#menu").getByText("Tagliatelle al ragú"),
    ).toBeHidden();
    await expect(page.locator(".cart-title")).toHaveText("Tagliatelle al ragú");
    await expect(page.locator("#total")).toContainText("9.900");
    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(search).toBeFocused();
    await expect(
      page.locator("#menu").getByText("Tagliatelle al ragú"),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("carta-editorial-movil.png"),
      fullPage: true,
    });
  });

  test("renderiza portada con banner/logo y carta de texto sin branding", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCarta(page, true);
    await expect(page.locator('img[src="/media/banner.jpg"]')).toHaveCount(1);
    await expect(page.locator('img[src="/media/logo.jpg"]')).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath("carta-editorial-escritorio.png"),
      fullPage: true,
    });

    await page.unroute("**/*");
    await openCarta(
      page,
      false,
      catalog,
      "Casa Oliva · Cocina de estación y pastas artesanales para compartir",
    );
    await expect(page.locator('img[src="/media/banner.jpg"]')).toHaveCount(0);
    await expect(page.locator('img[src="/media/logo.jpg"]')).toHaveCount(0);
    await expect(page.locator(".dn-product--text-only")).toHaveCount(2);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(1440);
    const add = page.getByRole("button", {
      name: "Agregar Tagliatelle al ragú",
    });
    const box = await add.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  });
});
