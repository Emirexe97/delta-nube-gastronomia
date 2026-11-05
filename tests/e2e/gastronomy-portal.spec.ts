import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

// Exercise the static files in a real browser without contacting public DNS or
// the license authority. Actual edge fall-through is covered by edge.test.mjs.
const origin = "https://gastronomia.example.test";
const files: Record<string, string> = {
  "/": "index.html",
  "/ayuda/": "ayuda/index.html",
  "/carta-de-ejemplo/": "carta-de-ejemplo/index.html",
  "/portal-assets/site.css": "portal-assets/site.css",
  "/portal-assets/simbolo.png": "portal-assets/simbolo.png",
  "/portal-assets/marca.png": "portal-assets/marca.png",
  "/portal-assets/mesa.webp": "portal-assets/mesa.webp",
  "/portal-assets/inter-latin-variable.woff2":
    "portal-assets/inter-latin-variable.woff2",
};
const contentType = (file: string) =>
  file.endsWith(".css")
    ? "text/css"
    : file.endsWith(".png")
      ? "image/png"
      : file.endsWith(".webp")
        ? "image/webp"
        : file.endsWith(".woff2")
          ? "font/woff2"
          : "text/html";
for (const width of [320, 375, 1280]) {
  test(`portada, carta ilustrativa y ayuda sin registro (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    const unexpected: string[] = [];
    await page.context().route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        file = files[url.pathname];
      if (!file || url.origin !== origin || req.method() !== "GET") {
        unexpected.push(req.method() + " " + req.url());
        return route.abort();
      }
      await route.fulfill({
        contentType:
          contentType(file) +
          (file.endsWith(".html") || file.endsWith(".css")
            ? "; charset=utf-8"
            : ""),
        body: await readFile(resolve("apps/gastronomy-portal/public", file)),
      });
    });
    const fits = async () =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    await page.goto(origin);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Una carta online. Menos vueltas.",
    );
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      "/portal-assets/simbolo.png",
    );
    const symbol = page.locator('.brand img[src="/portal-assets/simbolo.png"]');
    const wordmark = page.locator('.brand img[src="/portal-assets/marca.png"]');
    await expect(symbol).toHaveCount(1);
    await expect(wordmark).toHaveCount(1);
    await expect(
      page.locator('.brand img[src$=".jpg"], .brand img[src$=".jpeg"]'),
    ).toHaveCount(0);
    for (const image of [symbol, wordmark]) {
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    await expect
      .poll(() => page.evaluate(() => document.fonts.check("16px Inter")))
      .toBe(true);
    const alignment = await page.evaluate(() => {
      const mark = document
        .querySelector('.brand img[src="/portal-assets/simbolo.png"]')!
        .getBoundingClientRect();
      const logo = document
        .querySelector('.brand img[src="/portal-assets/marca.png"]')!
        .getBoundingClientRect();
      return {
        markRight: mark.right,
        logoLeft: logo.left,
        centers: Math.abs(
          (mark.top + mark.bottom) / 2 - (logo.top + logo.bottom) / 2,
        ),
      };
    });
    expect(alignment.markRight).toBeLessThanOrEqual(alignment.logoLeft);
    expect(alignment.centers).toBeLessThanOrEqual(2);
    const hero = page.locator('img[src="/portal-assets/mesa.webp"]');
    await expect(hero).toHaveCount(1);
    await expect
      .poll(() =>
        hero.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Delta Nube Gastronomía, inicio" }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /mesa/i })).toBeVisible();
    await fits();
    if (width === 1280)
      await testInfo.attach("portada", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    await page.getByRole("link", { name: /Conocer la demo/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "La Esquina Verde",
    );
    await expect(page.getByText(/precios ilustrativos/i)).toBeVisible();
    await expect(page.locator("form, input, script")).toHaveCount(0);
    await fits();
    await page.getByRole("link", { name: "Ver ayuda operativa" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Configurá y compartí tu página web.",
    );
    await expect(page.getByText("Descargar QR", { exact: true })).toBeVisible();
    await fits();
    await page
      .getByRole("link", { name: "Delta Nube Gastronomía, inicio" })
      .click();
    await page
      .getByRole("link", { name: "Ya uso el sistema: necesito ayuda" })
      .click();
    await expect(page).toHaveURL(origin + "/ayuda/");
    expect(unexpected).toEqual([]);
  });
}
