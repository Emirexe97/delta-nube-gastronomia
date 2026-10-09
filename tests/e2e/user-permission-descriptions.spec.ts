import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-user-permissions-fix-2026-10-08",
);
let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  await mkdir(evidence, { recursive: true });
  profile = await mkdtemp(join(tmpdir(), "gastronomy-user-permissions-"));
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
      !basename(profile).startsWith("gastronomy-user-permissions-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
}

async function setWindow(width: number, zoom = 1) {
  await app.evaluate(
    ({ BrowserWindow }, { width, zoom }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(width, 820);
      window.webContents.setZoomFactor(zoom);
    },
    { width, zoom },
  );
  await settle();
}

async function capture(name: string, payload: unknown) {
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
      {
        ...(payload as object),
        capture: image.size,
        realElectronSqliteAndIpc: true,
      },
      null,
      2,
    ),
  );
}

const expectedByRole: Record<string, string> = {
  ADMIN: "Acceso total",
  WAITER: "Crear pedidos · Editar pedidos · Reimprimir comandas",
  CASHIER:
    "Crear pedidos · Editar pedidos · Reimprimir comandas · Abrir caja · Cerrar caja · Registrar gastos · Registrar retiros · Ver informes",
  MANAGER: "Todas las operaciones excepto administrar usuarios",
  DELIVERY_DRIVER: "Sin permisos asignados",
};

test("muestra capacidades reales del usuario sin conteos a 1100, 1366 y 200%", async () => {
  test.setTimeout(90_000);
  const original = await page.evaluate(async () => {
    const api = window.gastronomy;
    for (const [index, roleCode] of (
      ["MANAGER", "CASHIER", "WAITER"] as const
    ).entries()) {
      await api.createUser({
        staffNumber: 100 + index,
        fullName: "US11 " + roleCode,
        roleCode,
        pin: "4321",
        authorizerPin: "1234",
      });
    }
    await api.createDriver({
      staffNumber: 103,
      fullName: "US11 Repartidor",
      authorizerPin: "1234",
    });
    return api.bootstrap();
  });
  await page.reload();
  expect(
    original.users.length,
    "SQLite profile has seeded users",
  ).toBeGreaterThan(0);

  expect(new Set(original.users.map((user) => user.roleCode)).size).toBe(5);
  for (const width of [1100, 1366]) {
    await setWindow(width);
    await page.getByRole("link", { name: "Usuarios", exact: true }).click();
    await settle();
    const root = page.locator("main .panel-enter");
    await expect(
      root.getByRole("heading", { name: "Usuarios y permisos" }),
    ).toBeVisible();

    const rows = await root.locator("tbody tr").evaluateAll((elements) =>
      elements.map((row) => {
        const cells = [...row.querySelectorAll("td")];
        const permission = cells[3]?.querySelector("span");
        return {
          staff: cells[0]?.innerText.trim(),
          name: cells[1]?.innerText.trim(),
          role: cells[2]?.innerText.trim(),
          text: permission?.innerText.trim() ?? "",
          clientWidth: permission?.clientWidth ?? 0,
          scrollWidth: permission?.scrollWidth ?? 0,
          textOverflow: permission
            ? getComputedStyle(permission).textOverflow
            : "",
          overflow: permission ? getComputedStyle(permission).overflow : "",
        };
      }),
    );
    await settle();
    await capture(`users-permissions-${width}`, {
      width,
      users: original.users,
      rows,
    });
    const users = original.users;
    for (const user of users) {
      const row = rows.find((candidate) => candidate.name === user.fullName)!;
      expect(row, `${user.fullName} row`).toBeTruthy();
      expect(
        row.text,
        `${user.fullName} permissions follow its actual permission set`,
      ).toBe(expectedByRole[user.roleCode]);
      expect(row.text).not.toMatch(/^\d+$/);
      expect(row.textOverflow).not.toBe("ellipsis");
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    await settle();
  }

  await setWindow(1100, 2);
  await page.getByRole("link", { name: "Usuarios", exact: true }).click();
  const zoomRows = await page
    .locator("main .panel-enter tbody tr")
    .evaluateAll((elements) =>
      elements.map((row) => {
        const cell = row
          .querySelectorAll("td")[3]
          ?.querySelector("span") as HTMLElement;
        return {
          text: cell?.innerText.trim() ?? "",
          clientWidth: cell?.clientWidth ?? 0,
          scrollWidth: cell?.scrollWidth ?? 0,
          textOverflow: cell ? getComputedStyle(cell).textOverflow : "",
        };
      }),
    );
  await page
    .getByRole("cell", { name: "Acceso total", exact: true })
    .scrollIntoViewIfNeeded();
  await settle();
  await capture("users-permissions-zoom-200", { zoom: 2, rows: zoomRows });
  for (const row of zoomRows) {
    expect(row.text).not.toMatch(/^\d+$/);
    expect(row.textOverflow).not.toBe("ellipsis");
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  }
});

test("cancelar cambios de usuario conserva usuarios, usuario actual y permisos", async () => {
  await page.getByRole("link", { name: "Usuarios", exact: true }).click();
  const root = page.locator("main .panel-enter");
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  const user = before.users[0]!;
  await root.getByRole("button", { name: `Editar ${user.fullName}` }).click();
  const edit = page.getByRole("dialog", { name: `Editar ${user.fullName}` });
  await edit.getByLabel("Rol").selectOption("MANAGER");
  await edit.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    before,
  );
  await root.getByRole("button", { name: `Editar ${user.fullName}` }).click();
  await edit
    .getByLabel("Motivo", { exact: true })
    .fill("US11 comprobar autorización sin cambios");
  await edit.getByLabel("PIN de autorización", { exact: true }).fill("0000");
  await edit
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(
    edit.getByText(/^(Error: )?PIN incorrecto o usuario sin permiso\.$/),
  ).toBeVisible();
  expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
    before,
  );
  await capture("users-permissions-authorization-preserved", {
    authorizationRejected: true,
    before,
  });
  await edit.getByRole("button", { name: "Cancelar", exact: true }).click();
});
