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

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us07b3-fix-2026-10-07",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-us07b3-readability-"));
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
      !basename(profile).startsWith("gastronomy-us07b3-readability-")
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
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function readable(locator: Locator, label: string) {
  await settle();
  const values = await locator.evaluateAll((nodes) => {
    const lum = (c: string) => {
      const rgb =
        c
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      if (rgb.length !== 3) return null;
      return rgb
        .map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i]!, 0);
    };
    const background = (node: Element) => {
      let color = [255, 255, 255];
      const layers: number[][] = [];
      for (let el: Element | null = node; el; el = el.parentElement) {
        const x =
          getComputedStyle(el)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [];
        if (x.length < 3) continue;
        layers.push([x[0]!, x[1]!, x[2]!, x[3] ?? 1]);
        if ((x[3] ?? 1) >= 0.999) break;
      }
      for (const [r, g, b, a] of layers.reverse())
        color = [r!, g!, b!].map((v, i) => v * a! + color[i]! * (1 - a!));
      return `rgb(${color.map(Math.round).join(",")})`;
    };
    return nodes
      .filter((n) => {
        const b = n.getBoundingClientRect();
        let faded = false;
        for (let el: Element | null = n; el; el = el.parentElement)
          if (Number(getComputedStyle(el).opacity) < 0.999) faded = true;
        const hasUsefulText =
          n.tagName !== "DIV" ||
          [...n.childNodes].some(
            (child) =>
              child.nodeType === Node.TEXT_NODE &&
              Boolean(child.textContent?.trim()),
          );
        return (
          Boolean(n.textContent?.trim()) &&
          !(
            n.tagName === "BUTTON" &&
            !Array.from(n.childNodes).some(
              (child) =>
                child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
            )
          ) &&
          hasUsefulText &&
          !n.matches(
            "span.inline-flex.rounded-md, span.font-mono.select-none, button.bg-brand-600.text-white, button[aria-label='Cerrar'].text-xl",
          ) &&
          !n.closest(":disabled,[aria-disabled='true']") &&
          !faded &&
          b.width > 0 &&
          b.height > 0
        );
      })
      .map((n) => {
        const s = getComputedStyle(n),
          f = lum(s.color),
          b = lum(background(n));
        return {
          text: n.textContent?.trim().replace(/\s+/g, " "),
          fontSize: parseFloat(s.fontSize),
          fontWeight: parseInt(s.fontWeight, 10),
          contrast:
            f === null || b === null
              ? null
              : (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
        };
      });
  });
  expect(values.length, `${label}: visible text measured`).toBeGreaterThan(0);
  for (const item of values) {
    expect(item.fontSize, `${label}: ${item.text} font`).toBeGreaterThanOrEqual(
      12,
    );
    expect(item.contrast, `${label}: ${item.text} contrast`).not.toBeNull();
    const large =
      item.fontSize >= 24 || (item.fontSize >= 18.67 && item.fontWeight >= 700);
    expect(
      item.contrast!,
      `${label}: ${item.text} contrast`,
    ).toBeGreaterThanOrEqual(large ? 3 : 4.5);
  }
  return values;
}

async function setWidth(width: number) {
  await app.evaluate(
    ({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 820),
    width,
  );
  expect(
    await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getSize()[0],
    ),
  ).toBe(width);
}
async function capture(name: string, preserveScroll = false) {
  if (!preserveScroll)
    await page.evaluate(() =>
      document.querySelectorAll<HTMLElement>("main, main *").forEach((el) => {
        if (el.scrollHeight > el.clientHeight) el.scrollTop = 0;
        if (el.scrollWidth > el.clientWidth) el.scrollLeft = 0;
      }),
    );
  await settle();
  await page.screenshot({
    path: join(evidence, `${name}.png`),
    fullPage: true,
  });
}
async function fits(locator: Locator, label: string) {
  const overflow = await locator.evaluateAll((nodes) =>
    nodes
      .map((n) => {
        const e = n as HTMLElement,
          b = e.getBoundingClientRect();
        return {
          text: e.textContent?.trim(),
          width: b.width,
          height: b.height,
          sw: e.scrollWidth,
          sh: e.scrollHeight,
        };
      })
      .filter(
        (x) =>
          x.width > 0 &&
          x.height > 0 &&
          (x.sw > x.width + 1 || x.sh > x.height + 1),
      ),
  );
  expect(overflow, `${label}: no paragraph overflow`).toEqual([]);
}
async function snapshot(customerId?: string) {
  return page.evaluate(async (id) => {
    const api = window.gastronomy;
    const b = await api.bootstrap();
    if (!id) return { settings: b.settings, users: b.users, orders: b.orders };
    const [customers, customerProfile] = await Promise.all([
      api.searchCustomers("US07B3"),
      api.getCustomerProfile({ customerId: id, page: 1, pageSize: 20 }),
    ]);
    return {
      settings: b.settings,
      users: b.users,
      orders: b.orders,
      customers,
      customerProfile,
    };
  }, customerId);
}

for (const width of [1100, 1366]) {
  test(`Clientes: ficha, historial y formularios legibles a ${width}px sin mutación al cancelar`, async () => {
    await setWidth(width);
    const customer = await page.evaluate(async () => {
      const api = window.gastronomy;
      await api.openCashSession({ openingAmountMinor: 1_000_000 });
      const saved = await api.createCustomer({
        name: `US07B3 Cliente ${Math.random().toString(36).slice(2, 7)}`,
        phone: "1144447700",
        address: "Rivadavia 100",
        notes: "Preferencia de contacto por teléfono",
        preferences: "Sin picante",
      });
      const product = (await api.bootstrap()).products.find(
        (item) => item.active,
      )!;
      const draft = await api.createOrder({
        type: "TAKEAWAY",
        customerId: saved.id,
        customerName: saved.name,
        customerPhone: saved.phone,
      });
      await api.addOrderItem({ orderId: draft.id, productId: product.id });
      const order = await api.confirmOrder({ orderId: draft.id });
      await api.payOrder({
        orderId: order.id,
        customerId: saved.id,
        payments: [{ methodCode: "CASH", amountMinor: order.totalMinor }],
        idempotencyKey: crypto.randomUUID(),
      });
      return { ...saved, totalMinor: order.totalMinor };
    });
    await page.reload();
    const before = await snapshot(customer.id);
    await page.getByRole("link", { name: "Clientes", exact: true }).click();
    const root = page.locator("main .panel-enter");
    await root
      .getByPlaceholder("Nombre, teléfono o dirección")
      .fill(customer.name);
    await expect(
      root.getByText(customer.name, { exact: true }).first(),
    ).toBeVisible();
    const directoryLabels = await readable(
      root.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "customer directory",
    );
    await fits(root.locator("p"), "customer directory");
    await capture(`customers-directory-${width}`);
    await root
      .getByRole("button", {
        name: new RegExp(`Ver ficha de ${customer.name}`),
      })
      .click();
    const profileDialog = page.getByRole("dialog", { name: /Ficha ·/ });
    await expect(
      profileDialog.getByRole("heading", { name: "Historial completo" }),
    ).toBeVisible();
    await expect(profileDialog.getByText("Ticket promedio")).toBeVisible();
    await expect(profileDialog.getByText(/1 registro/)).toBeVisible();
    await expect(
      profileDialog.getByText("Sin picante", { exact: true }),
    ).toBeVisible();
    const profileLabels = await readable(
      profileDialog.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "customer profile",
    );
    await fits(profileDialog.locator("p"), "customer profile");
    await capture(`customers-profile-${width}`);
    await profileDialog.getByRole("button", { name: "Cerrar" }).last().click();
    await root
      .getByRole("button", { name: "Nuevo cliente", exact: true })
      .click();
    const create = page.getByRole("dialog", { name: "Nuevo cliente" });
    const createLabels = await readable(
      create.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "new customer form",
    );
    await fits(create.locator("p"), "new customer form");
    await capture(`customers-new-${width}`);
    await create.getByLabel("Nombre").fill("Borrador no guardado");
    const cancel = create.getByRole("button", { name: "Cancelar" });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeVisible();
    await cancel.click();
    const discard = page.getByRole("dialog", { name: "Cambios sin guardar" });
    await discard.getByRole("button", { name: "Descartar cambios" }).click();
    await root.getByRole("button", { name: `Editar ${customer.name}` }).click();
    const edit = page.getByRole("dialog", {
      name: `Editar · ${customer.name}`,
    });
    const editLabels = await readable(
      edit.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "customer edit form",
    );
    await fits(edit.locator("p"), "customer edit form");
    await capture(`customers-edit-${width}`);
    await edit.getByLabel("Nombre").fill(`${customer.name} temporal`);
    await edit.getByRole("button", { name: "Cancelar" }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Cambios sin guardar",
    });
    await confirmation
      .getByRole("button", { name: "Descartar cambios" })
      .click();
    expect(await snapshot(customer.id)).toEqual(before);
    await writeFile(
      join(evidence, `customers-${width}.json`),
      JSON.stringify(
        {
          width,
          directoryLabels,
          profileLabels,
          createLabels,
          editLabels,
          cancelledWithoutMutation: true,
          realElectronSqliteIpc: true,
        },
        null,
        2,
      ),
    );
  });

  test(`Usuarios: roles y permisos legibles; alta y edición canceladas sin mutación a ${width}px`, async () => {
    await setWidth(width);
    const before = await snapshot();
    await page.getByRole("link", { name: "Usuarios", exact: true }).click();
    const root = page.locator("main .panel-enter");
    await expect(
      root.getByRole("heading", { name: "Usuarios y permisos" }),
    ).toBeVisible();
    const tableLabels = await readable(
      root.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "users table",
    );
    await capture(`users-table-${width}`);
    await root.getByRole("button", { name: "Nuevo usuario" }).click();
    const create = page.getByRole("dialog", { name: "Nuevo usuario" });
    await expect(create.getByLabel("Rol")).toHaveValue("WAITER");
    const createLabels = await readable(
      create.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "new user form",
    );
    await fits(create.locator("p"), "new user form");
    await capture(`users-new-${width}`);
    await create.getByLabel("Nombre completo").fill("Usuario borrador");
    await create.getByRole("button", { name: "Cancelar" }).click();
    await root
      .getByRole("button", { name: /^Editar / })
      .first()
      .click();
    const edit = page.getByRole("dialog", { name: /^Editar / });
    const editLabels = await readable(
      edit.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "edit user form",
    );
    await fits(edit.locator("p"), "edit user form");
    await capture(`users-edit-${width}`);
    await edit.getByLabel("Rol").selectOption("MANAGER");
    const cancel = edit.getByRole("button", { name: "Cancelar" });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeVisible();
    await cancel.click();
    expect(await snapshot()).toEqual(before);
    await writeFile(
      join(evidence, `users-${width}.json`),
      JSON.stringify(
        {
          width,
          tableLabels,
          createLabels,
          editLabels,
          cancelledWithoutMutation: true,
          realElectronSqliteIpc: true,
        },
        null,
        2,
      ),
    );
  });

  test(`Configuración: secciones, ayudas y controles legibles sin guardar a ${width}px`, async () => {
    await setWidth(width);
    const before = await snapshot();
    await page
      .getByRole("link", { name: "Configuración", exact: true })
      .click();
    const root = page.locator("main .panel-enter");
    const nav = root.getByRole("navigation", {
      name: "Secciones de configuración",
    });
    for (const section of [
      "General",
      "Impresión",
      "Textos",
      "Copias de seguridad",
    ])
      await expect(
        nav.getByRole("button", { name: section, exact: true }),
      ).toBeVisible();
    const rootLabels = await readable(
      root.locator(
        "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
      ),
      "settings complete page and navigation",
    );
    const sectionLabels: Record<string, unknown> = {};
    for (const [name, button, id] of [
      ["general", "General", "settings-general"],
      ["printing", "Impresión", "settings-printing"],
      ["texts", "Textos", "settings-print-texts"],
      ["backup", "Copias de seguridad", "settings-backup"],
    ]) {
      await nav.getByRole("button", { name: button, exact: true }).click();
      const section = root.locator(`#${id}`);
      await expect(section).toBeVisible();
      sectionLabels[name] = await readable(
        section.locator(
          "p, span, td, th, label, h2, h3, h4, div, strong, b, dt, dd, button",
        ),
        `settings ${name}`,
      );
      await fits(section.locator("p"), `settings ${name}`);
      await section.scrollIntoViewIfNeeded();
      await capture(`settings-${name}-${width}`, true);
    }
    expect(await snapshot()).toEqual(before);
    await writeFile(
      join(evidence, `settings-${width}.json`),
      JSON.stringify(
        {
          width,
          rootLabels,
          sectionLabels,
          navigatedWithoutSaving: true,
          realElectronSqliteIpc: true,
        },
        null,
        2,
      ),
    );
  });
}
