import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createDemoBootstrap } from "../../apps/gastronomy-web/src/demo/demo-data";

test("búsqueda de catálogo conserva foco y responde al escribir con 260 productos", async ({
  page,
}, testInfo) => {
  const dist = resolve("apps/gastronomy-web/dist");
  const server = createServer(async (req, res) => {
    try {
      const file = resolve(
        dist,
        decodeURIComponent(
          new URL(req.url!, "http://localhost").pathname,
        ).replace(/^\//, "") || "index.html",
      );
      if (!file.startsWith(dist + sep)) throw Error("Invalid path");
      const content = await readFile(file);
      res.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
          } as Record<string, string>
        )[extname(file)] || "application/octet-stream",
      );
      res.end(content);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const data = createDemoBootstrap();
    const base = data.products[0]!;
    data.products = Array.from({ length: 260 }, (_, i) => ({
      ...base,
      id: `search-${i}`,
      parentProductId: null,
      name: `Producto ${String(i).padStart(3, "0")}`,
      code: `SKU-${i}`,
      sortOrder: i,
    }));
    data.products[1] = {
      ...data.products[1]!,
      parentProductId: "search-0",
      stockMinor: 1250,
      prices: base.prices.map((price) => ({
        ...price,
        amountMinor: price.priceListCode === "SALON" ? 123456 : 234567,
      })),
    };
    await page.addInitScript((bootstrap) => {
      const metrics = {
        moneyFormats: 0,
        inputToFrame: [] as number[],
        longTasks: [] as number[],
        financeCalls: 0,
      };
      (window as any).__searchMetrics = metrics;
      const NumberFormat = Intl.NumberFormat;
      Intl.NumberFormat = new Proxy(NumberFormat, {
        construct(target, args) {
          metrics.moneyFormats++;
          return Reflect.construct(target, args);
        },
      });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          metrics.longTasks.push(entry.duration);
      }).observe({ entryTypes: ["longtask"] });
      document.addEventListener(
        "input",
        (event) => {
          if (
            (event.target as HTMLElement).getAttribute("aria-label") !==
            "Buscar productos"
          )
            return;
          const start = performance.now();
          requestAnimationFrame(() =>
            metrics.inputToFrame.push(performance.now() - start),
          );
        },
        true,
      );
      (window as any).gastronomy = {
        bootstrap: async () => bootstrap,
        getFinanceProductCosts: async () => {
          metrics.financeCalls++;
          return [];
        },
        getLicenseStatus: async () => ({
          state: "DEVELOPMENT",
          canOperate: true,
        }),
        getAppUpdateStatus: async () => ({
          state: "DISABLED",
          currentVersion: "0.1.26",
        }),
      };
    }, data);
    const port = (server.address() as { port: number }).port;
    await page.goto(`http://127.0.0.1:${port}/#/catalogo`);
    const input = page.getByRole("textbox", { name: "Buscar productos" });
    await expect(input).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: "Seleccionar Producto 259",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await input.focus();
    await page.evaluate(() => {
      const m = (window as any).__searchMetrics;
      m.moneyFormats = 0;
      m.inputToFrame = [];
      m.longTasks = [];
    });
    await input.pressSequentially("producto 259", { delay: 15 });
    await expect(input).toHaveValue("producto 259");
    await expect(input).toBeFocused();
    await expect(
      page.getByRole("checkbox", {
        name: "Seleccionar Producto 259",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", {
        name: "Seleccionar Producto 100",
        exact: true,
      }),
    ).toHaveCount(0);
    const metrics = await page.evaluate(() => (window as any).__searchMetrics);
    await testInfo.attach("search-performance", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    console.log("CATALOG_SEARCH_METRICS", JSON.stringify(metrics));
    // A broad prefix must not rebuild hundreds of currency formatters per key.
    expect(metrics.moneyFormats).toBeLessThan(50);
    expect(metrics.financeCalls).toBe(1);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await input.fill("producto 001");
    await expect(
      page.getByRole("checkbox", {
        name: "Seleccionar Producto 000",
        exact: true,
      }),
    ).toBeDisabled();
    const variant = page.getByRole("checkbox", {
      name: "Seleccionar Producto 001",
      exact: true,
    });
    await expect(variant).toBeEnabled();
    const row = page.getByRole("row").filter({ has: variant });
    await expect(row).toContainText(/1\.234,56/);
    await expect(row).toContainText(/2\.345,67/);
    await expect(row).toContainText("1,25 u.");
    await variant.check();
    await input.fill("SKU-259");
    await expect(
      page.getByRole("checkbox", {
        name: "Seleccionar Producto 259",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Quitar Producto 001 de la selección" }),
    ).toBeVisible();
    await input.fill("sin coincidencias");
    await expect(
      page.getByText(
        "No hay productos que coincidan con los filtros actuales.",
      ),
    ).toBeVisible();
    await input.fill("");
    await expect(
      page.getByRole("checkbox", {
        name: "Seleccionar Producto 259",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
