import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us25-fix-2026-10-06",
);
const nativeModule = createRequire(
  join(process.cwd(), "packages/database/package.json"),
).resolve("better-sqlite3-multiple-ciphers");
let app: ElectronApplication;
let page: Page;
let profile: string;
let destination: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-backup-safety-"));
  destination = join(profile, "snapshot.sqlite");
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
  await pickDestination(destination);
});
test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await app?.close();
  if (
    !resolve(profile).startsWith(
      resolve(tmpdir()) + sep + "gastronomy-backup-safety-",
    )
  )
    throw new Error("Unsafe disposable profile path");
  await rm(profile, { recursive: true, force: true });
});

async function pickDestination(file: string, canceled = false) {
  await app.evaluate(
    ({ app, dialog }, { profile, file, canceled }) => {
      const path = process.getBuiltinModule("path");
      if (
        path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
        path.dirname(path.resolve(file)) !== path.resolve(profile)
      )
        throw new Error("Path outside disposable profile");
      // File selection only is stubbed; the application, IPC, backup and filesystem are real.
      dialog.showSaveDialog = async () => ({
        canceled,
        filePath: canceled ? undefined : file,
      });
    },
    { profile, file, canceled },
  );
}
async function assertNoTemporaryFiles() {
  expect(
    (await readdir(profile)).filter((name) =>
      name.startsWith(".gastronomy-backup-"),
    ),
  ).toEqual([]);
}
async function savedCustomerNames() {
  return app.evaluate(
    ({ app }, { profile, destination, nativeModule }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(profile))
        throw new Error("Wrong profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      const db = new Database(destination, { readonly: true });
      try {
        return db
          .prepare("SELECT name FROM customers ORDER BY name")
          .all()
          .map((row: { name: string }) => row.name);
      } finally {
        db.close();
      }
    },
    { profile, destination, nativeModule },
  );
}

test("backup creation failure preserves the previous copy byte for byte", async () => {
  await page.evaluate(() => window.gastronomy.createBackup());
  const before = await readFile(destination);
  await app.evaluate(
    ({ app }, { profile, nativeModule }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(profile))
        throw new Error("Wrong profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      Database.prototype.backup = () =>
        Promise.reject(new Error("Fallo de copia de prueba US25"));
    },
    { profile, nativeModule },
  );
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page
    .getByRole("button", { name: "Copias de seguridad", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crear copia local", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Fallo de copia de prueba US25",
  );
  expect(await readFile(destination)).toEqual(before);
  await assertNoTemporaryFiles();
  await page.screenshot({
    path: join(out, "backup-failure-preserved.png"),
    fullPage: true,
  });
  await writeFile(
    join(out, "backup-failure-preserved.json"),
    JSON.stringify(
      {
        existingCopyUnchanged: true,
        byteLength: before.length,
        nativeFailureInjected: true,
        temporaryFilesRemaining: 0,
        liveDatabaseReadable: Boolean(
          (await page.evaluate(() => window.gastronomy.bootstrap()))
            .currentUser,
        ),
      },
      null,
      2,
    ),
  );
});

test("validation failure preserves the previous copy", async () => {
  await page.evaluate(() => window.gastronomy.createBackup());
  const before = await readFile(destination);
  await app.evaluate(
    ({ app }, { profile, nativeModule }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(profile))
        throw new Error("Wrong profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      const original = Database.prototype.pragma;
      Database.prototype.pragma = function (
        source: string,
        ...args: unknown[]
      ) {
        return source === "integrity_check"
          ? "fallo de validación US25"
          : original.call(this, source, ...args);
      };
    },
    { profile, nativeModule },
  );
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.createBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).toContain("integrity_check");
  expect(await readFile(destination)).toEqual(before);
  await assertNoTemporaryFiles();
});

test("successful replacement publishes a valid current SQLite copy without changing the live database", async () => {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Anterior US25",
      phone: "1155002500",
    }),
  );
  await page.evaluate(() => window.gastronomy.createBackup());
  expect(await savedCustomerNames()).toContain("Anterior US25");
  expect(await savedCustomerNames()).not.toContain("Nuevo US25");
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Nuevo US25",
      phone: "1155002501",
    }),
  );
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page
    .getByRole("button", { name: "Copias de seguridad", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crear copia local", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Copia creada");
  expect(await savedCustomerNames()).toEqual(
    expect.arrayContaining(["Anterior US25", "Nuevo US25"]),
  );
  expect(
    (await page.evaluate(() => window.gastronomy.searchCustomers("Nuevo US25")))
      .length,
  ).toBe(1);
  await assertNoTemporaryFiles();
  await page.screenshot({
    path: join(out, "backup-replacement-success.png"),
    fullPage: true,
  });
});

test("canceling file selection leaves the previous copy unchanged", async () => {
  await page.evaluate(() => window.gastronomy.createBackup());
  const before = await readFile(destination);
  await pickDestination(destination, true);
  expect(await page.evaluate(() => window.gastronomy.createBackup())).toEqual({
    path: null,
  });
  expect(await readFile(destination)).toEqual(before);
  await assertNoTemporaryFiles();
});

test("a Windows publication failure preserves the locked previous copy", async () => {
  test.skip(process.platform !== "win32", "Windows destination lock behavior");
  await page.evaluate(() => window.gastronomy.createBackup());
  const before = await readFile(destination);
  await app.evaluate(
    ({ app }, { profile, destination, nativeModule }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(profile))
        throw new Error("Wrong profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      (globalThis as any).__us25DestinationReader = new Database(destination, {
        readonly: true,
      });
    },
    { profile, destination, nativeModule },
  );
  try {
    const failure = await page.evaluate(async () => {
      try {
        await window.gastronomy.createBackup();
        return "UNEXPECTED_SUCCESS";
      } catch (error) {
        return String(error);
      }
    });
    expect(failure).not.toBe("UNEXPECTED_SUCCESS");
    expect(await readFile(destination)).toEqual(before);
    await assertNoTemporaryFiles();
    await writeFile(
      join(out, "backup-publication-failure.json"),
      JSON.stringify(
        {
          failure,
          previousCopyUnchanged: true,
          actualWindowsLockedDestination: true,
          temporaryFilesRemaining: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.evaluate(() => {
      (globalThis as any).__us25DestinationReader?.close();
      delete (globalThis as any).__us25DestinationReader;
    });
  }
});

for (const suffix of ["", "-wal", "-shm"])
  test(`the live database ${suffix || "file"} cannot be selected as the backup destination`, async () => {
    await page.evaluate(() =>
      window.gastronomy.createCustomer({
        name: "Base viva US25",
        phone: "1155002502",
      }),
    );
    await pickDestination(join(profile, `gastronomy.sqlite${suffix}`));
    const failure = await page.evaluate(async () => {
      try {
        await window.gastronomy.createBackup();
        return "UNEXPECTED_SUCCESS";
      } catch (error) {
        return String(error);
      }
    });
    expect(failure).toContain("base en uso");
    expect(
      (
        await page.evaluate(() =>
          window.gastronomy.searchCustomers("Base viva US25"),
        )
      ).length,
    ).toBe(1);
    await assertNoTemporaryFiles();
  });
