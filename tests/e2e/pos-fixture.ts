import { _electron } from "@playwright/test";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Existing operational journeys start after first-run setup. Security/onboarding
 * journeys launch Electron directly to exercise the pending state. */
export async function launchConfiguredPos(options: Parameters<typeof _electron.launch>[0]) {
  const dir = options?.args?.find(arg => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  const underTemp = dir && relative(resolve(tmpdir()), resolve(dir));
  if (!dir || !underTemp || underTemp === ".." || underTemp.startsWith(".." + sep) || isAbsolute(underTemp)) {
    throw new Error("Configured POS tests require a disposable profile inside the temporary directory.");
  }
  const app = await _electron.launch(options);
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.gastronomy?.isInitialAdminPinSetupRequired === "function");
    if (resolve(await app.evaluate(({ app }) => app.getPath("userData"))) !== resolve(dir)) {
      throw new Error("Electron is not using the requested test profile.");
    }
    if (await page.evaluate(() => window.gastronomy.isInitialAdminPinSetupRequired())) {
      await page.evaluate(() => window.gastronomy.setInitialAdminPin({currentPin: "1234", newPin: "748259"}));
      await page.reload();
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
