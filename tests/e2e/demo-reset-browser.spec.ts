import { chromium, test, expect, type Browser, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

let buildRoot = "";
let temporaryBuildRoot = "";
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
let server: Server;
let origin = "";
let failDemoApi = false;
let browser: Browser;
let page: Page;

async function cleanupBuild() {
  if (!temporaryBuildRoot) return;
  const safeRoot = resolve(temporaryBuildRoot);
  if (dirname(safeRoot) !== resolve(tmpdir()) || !basename(safeRoot).startsWith("gastronomy-demo-renderer-")) {
    throw new Error("Refusing to remove an unowned demo renderer build directory");
  }
  await rm(safeRoot, { recursive: true, force: true });
  temporaryBuildRoot = "";
}

test.beforeAll(async () => {
  temporaryBuildRoot = await mkdtemp(join(tmpdir(), "gastronomy-demo-renderer-"));
  buildRoot = join(temporaryBuildRoot, "site");
  const webRoot = resolve("apps/gastronomy-web");
  const viteBin = resolve(webRoot, "node_modules/vite/bin/vite.js");
  try {
    execFileSync(process.execPath, [viteBin, "build", "--mode", "demo", "--outDir", buildRoot], {
      cwd: webRoot,
      stdio: "ignore",
      timeout: 180_000,
    });
  } catch (error) {
    await cleanupBuild();
    throw error;
  }
});

test.afterAll(async () => cleanupBuild());

test.beforeEach(async () => {
  failDemoApi = false;
  const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  page = await browser.newPage();
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    if (failDemoApi && /demo-api-.*\.js$/.test(pathname)) {
      response.writeHead(503).end("simulated demo chunk failure");
      return;
    }
    const file = resolve(buildRoot, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
    if (file !== buildRoot && !file.startsWith(buildRoot + sep)) {
      response.writeHead(400).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error("missing file");
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end("not found"); }
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Demo server failed to bind");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterEach(async () => {
  try { await browser?.close(); } finally {
    if (server?.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
});

test("demo API loads lazily and visible reset restores initial data after reload", async () => {
  const requests: string[] = [];
  page.on("request", request => requests.push(new URL(request.url()).pathname));
  await page.goto(origin);
  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
  expect(requests.some(path => /demo-api-.*\.js$/.test(path))).toBe(true);

  await page.evaluate(async () => {
    await window.gastronomy.createCustomer({ name: "Temporal reset demo", phone: "+5491100001234" });
  });
  expect(await page.evaluate(async () => (await window.gastronomy.searchCustomers("Temporal reset demo")).some(customer => customer.name === "Temporal reset demo"))).toBe(true);
  await page.getByRole("button", { name: /Modo demostración.*Restablecer/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
  await page.waitForFunction(async () => (await window.gastronomy.searchCustomers("Temporal reset demo")).length === 0);
});

test("demo API chunk failure renders retryable startup guidance instead of a blank window", async () => {
  failDemoApi = true;
  await page.goto(origin);
  await expect(page.getByRole("alert")).toContainText("No se pudo iniciar Gastronomía");
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toHaveCount(0);
  failDemoApi = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await window.gastronomy.bootstrap()).currentUser.fullName)).not.toBe("");
});
