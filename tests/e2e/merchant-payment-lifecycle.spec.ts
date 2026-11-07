import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

test("Bar del Puerto: recorrer el ciclo de $1.500 sin cambiar acceso ni registrar dinero", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  // A new authority, SQLite :memory:, ephemeral signing key and in-process PSP.
  const script = resolve(
    "apps/licensing-service/scripts/preview-merchants.mjs",
  );
  const child = spawn(process.execPath, [script, "--simular-cobros"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const closed = once(child, "exit");
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
  const waitFor = (predicate: () => boolean) =>
    expect.poll(predicate, { timeout: 10_000 }).toBe(true);
  try {
    await waitFor(() => /Contraseña temporal: \S+\r?\n/.test(output));
    const origin = output.match(
      /Consola: (http:\/\/127\.0\.0\.1:\d+)\/manage/,
    )![1];
    const external: string[] = [];
    await page.context().route("**/*", (route) => {
      const target = new URL(route.request().url()).origin;
      if (target === origin) return route.continue();
      external.push(target);
      return route.abort();
    });
    await page.goto(origin + "/manage/");
    await page.getByLabel("Usuario", { exact: true }).fill("owner-preview");
    await page
      .getByLabel("Contraseña", { exact: true })
      .fill(output.match(/Contraseña temporal: (\S+)/)![1]);
    await page.getByRole("button", { name: /Ingresar/ }).click();
    const row = (name: string) =>
      page.locator("#merchantsBody tr").filter({ hasText: name });
    const other = row("Café Aurora");
    await expect(other).toBeVisible();
    const control = await other.innerText();
    const detail = page.locator("#merchantDetail");
    const openBar = async () => {
      await row("Bar del Puerto")
        .getByRole("button", { name: "Ver detalle" })
        .click();
      await expect(
        detail.getByRole("heading", { name: "Bar del Puerto" }),
      ).toBeVisible();
    };
    await openBar();
    const effective = detail
      .locator(".merchant-status-card")
      .filter({ hasText: "ACCESO AL PROGRAMA" });
    const ledger = detail
      .locator(".merchant-status-card")
      .filter({ hasText: "COBRO REAL" });
    const history = detail.locator(".merchant-history");
    await expect(effective).toContainText("Activo");
    await expect(effective).toContainText("Vigente hasta");
    await expect(ledger).toContainText("Sin pagos registrados");
    const initial = await effective.innerText(),
      historyBefore = await history.innerText();
    const checkAccess = async () => {
      await expect(effective).toHaveText(initial, { useInnerText: true });
      await expect(ledger).toContainText("Sin pagos registrados");
      await expect(history).toHaveText(historyBefore, { useInnerText: true });
      await expect(other).toHaveText(control, { useInnerText: true });
    };
    await detail
      .getByRole("button", { name: "Crear enlace de adhesión de prueba" })
      .click();
    const form = page.getByRole("dialog");
    await form
      .getByLabel("Email del comprador de pruebas")
      .fill("comprador_prueba@testuser.com");
    await form.getByLabel("Precio mensual simulado (ARS)").fill("1500.00");
    await form.getByRole("button", { name: "Crear enlace sandbox" }).click();
    const card = detail.locator(".sandbox-card"),
      coverage = card.locator(".secondary-line");
    await expect(card.locator(".sandbox-status")).toHaveText(
      "Prueba: Pendiente",
    );
    await expect(coverage).toContainText(/1\.?500,00 mensuales/);
    await expect(coverage).toContainText("vigencia simulada pendiente");
    await expect(card.getByRole("link")).toHaveCount(0);
    await checkAccess();
    const reloadDetail = async () => {
      await page.reload();
      await openBar();
    };
    const payment = card.locator(".sandbox-payment-status");
    const command = async (cmd: string, marker: string) => {
      const offset = output.length;
      child.stdin.write(cmd + "\n");
      await waitFor(() => output.slice(offset).includes(marker));
      await reloadDetail();
      await checkAccess();
    };
    const send = (cmd: string) =>
      command(
        cmd,
        "Resultado simulado '" + cmd + "' aceptado por el webhook local",
      );
    await send("rechazar");
    await expect(payment).toContainText("Rechazado");
    await expect(card.locator(".sandbox-status")).toHaveText(
      "Prueba: Autorizada (prueba)",
    );
    await expect(coverage).toContainText("vigencia simulada pendiente");
    await send("aprobar");
    await expect(payment).toContainText("Aprobado");
    await expect(coverage).toHaveText(/vigencia simulada .*\d/);
    const credited = await coverage.innerText();
    await send("aprobar");
    await expect(coverage).toHaveText(credited);
    await send("reintegrar");
    await expect(payment).toContainText("Revertido");
    await expect(coverage).toContainText("vigencia simulada pendiente");

    const cancel = card.getByRole("button", { name: "Cancelar prueba" });
    page.once("dialog", (confirmation) => confirmation.dismiss());
    await cancel.click();
    await expect(cancel).toBeVisible();
    await reloadDetail();
    await expect(card.locator(".sandbox-status")).toHaveText(
      "Prueba: Autorizada (prueba)",
    );
    const confirmed = page.waitForEvent("dialog").then(async (d) => {
      const prompt = { type: d.type(), text: d.message() };
      await d.accept();
      return prompt;
    });
    const [prompt] = await Promise.all([confirmed, cancel.click()]);
    expect(prompt.type).toBe("confirm");
    expect(prompt.text).toContain("Bar del Puerto");
    await expect(card.locator(".sandbox-status")).toHaveText(
      "Prueba: Cancelada",
    );
    // An operator cannot produce another debit on the cancelled rehearsal.
    await command("aprobar", "La última adhesión está cancelada");
    await expect(card.locator(".sandbox-status")).toHaveText(
      "Prueba: Cancelada",
    );
    await expect(payment).toContainText("Revertido");
    await expect(coverage).toContainText("vigencia simulada pendiente");
    await expect(cancel).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: /Crear otro enlace/ }),
    ).toBeVisible();
    expect(external).toEqual([]);
    await detail.screenshot({
      path: testInfo.outputPath("bar-del-puerto-final.png"),
    });
  } finally {
    if (child.exitCode === null) {
      child.stdin.end("salir\n");
      if (
        !(await Promise.race([closed.then(() => true), delay(2_000, false)]))
      ) {
        child.kill();
        await closed;
      }
    }
  }
});
