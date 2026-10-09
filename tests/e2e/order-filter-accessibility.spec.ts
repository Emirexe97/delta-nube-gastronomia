import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-order-filter-a11y-fix-2026-10-08",
);
const labels = [
  "Todos",
  "Para retirar",
  "Envío",
  "Pendientes",
  "Atrasados",
  "Listos / reparto",
  "Pagados",
] as const;
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-order-filter-a11y-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isVisible(),
      ),
    )
    .toBe(process.env.GASTRONOMY_E2E_BACKGROUND !== "1");
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-order-filter-a11y-")
    )
      throw new Error("Unsafe disposable order-filter profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function capture(name: string, state: unknown) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const bitmap =
      await BrowserWindow.getAllWindows()[0]!.webContents.capturePage();
    return { size: bitmap.getSize(), data: bitmap.toPNG().toString("base64") };
  });
  await writeFile(
    join(evidence, `${name}.png`),
    Buffer.from(image.data, "base64"),
  );
  await writeFile(
    join(evidence, `${name}.json`),
    JSON.stringify(
      { state, capture: image.size, realElectronSqliteAndIpc: true },
      null,
      2,
    ),
  );
}

async function fixture() {
  return page.evaluate(async () => {
    const api = window.gastronomy;
    await api.openCashSession({ openingAmountMinor: 0 });
    const product = (await api.bootstrap()).products.find((p) => p.active)!;
    const base = Date.now();
    async function make(
      suffix: string,
      type: "TAKEAWAY" | "DELIVERY",
      due: number,
      status: "PENDING" | "IN_PREPARATION" | "READY",
      paid: boolean,
    ) {
      const draft = await api.createOrder({
        type,
        customerName: `US14 ${suffix}`,
        customerPhone: "1155000714",
        deliveryAddress: type === "DELIVERY" ? `Av. US14 ${suffix}` : undefined,
        promisedAt: new Date(base + due * 60_000).toISOString(),
      });
      await api.addOrderItem({
        orderId: draft.id,
        productId: product.id,
        quantity: 1,
      });
      let order = await api.confirmOrder({ orderId: draft.id });
      if (status === "READY")
        order = await api.updateOrderStatus({
          orderId: order.id,
          status: "READY",
        });
      if (
        order.operationalStatus !==
        (status === "READY" ? "READY" : "IN_PREPARATION")
      )
        throw new Error("Unexpected confirmed order status");
      if (paid)
        order = await api.payOrder({
          orderId: order.id,
          payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
          idempotencyKey: `us14-pay-${suffix}`,
        });
      return { id: order.id, number: order.number, type, status, paid, suffix };
    }
    const expected = [
      await make("TAKEAWAY-PENDING", "TAKEAWAY", 40, "PENDING", false),
      await make("DELIVERY-OVERDUE", "DELIVERY", -40, "IN_PREPARATION", false),
      await make("TAKEAWAY-READY", "TAKEAWAY", 20, "READY", false),
      await make("DELIVERY-PAID", "DELIVERY", 60, "PENDING", true),
    ];
    const boot = await api.bootstrap();
    return {
      expected,
      baseline: {
        orders: boot.orders,
        cashSession: boot.cashSession,
        dashboard: boot.dashboard,
      },
    };
  });
}

async function openOrders() {
  await page.reload();
  await page.getByRole("link", { name: "Pedidos", exact: true }).click();
  const root = page.locator("main .panel-enter");
  await expect(
    root.getByRole("heading", { name: "Para retirar y envíos" }),
  ).toBeVisible();
  return root;
}

async function pressed(root: ReturnType<typeof page.locator>) {
  return Promise.all(
    labels.map(async (label) => ({
      label,
      pressed: await root
        .getByRole("button", { name: label, exact: true })
        .getAttribute("aria-pressed"),
    })),
  );
}

async function rowNumbers(root: ReturnType<typeof page.locator>) {
  return root
    .getByRole("table")
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) =>
        Number(
          row.querySelector("td > span")?.textContent?.match(/^#(\d+)$/)?.[1] ??
            0,
        ),
      ),
    );
}

test("los siete filtros exponen selección exclusiva, aplican sus filas y se combinan con búsqueda sin mutar datos", async () => {
  test.setTimeout(90_000);
  const data = await fixture();
  const root = await openOrders();
  const initial = await pressed(root);
  await capture("order-filters-initial", { initial, fixture: data.expected });
  expect(initial).toEqual(
    labels.map((label, i) => ({ label, pressed: i === 0 ? "true" : "false" })),
  );
  const expected: Record<(typeof labels)[number], number[]> = {
    Todos: [
      data.expected[2]!.number,
      data.expected[1]!.number,
      data.expected[0]!.number,
      data.expected[3]!.number,
    ],
    "Para retirar": [data.expected[2]!.number, data.expected[0]!.number],
    Envío: [data.expected[1]!.number, data.expected[3]!.number],
    Pendientes: [
      data.expected[2]!.number,
      data.expected[1]!.number,
      data.expected[0]!.number,
      data.expected[3]!.number,
    ],
    Atrasados: [data.expected[1]!.number],
    "Listos / reparto": [data.expected[2]!.number],
    Pagados: [data.expected[3]!.number],
  };
  const observed: unknown[] = [];
  for (const label of labels) {
    await root.getByRole("button", { name: label, exact: true }).click();
    const state = await pressed(root);
    expect(
      state.filter((o) => o.pressed === "true").map((o) => o.label),
    ).toEqual([label]);
    expect(state.filter((o) => o.pressed === "false")).toHaveLength(6);
    await expect.poll(() => rowNumbers(root)).toEqual(expected[label]);
    observed.push({ label, state, numbers: await rowNumbers(root) });
    await expect(
      root.getByRole("button", { name: label, exact: true, pressed: true }),
    ).toBeVisible();
  }
  await root.getByRole("button", { name: "Pagados", exact: true }).click();
  const search = root.getByPlaceholder("Pedido, cliente, teléfono o dirección");
  await search.fill("Av. US14 DELIVERY-PAID");
  await expect.poll(() => rowNumbers(root)).toEqual([data.expected[3]!.number]);
  expect(
    (await pressed(root)).find((o) => o.label === "Pagados")?.pressed,
  ).toBe("true");
  await search.fill("no existe US14");
  await expect(root.getByText("No hay pedidos para este filtro")).toBeVisible();
  expect(
    (await pressed(root)).find((o) => o.label === "Pagados")?.pressed,
  ).toBe("true");
  await capture("order-filters-results", {
    observed,
    search: "no existe US14",
    selected: await pressed(root),
  });
  expect(
    await page.evaluate(async () => {
      const b = await window.gastronomy.bootstrap();
      return {
        orders: b.orders,
        cashSession: b.cashSession,
        dashboard: b.dashboard,
      };
    }),
  ).toEqual(data.baseline);
});

test("Tab, Enter y Space alcanzan y activan botones nativos; estados y texto sobreviven anchos y zoom", async () => {
  test.setTimeout(90_000);
  const data = await fixture();
  const root = await openOrders();
  const initial = await pressed(root);
  await capture("order-filters-keyboard-initial", {
    initial,
    fixture: data.expected,
  });
  expect(initial).toEqual(
    labels.map((label, i) => ({ label, pressed: i === 0 ? "true" : "false" })),
  );
  await root.getByRole("button", { name: "Todos", exact: true }).focus();
  const reached: string[] = [];
  for (const [index, label] of labels.entries()) {
    const button = root.getByRole("button", { name: label, exact: true });
    await expect(button).toBeFocused();
    reached.push(label);
    const layout = await button.evaluate((el) => ({
      text: el.innerText,
      clipped: el.scrollWidth > el.clientWidth,
      visible: el.getBoundingClientRect().height > 0,
    }));
    expect(layout).toEqual({ text: label, clipped: false, visible: true });
    await page.keyboard.press(index % 2 === 0 ? "Enter" : "Space");
    await expect(button).toBeFocused();
    expect(
      (await pressed(root))
        .filter((o) => o.pressed === "true")
        .map((o) => o.label),
    ).toEqual([label]);
    if (index < labels.length - 1) await page.keyboard.press("Tab");
  }
  expect(reached).toEqual(labels);
  expect(await root.getByRole("tablist").count()).toBe(0);
  await root.getByRole("button", { name: "Pagados", exact: true }).focus();
  await root
    .getByPlaceholder("Pedido, cliente, teléfono o dirección")
    .fill("no hay US14 keyboard");
  await expect(root.getByText("No hay pedidos para este filtro")).toBeVisible();
  expect(
    (await pressed(root))
      .filter((o) => o.pressed === "true")
      .map((o) => o.label),
  ).toEqual(["Pagados"]);
  const layouts: unknown[] = [];
  for (const width of [1100, 1366]) {
    await app.evaluate(
      ({ BrowserWindow }, w) =>
        BrowserWindow.getAllWindows()[0]!.setSize(w, 820),
      width,
    );
    for (const label of labels) {
      const button = root.getByRole("button", { name: label, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
      layouts.push(
        await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const t = range.getBoundingClientRect();
          return {
            label: el.innerText,
            visible: r.width > 0 && r.height > 0,
            textFits: t.left >= r.left && t.right <= r.right,
          };
        }),
      );
    }
    for (const layout of layouts.slice(-7) as {
      visible: boolean;
      textFits: boolean;
    }[]) {
      expect(layout.visible).toBe(true);
      expect(layout.textFits).toBe(true);
    }
    await capture(`order-filters-layout-${width}`, {
      width,
      layouts: layouts.slice(-7),
    });
  }
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setSize(1100, 820);
    w.webContents.setZoomFactor(2);
  });
  for (const label of labels) {
    const button = root.getByRole("button", { name: label, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    const layout = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      return {
        label: el.innerText,
        visible: r.width > 0 && r.height > 0,
        textFits: t.left >= r.left && t.right <= r.right,
      };
    });
    expect(layout.visible, label).toBe(true);
    expect(layout.textFits, label).toBe(true);
    layouts.push(layout);
  }
  await capture("order-filters-layout-zoom-200", {
    zoom: 2,
    layouts: layouts.slice(-7),
  });
  await expect(
    root.getByRole("button", { name: "Pagados", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(async () => {
      const b = await window.gastronomy.bootstrap();
      return {
        orders: b.orders,
        cashSession: b.cashSession,
        dashboard: b.dashboard,
      };
    }),
  ).toEqual(data.baseline);
});
