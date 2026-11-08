import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchConfiguredPos } from "./pos-fixture";

const requireDatabase = createRequire(resolve("packages/database/package.json"));
const nativeModule = requireDatabase.resolve("better-sqlite3-multiple-ciphers");
const bcryptModule = requireDatabase.resolve("bcryptjs");
let app: ElectronApplication;
let page: Page;
let profile: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-user-pin-responsive-"));
  app = await launchConfiguredPos({ args: ["apps/desktop-shell", `--user-data-dir=${profile}`], cwd: process.cwd() });
  page = await app.firstWindow();
  await app.evaluate(({ app }, { profile, nativeModule, bcryptModule }) => {
    const path = process.getBuiltinModule("path");
    if (path.resolve(app.getPath("userData")) !== path.resolve(profile)) throw new Error("Wrong disposable profile");
    const require = process.getBuiltinModule("module").createRequire(nativeModule);
    const Database = require(nativeModule);
    const bcrypt = require(bcryptModule);
    const db = new Database(path.join(profile, "gastronomy.sqlite"));
    try {
      const insert = db.prepare(`INSERT INTO users(id,staff_number,full_name,role_id,pin_hash,must_change_pin,active,created_at,updated_at)
        VALUES(?,?,?,'role-waiter',?,0,1,?,?)`);
      for (let i = 0; i < 12; i++) {
        const now = new Date().toISOString();
        insert.run(`pin-user-${i}`, 100 + i, `Usuario PIN QA ${i}`, bcrypt.hashSync(String(300000 + i), i < 3 ? 12 : 4), now, now);
      }
    } finally { db.close(); }
  }, { profile, nativeModule, bcryptModule });
  await page.reload();
  await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toBeVisible();
});

test.afterEach(async () => {
  try { await app?.close(); }
  finally { if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }); }
});

test("el proceso principal mantiene sus temporizadores mientras cambia un PIN entre muchos usuarios", async () => {
  await app.evaluate(() => {
    const state = { last: Date.now(), maxGap: 0, ticks: 0, timer: undefined as ReturnType<typeof setInterval> | undefined };
    state.timer = setInterval(() => {
      const now = Date.now(); state.maxGap = Math.max(state.maxGap, now - state.last); state.last = now; state.ticks++;
    }, 25);
    (globalThis as unknown as { pinHeartbeat: typeof state }).pinHeartbeat = state;
  });
  await page.evaluate(() => {
    const state = { done: false, error: "" };
    (window as unknown as { pinSave: typeof state }).pinSave = state;
    void window.gastronomy.updateUser({
      userId: "pin-user-0", roleCode: "WAITER", active: true, newPin: "629415",
      reason: "Actualizar acceso QA", authorizerPin: "748259",
    }).then(() => { state.done = true; }, error => { state.error = String(error); state.done = true; });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { pinSave: { done: boolean } }).pinSave.done), { timeout: 30000 }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { pinSave: { error: string } }).pinSave.error)).toBe("");
  const heartbeat = await app.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const state = (globalThis as unknown as { pinHeartbeat: { maxGap: number; ticks: number; timer: ReturnType<typeof setInterval> } }).pinHeartbeat;
    clearInterval(state.timer); return { maxGap: state.maxGap, ticks: state.ticks };
  });
  await test.info().attach("Main-process responsiveness", { body: JSON.stringify(heartbeat), contentType: "application/json" });
  expect(heartbeat.maxGap, "PIN cryptography must not stall the Electron main loop for half a second").toBeLessThan(500);
});

test("el cambio de PIN muestra avance, evita cierre y conserva el borrador si el PIN está repetido", async () => {
  await page.getByRole("link", { name: "Usuarios", exact: true }).click();
  await page.getByRole("button", { name: "Editar Usuario PIN QA 0", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Editar Usuario PIN QA 0", exact: true });
  await modal.getByLabel("Nuevo PIN (opcional)", { exact: true }).fill("629415");
  await modal.getByLabel("Motivo", { exact: true }).fill("Actualizar acceso QA");
  await modal.getByLabel("PIN de autorización", { exact: true }).fill("748259");
  await modal.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(modal.getByRole("status")).toHaveText("Guardando usuario…");
  await expect(modal.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(modal).toBeVisible();
  await expect(modal).not.toBeVisible({ timeout: 30000 });

  await page.getByRole("button", { name: "Editar Usuario PIN QA 0", exact: true }).click();
  await modal.getByLabel("Nuevo PIN (opcional)", { exact: true }).fill("748259");
  await modal.getByLabel("Motivo", { exact: true }).fill("Intento duplicado QA");
  await modal.getByLabel("PIN de autorización", { exact: true }).fill("748259");
  await modal.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(modal.getByText(/Ese PIN ya está asignado/)).toBeVisible({ timeout: 30000 });
  await expect(modal.getByLabel("Nuevo PIN (opcional)", { exact: true })).toHaveValue("748259");
  await expect(modal.getByLabel("Motivo", { exact: true })).toHaveValue("Intento duplicado QA");
  await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
});
