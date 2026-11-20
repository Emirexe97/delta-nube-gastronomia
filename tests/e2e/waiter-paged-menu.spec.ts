import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";

type Product = { id: string; name: string; categoryId: string };
type Fixture = {
  refresh: () => Promise<void>;
  close: () => Promise<void>;
  pageRequests: () => number[];
  setVersion: (version: string) => void;
};

async function openPagedMenu(
  page: Page,
  products: Product[],
): Promise<Fixture> {
  const { waiterHtml } =
    await import("../../apps/orders-service/dist/waiter-page.js");
  const server: Server = createServer((req, res) => {
    res.writeHead(req.url === "/waiter" ? 200 : 404, {
      "content-type": "text/html; charset=utf-8",
    });
    res.end(req.url === "/waiter" ? waiterHtml : "Not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const state = {
    serverNow: new Date().toISOString(),
    cashSessionId: "cash-paged",
    validUntil: "CASH_CLOSE",
    waiter: { id: "waiter-paged", name: "Ana" },
    tables: [{ id: "table-1", number: 1, name: "Mesa 1", openOrderId: null }],
    menu: {
      halfAndHalfEnabled: false,
      categories: [{ id: "food", name: "Comidas" }],
      products: [] as Product[],
      version: "menu-v1",
      productCount: products.length,
    },
  };
  const pageRequests: number[] = [];
  let refreshes = 0;
  const pendingPages = new Map<string, { version: string; offset: number }>();
  let switchMidPage = false;
  await page.addInitScript(() => {
    sessionStorage.setItem("waiter:tenant:v1", "paged-tenant");
    sessionStorage.setItem("waiter:terminal:v1", "paged-terminal");
    sessionStorage.setItem("waiter:session:v1", "paged-token");
  });
  await page.route("**/v1/waiter/**", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON() as {
      method?: string;
      params?: { version?: string; offset?: number };
    };
    if (body.method === "waiter.getState") {
      expect(body.params).toMatchObject({ menuProtocol: 2 });
      const requestId = `state-${++refreshes}`;
      await route.fulfill({ json: { requestId } });
      return;
    }
    if (body.method === "waiter.getMenuPage") {
      const offset = body.params?.offset ?? 0;
      const version = body.params?.version;
      pageRequests.push(offset);
      const requestId = `page-${version}-${offset}-${pageRequests.length}`;
      pendingPages.set(requestId, { version: version!, offset });
      await route.fulfill({ json: { requestId } });
      return;
    }
    await route.fulfill({
      status: 500,
      json: { error: "Unmocked RPC " + body.method },
    });
  });
  await page.route("**/v1/waiter/requests/**", async (route) => {
    const requestId = new URL(route.request().url()).pathname.split("/").pop()!;
    if (requestId.startsWith("state-")) {
      await route.fulfill({ json: { status: "completed", result: state } });
      return;
    }
    if (requestId.startsWith("page-")) {
      const { version, offset } = pendingPages.get(requestId)!;
      const pageSize = 1000;
      if (switchMidPage && offset > 0) {
        state.menu.version = "menu-v3";
        products[0]!.name = "Versión final";
        products[2999]!.name = "Artículo actualizado";
        switchMidPage = false;
      }
      const result =
        version !== state.menu.version
          ? { version: state.menu.version, products: [], nextOffset: null }
          : {
              version: state.menu.version,
              products: products.slice(offset, offset + pageSize),
              nextOffset:
                offset + pageSize < products.length ? offset + pageSize : null,
            };
      await route.fulfill({ json: { status: "completed", result } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Unknown request" } });
  });
  await page.goto(`http://127.0.0.1:${address.port}/waiter`);
  await expect(
    page.getByRole("searchbox", { name: "Buscar productos" }),
  ).toBeVisible();
  return {
    refresh: async () => {
      const before = refreshes;
      await page.locator("#reconnect").click();
      await expect.poll(() => refreshes).toBe(before + 1);
    },
    pageRequests: () => [...pageRequests],
    setVersion: (version) => {
      state.menu.version = version;
      switchMidPage = true;
    },
    close: async () => {
      await page.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("hidrata menú móvil paginado, evita repetir versión y descarta mezcla de versiones", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const products = Array.from({ length: 3000 }, (_, i) => ({
    id: `p${i}`,
    name: `Producto ${String(i + 1).padStart(4, "0")}`,
    categoryId: "food",
  }));
  const fixture = await openPagedMenu(page, products);
  try {
    const rows = page.locator("#products .product");
    const search = page.getByRole("searchbox", { name: "Buscar productos" });
    await expect.poll(() => fixture.pageRequests().length).toBe(3);
    await search.fill("Producto 3000");
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Agregar Producto 3000", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Agregar Producto 3000", exact: true })
      .click();
    await expect(page.locator("#draft strong")).toContainText(
      "Producto 3000 × 1",
    );
    const before = fixture.pageRequests();
    await fixture.refresh();
    await expect(rows).toHaveCount(1);
    expect(fixture.pageRequests()).toEqual(before);
    fixture.setVersion("menu-v2");
    await fixture.refresh();
    await expect
      .poll(fixture.pageRequests)
      .toEqual([0, 1000, 2000, 0, 1000, 0, 1000, 2000]);
    await search.fill("Versión final");
    await expect(
      page.getByRole("button", { name: "Agregar Versión final", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#draft strong")).toHaveText(
      "Artículo actualizado × 1",
    );
  } finally {
    await fixture.close();
    await context.close();
  }
});
