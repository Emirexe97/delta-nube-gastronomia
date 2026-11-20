const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { performance } = require("node:perf_hooks");
const root = path.resolve(__dirname, ".."),
  { _electron } = require(path.join(root, "node_modules/@playwright/test")),
  exe = require(path.join(root, "apps/desktop-shell/node_modules/electron"));
// Run against a freshly built local desktop. Never use the installed database or a configured connector.
const total = Number(process.argv[2] ?? 3000);
assert.ok(
  Number.isSafeInteger(total) && total >= 100 && total <= 9999,
  "Pass a product count between 100 and 9999",
);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gastronomy-audit3000-")),
  r = { total },
  rnd = (v) => +v.toFixed(1);
const dist = (a) => {
  a = [...a].sort((a, b) => a - b);
  return {
    n: a.length,
    p50: rnd(a[Math.ceil(a.length * 0.5) - 1]),
    p95: rnd(a[Math.ceil(a.length * 0.95) - 1]),
    max: rnd(a.at(-1)),
  };
};
(async () => {
  let app;
  try {
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.toUpperCase().startsWith("GASTRONOMY_"),
      ),
    );
    const env = {
      ...cleanEnv,
      GASTRONOMY_E2E_BACKGROUND: "1",
      GASTRONOMY_WEB_PROVISION_URL: "http://127.0.0.1:1",
      GASTRONOMY_WAITER_PROVISION_URL: "http://127.0.0.1:1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: exe,
      args: [
        path.join(root, "apps/desktop-shell"),
        "--user-data-dir=" + profile,
      ],
      cwd: root,
      env,
      timeout: 45000,
    });
    assert.equal(
      path.resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
      path.resolve(profile),
    );
    const p = await app.firstWindow();
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => console.error("pageerror", e.message));
    await p.waitForFunction(() => !!window.gastronomy);
    r.runtime = await app.evaluate(() => ({
      electron: process.versions.electron,
      node: process.versions.node,
      abi: process.versions.modules,
      platform: process.platform,
    }));
    r.seed = await p.evaluate(async (total) => {
      const a = window.gastronomy;
      if (await a.isInitialAdminPinSetupRequired())
        await a.setInitialAdminPin({ currentPin: "1234", newPin: "748259" });
      await a.saveTutorialProgress({
        version: 1,
        status: "SKIPPED",
        stepId: "welcome",
      });
      const b = await a.bootstrap();
      const cats = b.categories.filter((c) => c.active);
      const started = performance.now();
      for (let i = b.products.length; i < total; i += 500) {
        await a.importProducts({
          idempotencyKey: crypto.randomUUID(),
          rows: Array.from({ length: Math.min(500, total - i) }, (_, j) => ({
            name: "Artículo " + String(i + j).padStart(4, "0"),
            code: "QA" + String(i + j).padStart(4, "0"),
            categoryId: cats[(i + j) % cats.length].id,
            basePriceMinor: 12500,
          })),
        });
      }
      const ms = performance.now() - started,
        loaded = await a.bootstrap();
      return {
        initial: b.products.length,
        actual: loaded.products.length,
        jsonBytes: new TextEncoder().encode(JSON.stringify(loaded)).length,
        ms,
      };
    }, total);
    assert.equal(r.seed.actual, total);
    await p.reload();
    await p.getByRole("link", { name: "Caja", exact: true }).waitFor();
    await p.getByRole("link", { name: "Caja", exact: true }).click();
    await p.getByRole("button", { name: /Abrir caja/ }).click();
    await p.getByLabel("Cambio / fondo inicial").fill("50000");
    let t = performance.now();
    await p
      .getByRole("dialog", { name: "Abrir caja" })
      .getByRole("button", { name: "Abrir caja", exact: true })
      .click();
    await p
      .getByRole("dialog", { name: "Abrir caja" })
      .waitFor({ state: "hidden" });
    r.openCashMs = rnd(performance.now() - t);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Performance.enable");
    async function state() {
      await cdp.send("HeapProfiler.collectGarbage");
      const met = (await cdp.send("Performance.getMetrics")).metrics;
      const m = Object.fromEntries(met.map((o) => [o.name, o.value]));
      return {
        ...(await p.evaluate(() => ({
          elements: document.getElementsByTagName("*").length,
          rows: document.querySelectorAll("tbody tr").length,
        }))),
        heapMiB: rnd(m.JSHeapUsedSize / 1048576),
        rendererPrivateMiB: await app.evaluate(({ app, BrowserWindow }) => {
          const pid =
            BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
          const proc = app.getAppMetrics().find((x) => x.pid === pid);
          return Math.round(proc.memory.privateBytes / 1024);
        }),
      };
    }
    r.bootstrapIPC = dist(
      await p.evaluate(async () => {
        const times = [];
        for (let i = 0; i < 21; i++) {
          const t = performance.now();
          await window.gastronomy.bootstrap();
          if (i) times.push(performance.now() - t);
        }
        return times;
      }),
    );
    await p.getByRole("link", { name: "Salón" }).click();
    await p.getByLabel("Número de mesa").fill("47");
    await p.getByRole("button", { name: "Continuar", exact: true }).click();
    await p
      .getByLabel(/^Nombre de mozo/)
      .selectOption({ label: "Administrador" });
    await p.getByRole("button", { name: "Abrir mesa", exact: true }).click();
    const editor = p.getByRole("dialog", { name: /Pedido #\d+ · Salón/ }),
      s = editor.getByPlaceholder(/Código, nombre, categoría/);
    await s.waitFor();
    await s.focus();
    r.editor = await state();
    const searches = [],
      adds = [];
    for (let i = 0; i < 21; i++) {
      const num = String(total - 1 - i).padStart(4, "0"),
        code = "QA" + num,
        name = "Artículo " + num;
      const times = await p.evaluate(
        async ({ code, name }) => {
          const s = document.querySelector(
            'input[placeholder*="Código, nombre, categoría"]',
          );
          function until(fn, trigger) {
            return new Promise((resolve, reject) => {
              const start = performance.now();
              let timer;
              const observer = new MutationObserver(check);
              function check() {
                const e = fn();
                if (!e) return;
                e.getBoundingClientRect();
                clearTimeout(timer);
                observer.disconnect();
                resolve(performance.now() - start);
              }
              observer.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
              });
              timer = setTimeout(() => {
                observer.disconnect();
                reject(Error("timeout " + code));
              }, 15000);
              trigger();
              check();
            });
          }
          const get = () => {
            const el = document.getElementById("order-editor-product-0");
            return el?.textContent.includes(name) && el;
          };
          const search = await until(get, () => {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set.call(s, code);
            s.dispatchEvent(new Event("input", { bubbles: true }));
          });
          const add = await until(
            () =>
              document.querySelector(
                'input[aria-label="Cantidad de ' + name + '"]',
              ),
            () => get().click(),
          );
          return { search, add };
        },
        { code, name },
      );
      if (i) {
        searches.push(times.search);
        adds.push(times.add);
      }
    }
    r.search = dist(searches);
    r.add = dist(adds);
    await p.keyboard.press("Escape");
    if (await editor.isVisible()) {
      const btn = editor.getByRole("button", { name: /Cerrar/i });
      if (await btn.count()) await btn.first().click();
    }
    const link = p.getByRole("link", { name: "Productos", exact: true });
    await link.waitFor();
    const cat = await link.evaluate(
      (el) =>
        new Promise((resolve, reject) => {
          const start = performance.now();
          const observer = new MutationObserver(() => {
            const row = document.querySelector(
              "input[aria-label^='Seleccionar Artículo']",
            );
            if (!row) return;
            row.getBoundingClientRect();
            observer.disconnect();
            clearTimeout(timer);
            resolve(performance.now() - start);
          });
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(Error("catalog not mounted"));
          }, 60000);
          observer.observe(document.body, { childList: true, subtree: true });
          el.click();
        }),
    );
    r.catFirstLayoutMs = rnd(cat);
    await p.waitForTimeout(500);
    r.catalog = await state();
    const readCPU = () =>
      app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .reduce((sum, p) => sum + p.cpu.cumulativeCPUUsage, 0),
      );
    const initial = await readCPU();
    const start = performance.now();
    await p.waitForTimeout(20000);
    const final = await readCPU();
    r.idleCatalogCPUPercentOfOneCore = rnd(
      (100000 * (final - initial)) / (performance.now() - start),
    );
    r.idleCPUSec = rnd(final - initial);
    const box = p.getByRole("textbox", { name: "Buscar productos" });
    r.filterCycle = await box.evaluate(
      async (input, code) => {
        const results = [];
        for (const value of [code, "", code, ""]) {
          const one = value !== "";
          const time = performance.now();
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              o.disconnect();
              reject(Error("no filter"));
            }, 15000);
            const o = new MutationObserver(() => {
              const n = document.querySelectorAll("tbody tr").length;
              if (one ? n !== 1 : n < 10) return;
              document.querySelector("tbody tr").getBoundingClientRect();
              o.disconnect();
              clearTimeout(timer);
              resolve();
            });
            o.observe(document.body, { childList: true, subtree: true });
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            ).set.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
          results.push(rndLoc(performance.now() - time));
        }
        return results;
        function rndLoc(v) {
          return +v.toFixed(1);
        }
      },
      "QA" + String(total - 1).padStart(4, "0"),
    );
    console.log(JSON.stringify(r, null, 2));
  } finally {
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
        )
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (
      path.dirname(profile) === path.resolve(os.tmpdir()) &&
      path.basename(profile).startsWith("gastronomy-audit3000-")
    )
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4 });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
