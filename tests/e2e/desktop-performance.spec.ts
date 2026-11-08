import { launchConfiguredPos } from "./pos-fixture";
import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { createServer, type Server } from "node:http";

let app: ElectronApplication;
let page: Page;
let userData = "";
let server: Server;
let rendererRequests: string[] = [];
let blockedSettingsChunk = false;
const rendererRoot = resolve("apps/desktop-shell/renderer");

const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2" };

async function startRendererServer() {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    rendererRequests.push(pathname);
    if (blockedSettingsChunk && /settings-page.*\.js$/.test(pathname)) {
      response.writeHead(503).end("test-only blocked lazy chunk");
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(rendererRoot, relative);
    if (file !== rendererRoot && !file.startsWith(rendererRoot + sep)) {
      response.writeHead(400).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Renderer test server failed to bind");
  return `http://127.0.0.1:${address.port}`;
}

test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), "gastronomy-perf-e2e-"));
  rendererRequests = [];
  blockedSettingsChunk = false;
  const rendererUrl = await startRendererServer();
  app = await launchConfiguredPos({ args: ["apps/desktop-shell", `--user-data-dir=${userData}`], cwd: process.cwd(), env: { ...process.env, GASTRONOMY_RENDERER_URL: rendererUrl } });
  page = await app.firstWindow();
});

test.afterEach(async () => {
  try { await app?.close(); } finally {
    if (server?.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    if (userData) {
      const resolvedUserData = resolve(userData);
      if (dirname(resolvedUserData) !== resolve(tmpdir()) || !basename(resolvedUserData).startsWith("gastronomy-perf-e2e-")) {
        throw new Error("Refusing to remove a profile outside this test's dedicated temp prefix");
      }
      await rm(resolvedUserData, { recursive: true, force: true });
    }
  }
});

test("dashboard loads first; route chunks load on demand and every route renders without errors", async () => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
  const initialRequests = [...rendererRequests];
  expect(initialRequests.some(url => /settings-page|reports-page/.test(url))).toBe(false);

  const routes = [
    ["Salón", "salon", "tables-page", "Salón"], ["Pedidos", "pedidos", "orders-page", "Para retirar y envíos"], ["Productos", "catalogo", "catalog-page", "Catálogo, modificadores y stock"],
    ["Compras", "compras", "purchases-page", "Compras e ingresos"], ["Clientes", "clientes", "customers-page", "Clientes"], ["Repartidores", "repartidores", "deliveries-page", "Repartidores y rendiciones"],
    ["Usuarios", "usuarios", "users-page", "Usuarios y permisos"], ["Caja", "caja", "cash-page", "Caja y día comercial"], ["Finanzas", "finanzas", "finance-page", "Finanzas"],
    ["Informes", "informes", "reports-page", "Informes operativos"], ["Auditoría", "auditoria", "audit-page", "Auditoría operativa"], ["Configuración", "configuracion", "settings-page", "Configuración de Gastronomía"],
  ];
  for (const [label, route, chunk, content] of routes) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}`));
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(route === "finanzas" ? "main h1" : "main h2").filter({ hasText: content })).toBeVisible();
  }
  expect(rendererRequests.some(url => /settings-page.*\.js/.test(url))).toBe(true);
  expect(rendererRequests.some(url => /reports-page.*\.js/.test(url))).toBe(true);
  expect(errors).toEqual([]);
});

test("a failed lazy route stays isolated and leaves navigation available", async () => {
  blockedSettingsChunk = true;
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo cargar esta sección");
  await page.getByRole("link", { name: "Volver a Resumen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
});

test("preserves Salón and Pedidos workspace search drafts across navigation", async () => {
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  const salonSearch = page.getByPlaceholder("Buscar por mozo, mesa o producto...");
  await salonSearch.fill("mesa temporal sin guardar");
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.getByRole("link", { name: "Salón", exact: true }).click();
  await expect(page.getByPlaceholder("Buscar por mozo, mesa o producto...")).toHaveValue("mesa temporal sin guardar");

  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  const ordersSearch = page.getByPlaceholder("Pedido, cliente, teléfono o dirección");
  await ordersSearch.fill("búsqueda temporal de pedido");
  await page.getByRole("link", { name: "Resumen", exact: true }).click();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(page.getByPlaceholder("Pedido, cliente, teléfono o dirección")).toHaveValue("búsqueda temporal de pedido");
});
