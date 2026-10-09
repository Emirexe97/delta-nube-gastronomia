import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us07b4-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";
const shellRequire = createRequire(
  resolve(process.cwd(), "apps/desktop-shell/package.json"),
);
const webRequire = createRequire(
  resolve(process.cwd(), "apps/gastronomy-web/package.json"),
);
async function esbuildBuild(options: any) {
  try {
    return await createRequire(shellRequire.resolve("tsup/package.json"))(
      "esbuild",
    ).build(options);
  } catch {
    // esbuild is a transitive pnpm dependency of workspace tooling, not a root dependency.
    const store = join(process.cwd(), "node_modules/.pnpm");
    const candidates = (await readdir(store))
      .filter((name) => /^esbuild@/.test(name))
      .sort()
      .reverse();
    for (const name of candidates) {
      try {
        return await createRequire(
          join(store, name, "node_modules/esbuild/package.json"),
        )("esbuild").build(options);
      } catch {
        /* try the next installed workspace esbuild */
      }
    }
    throw new Error(
      "No workspace esbuild installation was found for the isolated component harness",
    );
  }
}
test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us07b4-readability-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-us07b4-readability-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});
async function settle() {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
  });
}
async function width(w: number) {
  await app.evaluate(
    ({ BrowserWindow }, n) => BrowserWindow.getAllWindows()[0]!.setSize(n, 820),
    w,
  );
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize()[0],
    ),
  ).toBe(w);
}
async function snapshot() {
  return page.evaluate(async () => {
    const b = await window.gastronomy.bootstrap();
    return {
      products: b.products,
      orders: b.orders,
      settings: b.settings,
      users: b.users,
      customers: await window.gastronomy.searchCustomers("US07B4"),
    };
  });
}
async function customerFixture() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 1_000_000 });
    const customer = await api.createCustomer({
      name: `US07B4 Cliente ${Math.random().toString(36).slice(2, 7)}`,
      phone: "1144447744",
      address: "Rivadavia 100",
      notes: "Fixture de lectura",
    });
    const product = (await api.bootstrap()).products.find((p) => p.active)!;
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
    });
    await api.addOrderItem({ orderId: draft.id, productId: product.id });
    const order = await api.confirmOrder({ orderId: draft.id });
    await api.payOrder({
      orderId: order.id,
      customerId: customer.id,
      payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
      idempotencyKey: crypto.randomUUID(),
    });
    return customer;
  });
}
async function measure(locator: Locator, label: string, minimumContrast = 4.5) {
  await settle();
  const values = await locator.evaluateAll((nodes) => {
    const lum = (c: string) => {
      const v =
        c
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      if (v.length < 3) return null;
      return v
        .map((x) => {
          x /= 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i]!, 0);
    };
    const bg = (n: Element) => {
      let out = [255, 255, 255];
      const ls: number[][] = [];
      for (let e: Element | null = n; e; e = e.parentElement) {
        const q =
          getComputedStyle(e)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [];
        if (q.length < 3) continue;
        const a = q[3] ?? 1;
        ls.push([q[0]!, q[1]!, q[2]!, a]);
        if (a >= 0.999) break;
      }
      for (const [r, g, b, a] of ls.reverse())
        out = [r!, g!, b!].map((v, i) => v * a! + out[i]! * (1 - a!));
      return `rgb(${out.map(Math.round).join(",")})`;
    };
    return nodes
      .filter((n) => {
        const b = n.getBoundingClientRect();
        return (
          !!n.textContent?.trim() &&
          b.width > 0 &&
          b.height > 0 &&
          !n.closest(":disabled,[aria-disabled='true']")
        );
      })
      .map((n) => {
        const s = getComputedStyle(n),
          f = lum(s.color),
          b = lum(bg(n));
        return {
          text: n.textContent?.trim().replace(/\s+/g, " "),
          fontSize: parseFloat(s.fontSize),
          contrast:
            f === null || b === null
              ? null
              : (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
        };
      });
  });
  expect(values.length, `${label}: measured visible controls`).toBeGreaterThan(
    0,
  );
  for (const v of values) {
    expect(v.fontSize, `${label} ${v.text} font`).toBeGreaterThanOrEqual(12);
    expect(v.contrast, `${label} ${v.text} contrast`).not.toBeNull();
    expect(v.contrast!, `${label} ${v.text} contrast`).toBeGreaterThanOrEqual(
      minimumContrast,
    );
  }
  return values;
}
async function harness() {
  const source = `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {Badge,Button} from ${JSON.stringify(resolve(process.cwd(), "packages/ui/src/index.tsx"))}; export default renderToStaticMarkup(React.createElement('div',{className:'flex flex-wrap gap-3 bg-white p-4'}, ...['slate','violet','orange','green','amber','rose','blue'].map(t=>React.createElement(Badge,{key:t,tone:t},t)), ...['primary','secondary','ghost','danger'].map(v=>React.createElement(Button,{key:v,variant:v},v)), ...['primary','secondary','ghost','danger'].map(v=>React.createElement(Button,{key:v+' disabled',variant:v,disabled:true},v+' deshabilitado'))));`;
  const out = await esbuildBuild({
    stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react-dom/server"],
  });
  const mod = { exports: {} as { default?: string } };
  new Function("require", "module", "exports", out.outputFiles[0]!.text)(
    webRequire,
    mod,
    mod.exports,
  );
  await page.evaluate((markup) => {
    const host = document.createElement("div");
    host.id = "us07b4-harness";
    host.style.cssText =
      "position:fixed;left:0;top:0;z-index:99999;background:white";
    host.innerHTML = markup;
    document.body.append(host);
  }, mod.exports.default!);
  await settle();
}
for (const w of [1100, 1366]) {
  test(`Shared Badge/Button: tonos y variantes normal, hover, foco y disabled a ${w}px`, async () => {
    await width(w);
    const before = await snapshot();
    await harness();
    const host = page.locator("#us07b4-harness");
    const badges = host.locator("span");
    await expect(badges).toHaveCount(7);
    await measure(badges, "Badge seven tones");
    const buttons = host.locator("button:not(:disabled)");
    await expect(buttons).toHaveCount(4);
    const metrics: Record<string, unknown> = {
      badges: await measure(badges, "Badge seven tones"),
    };
    for (let i = 0; i < 4; i++) {
      const b = buttons.nth(i);
      metrics[`button${i}Normal`] = await measure(b, `Button variant ${i}`);
      await b.hover();
      metrics[`button${i}Hover`] = await measure(b, `Button hover ${i}`);
    }
    await buttons.nth(1).focus();
    await page.keyboard.press("Shift+Tab");
    for (let i = 0; i < 4; i++) {
      if (i > 0) await page.keyboard.press("Tab");
      const b = buttons.nth(i);
      await expect(b).toBeFocused();
      await page.mouse.move(1, 1);
      expect(await b.evaluate((n) => n.matches(":focus-visible"))).toBeTruthy();
      metrics[`button${i}KeyboardFocus`] = await measure(
        b,
        `Button keyboard focus ${i}`,
      );
    }
    const disabled = host.locator("button:disabled");
    await expect(disabled).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const b = disabled.nth(i);
      await expect(b).toBeDisabled();
      await expect(b).toHaveCSS("cursor", "not-allowed");
    }
    await page.screenshot({
      path: join(evidence, `shared-controls-${w}.png`),
      fullPage: true,
    });
    await page.locator("#us07b4-harness").evaluate((n) => n.remove());
    expect(await snapshot()).toEqual(before);
    await writeFile(
      join(evidence, `shared-controls-${w}.json`),
      JSON.stringify(
        {
          width: w,
          metrics,
          badgeTones: 7,
          buttonVariants: 4,
          states: ["normal", "hover", "keyboard-focus", "disabled"],
          disabledControlsBehaviorUnchanged: true,
          fixtureRenderer:
            "real shared UI components mounted in isolated DOM host",
        },
        null,
        2,
      ),
    );
  });
  test(`Usuarios: Badge real y botones alcanzables a ${w}px`, async () => {
    await width(w);
    await page.getByRole("link", { name: "Usuarios", exact: true }).click();
    const root = page.locator("main .panel-enter");
    await expect(
      root.getByRole("heading", { name: "Usuarios y permisos" }),
    ).toBeVisible();
    const badges = root.locator("span.inline-flex.rounded-md");
    await expect(badges.first()).toBeVisible();
    await measure(badges, "real Users role/status badges");
    const table = root.locator("table");
    const viewport = await page.evaluate(() => window.innerWidth);
    const cells = await table.locator("th,td").evaluateAll((nodes) =>
      nodes
        .map((n) => {
          const b = n.getBoundingClientRect(),
            r = document.createRange();
          r.selectNodeContents(n);
          const t = r.getBoundingClientRect();
          return {
            text: n.textContent?.trim(),
            left: b.left,
            right: b.right,
            textLeft: t.left,
            textRight: t.right,
          };
        })
        .filter((x) => Boolean(x.text) && x.right > x.left),
    );
    expect(
      cells.every(
        (c) =>
          c.left >= -1 &&
          c.right <= viewport + 1 &&
          c.textLeft >= c.left - 1 &&
          c.textRight <= c.right + 1,
      ),
      "user table cells and labels stay in bounds",
    ).toBeTruthy();
    const actions = root.locator("button");
    for (let i = 0; i < (await actions.count()); i++) {
      await actions.nth(i).scrollIntoViewIfNeeded();
      await expect(actions.nth(i)).toBeVisible();
    }
    await page.screenshot({
      path: join(evidence, `users-badges-${w}.png`),
      fullPage: true,
    });
  });
  test(`Clientes: estados Badge reales y tarjetas sin recorte a ${w}px`, async () => {
    await width(w);
    const customer = await customerFixture();
    await page.reload();
    const before = await snapshot();
    await page.getByRole("link", { name: "Clientes", exact: true }).click();
    const root = page.locator("main .panel-enter");
    await expect(root.getByText(customer.name, { exact: true })).toBeVisible();
    const badges = root.locator("span.inline-flex.rounded-md");
    expect(
      await badges.count(),
      "real customer status badges from paid customer fixture",
    ).toBeGreaterThan(0);
    await measure(badges, "real Customers status badges");
    const cards = root.locator(
      "section[aria-label='Directorio de clientes'] > div",
    );
    const viewport = await page.evaluate(() => window.innerWidth);
    const bounds = await cards.evaluateAll((nodes) =>
      nodes
        .map((n) => {
          const b = n.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(n);
          const t = range.getBoundingClientRect();
          return {
            text: n.textContent?.trim().slice(0, 100),
            left: b.left,
            right: b.right,
            width: b.width,
            scrollWidth: (n as HTMLElement).scrollWidth,
            textLeft: t.left,
            textRight: t.right,
          };
        })
        .filter((x) => x.width > 0),
    );
    expect(
      bounds.every(
        (x) =>
          x.left >= -1 &&
          x.right <= viewport + 1 &&
          x.scrollWidth <= x.width + 1,
      ),
      "customer card bounds preserve existing name truncation",
    ).toBeTruthy();
    expect(await snapshot()).toEqual(before);
    await page.screenshot({
      path: join(evidence, `customers-badges-${w}.png`),
      fullPage: true,
    });
  });
}
test("Modal Nuevo cliente: icono cerrar legible, 40x40, foco/tab/Escape y cancelar protege datos", async () => {
  await width(1366);
  const before = await snapshot();
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  const root = page.locator("main .panel-enter");
  await root
    .getByRole("button", { name: "Nuevo cliente", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Nuevo cliente" });
  const close = dialog.getByRole("button", { name: "Cerrar" });
  const metrics: Record<string, unknown> = {
    normal: await measure(close, "modal close icon", 3),
  };
  const box = await close.boundingBox();
  expect(box?.width).toBe(40);
  expect(box?.height).toBe(40);
  await close.hover();
  metrics.hover = await measure(close, "modal close hover", 3);
  await page.mouse.move(1, 1);
  await dialog.getByLabel("Teléfono").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await expect(close).toHaveAttribute("aria-label", "Cerrar");
  metrics.keyboardFocus = await measure(close, "modal close keyboard focus", 3);
  await dialog.getByLabel("Nombre").fill("Borrador US07B4");
  await page.screenshot({
    path: join(evidence, "modal-close-customer-1366.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  const guard = page.getByRole("dialog", { name: "Cambios sin guardar" });
  await expect(guard).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guard).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Descartar cambios" }).click();
  expect(await snapshot()).toEqual(before);
  await writeFile(
    join(evidence, "modal-close-customer-1366.json"),
    JSON.stringify(
      {
        width: 1366,
        metrics,
        closeTarget: {
          width: box?.width,
          height: box?.height,
          ariaLabel: "Cerrar",
        },
        escapeKeepsParentOpen: true,
        cancelDiscardPreservesState: true,
      },
      null,
      2,
    ),
  );
});
test("Modal Nuevo usuario: icono cerrar conserva cierre directo sin mutación", async () => {
  await width(1100);
  const before = await snapshot();
  await page.getByRole("link", { name: "Usuarios", exact: true }).click();
  const root = page.locator("main .panel-enter");
  await root.getByRole("button", { name: "Nuevo usuario" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo usuario" });
  const close = dialog.getByRole("button", { name: "Cerrar" });
  const metrics: Record<string, unknown> = {
    normal: await measure(close, "new user modal close", 3),
  };
  const box = await close.boundingBox();
  expect(box?.width).toBe(40);
  expect(box?.height).toBe(40);
  await close.hover();
  metrics.hover = await measure(close, "new user modal close hover", 3);
  await page.mouse.move(1, 1);
  await dialog.getByLabel("Número de usuario").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await expect(close).toHaveAttribute("aria-label", "Cerrar");
  metrics.keyboardFocus = await measure(close, "new user modal close focus", 3);
  await dialog.getByLabel("Nombre completo").fill("Borrador US07B4");
  await page.screenshot({
    path: join(evidence, "modal-close-user-1100.png"),
    fullPage: true,
  });
  await close.click();
  await expect(dialog).toBeHidden();
  expect(await snapshot()).toEqual(before);
  await writeFile(
    join(evidence, "modal-close-user-1100.json"),
    JSON.stringify(
      {
        width: 1100,
        metrics,
        closeTarget: {
          width: box?.width,
          height: box?.height,
          ariaLabel: "Cerrar",
        },
        closeWithoutDirtyGuardPreservesState: true,
      },
      null,
      2,
    ),
  );
});
