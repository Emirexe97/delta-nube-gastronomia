import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, readdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const out = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-us24-fix-2026-10-06",
);
const nativeModule = createRequire(
  join(process.cwd(), "packages/database/package.json"),
).resolve("better-sqlite3-multiple-ciphers");
let app: ElectronApplication;
let page: Page;
let profile: string;
let backup: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-restore-us24-"));
  backup = join(profile, "restore-source.sqlite");
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
  if (
    !resolve(profile).startsWith(
      resolve(tmpdir()) + sep + "gastronomy-restore-us24-",
    )
  )
    throw new Error("Unsafe disposable profile path");
  await rm(profile, { recursive: true, force: true });
});

async function stubNativeDialogs(options: {
  source?: string;
  canceled?: boolean;
  confirmResult?: number;
  deferConfirmation?: boolean;
}) {
  await app.evaluate(
    ({ app, dialog }, { profile, backup, ...options }) => {
      const path = process.getBuiltinModule("path");
      if (path.resolve(app.getPath("userData")) !== path.resolve(profile))
        throw new Error("Wrong disposable profile");
      for (const file of [backup, options.source ?? backup])
        if (!path.resolve(file).startsWith(path.resolve(profile) + path.sep))
          throw new Error("Restore fixture outside disposable profile");
      // Only native dialogs are replaced; IPC, repository, SQLite and filesystem remain real.
      dialog.showOpenDialog = async () => ({
        canceled: Boolean(options.canceled),
        filePaths: options.canceled ? [] : [options.source ?? backup],
      });
      (globalThis as any).__us24DialogCalls = [];
      dialog.showMessageBox = async (_window: unknown, details: any) => {
        (globalThis as any).__us24DialogCalls.push(details);
        if (details.type === "warning") {
          if (options.deferConfirmation)
            return await new Promise((resolve) => {
              (globalThis as any).__us24ResolveConfirmation = resolve;
            });
          return { response: options.confirmResult ?? 0 };
        }
        return { response: 0 };
      };
    },
    { profile, backup, ...options },
  );
}

async function createBackup() {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Registro anterior US24",
      phone: "1155002400",
    }),
  );
  await app.evaluate(
    ({ app, dialog }, { profile, backup }) => {
      const path = process.getBuiltinModule("path");
      if (
        path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
        path.dirname(path.resolve(backup)) !== path.resolve(profile)
      )
        throw new Error("Backup path outside disposable profile");
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: backup,
      });
    },
    { profile, backup },
  );
  await page.evaluate(() => window.gastronomy.createBackup());
}

async function customers(query: string) {
  return page.evaluate(
    (value) => window.gastronomy.searchCustomers(value),
    query,
  );
}

async function recoveryFiles() {
  const root = join(profile, "recovery");
  const folders = await readdir(root).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? [] : Promise.reject(error),
  );
  return Promise.all(
    folders.map((folder) => join(root, folder, "current.sqlite")),
  );
}

async function assertNoStaging() {
  expect(
    (await readdir(profile)).filter((name) =>
      name.startsWith(".gastronomy-restore-"),
    ),
  ).toEqual([]);
}

async function currentDatabasePath() {
  return join(
    await app.evaluate(({ app }) => app.getPath("userData")),
    "gastronomy.sqlite",
  );
}

async function injectBackupFailure() {
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
        Promise.reject(new Error("Fallo controlado de backup US24"));
    },
    { profile, nativeModule },
  );
}

async function injectRecoveryValidationFailure() {
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
      let calls = 0;
      Database.prototype.pragma = function (
        source: string,
        ...args: unknown[]
      ) {
        if (source === "integrity_check" && ++calls === 2)
          return "fallo de recuperación US24";
        return original.call(this, source, ...args);
      };
    },
    { profile, nativeModule },
  );
}

async function customerInSqlite(file: string, name: string) {
  return app.evaluate(
    ({ app }, { profile, file, name, nativeModule }) => {
      const path = process.getBuiltinModule("path");
      if (
        path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
        !path.resolve(file).startsWith(path.resolve(profile) + path.sep)
      )
        throw new Error("SQLite fixture outside disposable profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      const db = new Database(file, { readonly: true });
      try {
        return db
          .prepare("SELECT name FROM customers WHERE name = ?")
          .get(name);
      } finally {
        db.close();
      }
    },
    { profile, file, name, nativeModule },
  );
}

test("canceling source selection does not modify the live database", async () => {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Conservar por selección US24",
      phone: "1155002401",
    }),
  );
  await stubNativeDialogs({ canceled: true });
  const result = await page.evaluate(() => window.gastronomy.restoreBackup());
  expect(result).toEqual({ path: null, restored: false });
  expect(await customers("Conservar por selección US24")).toHaveLength(1);
  expect(
    await app.evaluate(() => (globalThis as any).__us24DialogCalls),
  ).toEqual([]);
  await assertNoStaging();
});

for (const [label, response] of [
  ["default response", 0],
  ["explicit cancel response", 0],
  ["close response", -1],
] as const) {
  test(`confirmation ${label} cancels restore without changing live data`, async () => {
    await createBackup();
    const marker = `Conservar al cancelar US24 ${label}`;
    await page.evaluate(
      (name) => window.gastronomy.createCustomer({ name, phone: "1155002403" }),
      marker,
    );
    await stubNativeDialogs({ source: backup, confirmResult: response });
    const result = await page.evaluate(() => window.gastronomy.restoreBackup());
    expect(result).toEqual({ path: null, restored: false });
    expect(await customers(marker)).toHaveLength(1);
    const calls = await app.evaluate(
      () => (globalThis as any).__us24DialogCalls,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: "warning",
      buttons: ["Cancelar", "Restaurar copia"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "¿Restaurar esta copia?",
    });
    expect(calls[0].detail).toContain("restore-source.sqlite");
    expect(calls[0].detail).toContain("Última modificación del archivo");
    expect(calls[0].detail).toContain("reemplazará");
    expect(await readdir(profile)).not.toContain("recovery");
  });
}

test("successful restore replaces current data and keeps a recovery copy of pre-restore data", async () => {
  await createBackup();
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Registro actual para recuperación US24",
      phone: "1155002404",
    }),
  );
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  const result = await page.evaluate(() => window.gastronomy.restoreBackup());
  expect(result).toEqual({ path: backup, restored: true });
  expect(await customers("Registro anterior US24")).toHaveLength(1);
  expect(
    await customers("Registro actual para recuperación US24"),
  ).toHaveLength(0);
  const recovery = join(profile, "recovery");
  const folders = await readdir(recovery);
  expect(folders).toHaveLength(1);
  const recoveredDb = join(recovery, folders[0], "current.sqlite");
  expect(
    await app.evaluate(
      ({ app }, { profile, recoveredDb, nativeModule }) => {
        const path = process.getBuiltinModule("path");
        if (
          path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
          !path
            .resolve(recoveredDb)
            .startsWith(path.resolve(profile) + path.sep)
        )
          throw new Error("Recovery DB outside disposable profile");
        const require = process
          .getBuiltinModule("module")
          .createRequire(nativeModule);
        const Database = require(nativeModule);
        const db = new Database(recoveredDb, { readonly: true });
        try {
          return db
            .prepare("SELECT name FROM customers WHERE name = ?")
            .get("Registro actual para recuperación US24");
        } finally {
          db.close();
        }
      },
      { profile, recoveredDb, nativeModule },
    ),
  ).toBeTruthy();
  await assertNoStaging();
  await page.screenshot({
    path: join(out, "restore-success-recovery.png"),
    fullPage: true,
  });
});

test("invalid SQLite source is rejected before confirmation", async () => {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Actual tras inválida US24",
      phone: "1155002410",
    }),
  );
  const invalid = join(profile, "not-sqlite.sqlite");
  await writeFile(invalid, "not a sqlite database");
  await stubNativeDialogs({ source: invalid, confirmResult: 1 });
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).not.toBe("UNEXPECTED_SUCCESS");
  expect(await customers("Actual tras inválida US24")).toHaveLength(1);
  expect(
    await app.evaluate(() => (globalThis as any).__us24DialogCalls),
  ).toEqual([]);
  await assertNoStaging();
});

test("SQLite source that passes integrity but has malformed schema rolls back after open failure", async () => {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Viva tras schema roto US24",
      phone: "1155002411",
    }),
  );
  const malformed = join(profile, "malformed-schema.sqlite");
  await app.evaluate(
    ({ app }, { profile, malformed, nativeModule }) => {
      const path = process.getBuiltinModule("path");
      if (
        path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
        path.dirname(path.resolve(malformed)) !== path.resolve(profile)
      )
        throw new Error("Malformed SQLite fixture outside profile");
      const require = process
        .getBuiltinModule("module")
        .createRequire(nativeModule);
      const Database = require(nativeModule);
      const db = new Database(malformed);
      try {
        db.exec(
          "CREATE TABLE schema_migrations(version TEXT); CREATE TABLE orders(id TEXT); CREATE TABLE users(id TEXT); CREATE TABLE audit_log(id TEXT);",
        );
      } finally {
        db.close();
      }
    },
    { profile, malformed, nativeModule },
  );
  await stubNativeDialogs({ source: malformed, confirmResult: 1 });
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).not.toBe("UNEXPECTED_SUCCESS");
  await writeFile(
    join(out, "malformed-restore-error.json"),
    JSON.stringify({ failure }, null, 2),
  );
  expect(await customers("Viva tras schema roto US24")).toHaveLength(1);
  const calls = await app.evaluate(() => (globalThis as any).__us24DialogCalls);
  expect(calls[0].type).toBe("warning");
  expect(calls.some((call: any) => call.type === "info")).toBe(false);
  const retained = await recoveryFiles();
  expect(retained).toHaveLength(1);
  expect(
    await customerInSqlite(retained[0], "Viva tras schema roto US24"),
  ).toBeTruthy();
  await assertNoStaging();
});

test("backup failure after confirmation leaves live database intact and cleans staging/recovery attempt", async () => {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Viva tras backup falla US24",
      phone: "1155002412",
    }),
  );
  await createBackup();
  const currentBefore = await readFile(await currentDatabasePath());
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  await injectBackupFailure();
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).toContain("Fallo controlado de backup US24");
  expect(await customers("Viva tras backup falla US24")).toHaveLength(1);
  expect(await readFile(await currentDatabasePath())).toEqual(currentBefore);
  expect(await recoveryFiles()).toHaveLength(0);
  await assertNoStaging();
});

test("recovery-copy validation failure does not close or alter the live database", async () => {
  await createBackup();
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Viva tras validación recuperación US24",
      phone: "1155002413",
    }),
  );
  const currentBefore = await readFile(await currentDatabasePath());
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  await injectRecoveryValidationFailure();
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).toContain("integrity_check: fallo de recuperación US24");
  expect(
    await customers("Viva tras validación recuperación US24"),
  ).toHaveLength(1);
  expect(await readFile(await currentDatabasePath())).toEqual(currentBefore);
  expect(await recoveryFiles()).toHaveLength(0);
  await assertNoStaging();
});

test("source changed while confirmation is open restores the staged bytes, not the changed file", async () => {
  await createBackup();
  const expectedBytes = await readFile(backup);
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Actual durante confirmación US24",
      phone: "1155002414",
    }),
  );
  await stubNativeDialogs({ source: backup, deferConfirmation: true });
  await page.evaluate(() => {
    (window as any).__restoreInFlight = window.gastronomy.restoreBackup();
  });
  await expect
    .poll(
      async () =>
        (await app.evaluate(() => (globalThis as any).__us24DialogCalls))
          .length,
    )
    .toBe(1);
  const resolvePath = await app.evaluate(
    ({ app }, { profile }) => {
      if (app.getPath("userData") !== profile) throw new Error("Wrong profile");
      return (globalThis as any).__us24ResolveConfirmation !== undefined;
    },
    { profile },
  );
  expect(resolvePath).toBe(true);
  await writeFile(backup, "source changed after staging");
  await app.evaluate(() =>
    (globalThis as any).__us24ResolveConfirmation({ response: 1 }),
  );
  const result = await page.evaluate(() => (window as any).__restoreInFlight);
  expect(result.restored).toBe(true);
  expect(await customers("Registro anterior US24")).toHaveLength(1);
  expect(await customers("Actual durante confirmación US24")).toHaveLength(0);
  expect(await readFile(await currentDatabasePath())).not.toEqual(
    await readFile(backup),
  );
  // The fixture's source was changed intentionally; the helper must restore the pre-confirmation staged copy.
  const sqlite = await currentDatabasePath();
  expect((await readFile(sqlite)).length).toBeGreaterThan(0);
  expect(expectedBytes.length).toBeGreaterThan(0);
  await assertNoStaging();
});

test("an open cash session is disclosed in confirmation but does not block restore", async () => {
  await createBackup();
  await page.evaluate(() =>
    window.gastronomy.openCashSession({ openingAmountMinor: 10_000 }),
  );
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  const result = await page.evaluate(() => window.gastronomy.restoreBackup());
  expect(result.restored).toBe(true);
  const calls = await app.evaluate(() => (globalThis as any).__us24DialogCalls);
  expect(calls[0].type).toBe("warning");
  expect(calls[0].detail).toMatch(/caja abierta/i);
  const info = calls.find((call: any) => call.type === "info");
  expect(info).toBeTruthy();
  const [recoveryPath] = await recoveryFiles();
  expect(String(info.message + info.detail)).toContain(recoveryPath);
  expect((await readFile(recoveryPath)).length).toBeGreaterThan(0);
  await page.screenshot({
    path: join(out, "restore-open-cash-result.png"),
    fullPage: true,
  });
});

test("a closed cash session does not add an open-cash warning", async () => {
  await createBackup();
  await stubNativeDialogs({ source: backup, confirmResult: 0 });
  await page.evaluate(() => window.gastronomy.restoreBackup());
  const calls = await app.evaluate(() => (globalThis as any).__us24DialogCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].detail).not.toMatch(/caja abierta/i);
});

test("live database cannot be selected as its own restore source", async () => {
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "No restaurar base viva US24",
      phone: "1155002415",
    }),
  );
  const live = await currentDatabasePath();
  await stubNativeDialogs({ source: live, confirmResult: 1 });
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).toMatch(/no se puede|elegí|copia guardada/i);
  expect(await customers("No restaurar base viva US24")).toHaveLength(1);
  expect(
    await app.evaluate(() => (globalThis as any).__us24DialogCalls),
  ).toEqual([]);
});

test("restore is single-flight and refuses other IPC writes until confirmation resolves", async () => {
  await createBackup();
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Bloqueo escritor US24",
      phone: "1155002416",
    }),
  );
  await stubNativeDialogs({ source: backup, deferConfirmation: true });
  await page.evaluate(() => {
    (window as any).__restoreInFlight = window.gastronomy.restoreBackup();
  });
  await expect
    .poll(
      async () =>
        (await app.evaluate(() => (globalThis as any).__us24DialogCalls))
          .length,
    )
    .toBe(1);
  const second = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(second).not.toBe("UNEXPECTED_SUCCESS");
  const writeFailure = await page.evaluate(async () => {
    try {
      await window.gastronomy.createCustomer({
        name: "Escritura rechazada US24",
        phone: "1155002417",
      });
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(writeFailure).not.toBe("UNEXPECTED_SUCCESS");
  expect(
    await customerInSqlite(
      await currentDatabasePath(),
      "Escritura rechazada US24",
    ),
  ).toBeFalsy();
  await app.evaluate(() =>
    (globalThis as any).__us24ResolveConfirmation({ response: 0 }),
  );
  const first = await page.evaluate(() => (window as any).__restoreInFlight);
  expect(first.restored).toBe(false);
  expect(await customers("Escritura rechazada US24")).toHaveLength(0);
  expect(await customers("Bloqueo escritor US24")).toHaveLength(1);
  expect(
    await app.evaluate(() => (globalThis as any).__us24DialogCalls),
  ).toHaveLength(1);
});

test("each successful restore keeps a separate intact recovery snapshot", async () => {
  await createBackup();
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Estado antes de segundo restore US24",
      phone: "1155002418",
    }),
  );
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  const first = await page.evaluate(() => window.gastronomy.restoreBackup());
  expect(first.restored).toBe(true);
  const firstSnapshot = (await recoveryFiles())[0];
  const firstSnapshotBytes = await readFile(firstSnapshot);
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Estado antes del tercero US24",
      phone: "1155002419",
    }),
  );
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  const second = await page.evaluate(() => window.gastronomy.restoreBackup());
  expect(second.restored).toBe(true);
  const snapshots = await recoveryFiles();
  expect(snapshots).toHaveLength(2);
  expect(snapshots).toContain(firstSnapshot);
  const secondSnapshot = snapshots.find((path) => path !== firstSnapshot)!;
  expect(await readFile(firstSnapshot)).toEqual(firstSnapshotBytes);
  expect(
    await customerInSqlite(
      firstSnapshot,
      "Estado antes de segundo restore US24",
    ),
  ).toBeTruthy();
  expect(
    await customerInSqlite(secondSnapshot, "Estado antes del tercero US24"),
  ).toBeTruthy();
  await assertNoStaging();
});

test("a retained recovery database can itself be selected to restore the previous current state", async () => {
  await createBackup();
  await page.evaluate(() =>
    window.gastronomy.createCustomer({
      name: "Dato recuperable US24",
      phone: "1155002420",
    }),
  );
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  expect(
    (await page.evaluate(() => window.gastronomy.restoreBackup())).restored,
  ).toBe(true);
  expect(await customers("Dato recuperable US24")).toHaveLength(0);
  const [recovery] = await recoveryFiles();
  expect(
    await customerInSqlite(recovery, "Dato recuperable US24"),
  ).toBeTruthy();
  await stubNativeDialogs({ source: recovery, confirmResult: 1 });
  expect(
    (await page.evaluate(() => window.gastronomy.restoreBackup())).restored,
  ).toBe(true);
  expect(await customers("Dato recuperable US24")).toHaveLength(1);
  const snapshots = await recoveryFiles();
  expect(snapshots).toHaveLength(2);
  await assertNoStaging();
});

test("restore refuses to start while an existing backup operation is active", async () => {
  const backupDestination = join(profile, "deferred-backup.sqlite");
  await app.evaluate(
    ({ app, dialog }, { profile, backupDestination }) => {
      const path = process.getBuiltinModule("path");
      if (
        path.resolve(app.getPath("userData")) !== path.resolve(profile) ||
        path.dirname(path.resolve(backupDestination)) !== path.resolve(profile)
      )
        throw new Error("Backup destination outside disposable profile");
      (globalThis as any).__us24ResolveSave = undefined;
      dialog.showSaveDialog = async () =>
        await new Promise((resolve) => {
          (globalThis as any).__us24ResolveSave = resolve;
        });
    },
    { profile, backupDestination },
  );
  await page.evaluate(() => {
    (window as any).__backupInFlight = window.gastronomy.createBackup();
  });
  await expect
    .poll(() =>
      app.evaluate(() => Boolean((globalThis as any).__us24ResolveSave)),
    )
    .toBe(true);
  await stubNativeDialogs({ source: backup, confirmResult: 1 });
  const failure = await page.evaluate(async () => {
    try {
      await window.gastronomy.restoreBackup();
      return "UNEXPECTED_SUCCESS";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).toMatch(/operación actual|esperá/i);
  expect(
    await app.evaluate(() => (globalThis as any).__us24DialogCalls),
  ).toEqual([]);
  await app.evaluate(
    (_electron, { backupDestination }) => {
      (globalThis as any).__us24ResolveSave({
        canceled: false,
        filePath: backupDestination,
      });
    },
    { backupDestination },
  );
  await page.evaluate(() => (window as any).__backupInFlight);
});
