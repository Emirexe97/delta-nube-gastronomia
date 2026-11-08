import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("first-run PIN gates the POS and cash audit identifies the actual authorizer after restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-first-pin-security-"));
  const launch = () => _electron.launch({args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    env: {...process.env, GASTRONOMY_ADMIN_PIN: "1234", GASTRONOMY_LOCAL_PILOT: "0"}});
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.getByRole("heading", {name:"Configurá el PIN del administrador"})).toBeVisible();
    await expect(page.evaluate(() => window.gastronomy.openCashSession({openingAmountMinor: 10000}))).rejects.toThrow(/PIN inicial/i);
    await page.getByLabel("PIN actual", {exact:true}).fill("1234");
    await page.getByLabel("PIN nuevo", {exact:true}).fill("748259");
    await page.getByLabel("Repetí el PIN nuevo").fill("748259");
    await page.getByRole("button", {name:"Guardar PIN y continuar"}).click();
    await expect(page.getByRole("link", {name:"Caja",exact:true})).toBeVisible();
    await app.close();
    app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole("link", {name:"Caja", exact:true})).toBeVisible();
    const rows = await page.evaluate(async () => {
      const api = window.gastronomy;
      await api.createUser({fullName:"Encargada de turno QA",roleCode:"MANAGER",pin:"609713",authorizerPin:"748259"});
      await api.openCashSession({openingAmountMinor:10000});
      for (const [type,amountMinor] of [["WITHDRAWAL",700],["ADJUSTMENT",-500],["EXPENSE",300]] as const) {
        await api.registerCashMovement({type,amountMinor,reason:"Control QA",authorizerPin:"609713"});
      }
      return api.getAuditLog({limit:25});
    });
    for (const action of ["CASH_WITHDRAWAL","CASH_ADJUSTMENT","CASH_EXPENSE"]) {
      expect(rows.find(r => r.action === action)?.authorizerName, action).toBe("Encargada de turno QA");
    }
  } finally {
    await app.close();
    await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
});
