import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const evidence = join(
  process.cwd(),
  "docs/qa/evidence/system-usability-background-fix-2026-10-07",
);

for (const width of [1100, 1366]) {
  test(`Oculto: tamaño, render y teclado conservados a ${width}px sin activar ventanas`, async () => {
    expect(process.env.GASTRONOMY_E2E_BACKGROUND).toBe("1");
    const profile = await mkdtemp(
      join(tmpdir(), "gastronomy-background-probe-"),
    );
    const app = await electron.launch({
      args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
      cwd: process.cwd(),
      timeout: 10_000,
    });
    try {
      const page = await app.firstWindow();
      await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
      expect(
        resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
      ).toBe(resolve(profile));
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]!.setSize(size, 820),
        width,
      );
      const windowState = () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => ({
            visible: window.isVisible(),
            focused: window.isFocused(),
            size: window.getSize(),
            throttling: window.webContents.getBackgroundThrottling(),
          })),
        );
      const before = await windowState();
      expect(before).toEqual([
        {
          visible: false,
          focused: false,
          size: [width, 820],
          throttling: false,
        },
      ]);
      const frameStarted = Date.now();
      expect(
        await page.evaluate(
          () =>
            new Promise<number>((done) => {
              let frames = 0;
              const next = () => {
                if (++frames === 3) done(frames);
                else requestAnimationFrame(next);
              };
              requestAnimationFrame(next);
            }),
        ),
      ).toBe(3);
      const threeFrameElapsedMs = Date.now() - frameStarted;
      const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
      await page.getByRole("link", { name: "Usuarios", exact: true }).click();
      await page.getByRole("button", { name: "Nuevo usuario" }).click();
      const dialog = page.getByRole("dialog", { name: "Nuevo usuario" });
      const name = dialog.getByLabel("Nombre completo");
      await name.focus();
      await page.keyboard.type("Segundo plano", { delay: 20 });
      await expect(name).toHaveValue("Segundo plano");
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await expect(name).toHaveValue("Segundo plan");
      await dialog.getByLabel("Número de usuario").focus();
      await page.keyboard.press("Tab");
      await expect(name).toBeFocused();
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
      await mkdir(evidence, { recursive: true });
      const pixels = await page.screenshot({
        path: join(evidence, `hidden-user-${width}.png`),
      });
      expect(pixels.byteLength).toBeGreaterThan(10_000);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
        baseline,
      );
      expect(await windowState()).toEqual(before);
      await writeFile(
        join(evidence, `hidden-user-${width}.json`),
        JSON.stringify(
          {
            before,
            after: await windowState(),
            typedExactly: true,
            keyboardTabAndEscape: true,
            unchangedData: true,
            screenshotBytes: pixels.byteLength,
            threeFrameElapsedMs,
          },
          null,
          2,
        ),
      );
    } finally {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      );
      await app.close();
      if (
        dirname(resolve(profile)) !== resolve(tmpdir()) ||
        !basename(profile).startsWith("gastronomy-background-probe-")
      )
        throw new Error("Unsafe profile cleanup");
      await rm(profile, { recursive: true, force: true });
    }
  });
}

test("Oculto: vista previa real y cancelación sin imprimir ni activar ventanas", async () => {
  expect(process.env.GASTRONOMY_E2E_BACKGROUND).toBe("1");
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-background-probe-"));
  const app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
    expect(
      resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    ).toBe(resolve(profile));
    await app.evaluate(({ app, BrowserWindow }) => {
      (app as any).__printCount = 0;
      const install = (window: any) => {
        window.webContents.getPrintersAsync = async () => [];
        window.webContents.print = (
          _options: unknown,
          callback: (ok: boolean) => void,
        ) => {
          (app as any).__printCount += 1;
          callback(true);
        };
      };
      app.on("browser-window-created", (_event, window) => install(window));
      BrowserWindow.getAllWindows().forEach(install);
    });
    const baseline = await page.evaluate(() => window.gastronomy.bootstrap());
    await page.evaluate(() => {
      void window.gastronomy
        .bootstrap()
        .then((data) =>
          window.gastronomy.testPrinter({
            kind: "CUSTOMER_BILL",
            settings: {
              ...data.settings,
              printing: {
                ...data.settings.printing,
                bill: { ...data.settings.printing.bill, mode: "SYSTEM_DIALOG" },
              },
            },
          }),
        )
        .then((result) => {
          (window as any).__printResult = result;
        });
    });
    await expect
      .poll(
        () =>
          app
            .windows()
            .filter((p) => p.url().includes("print-preview-controls")).length,
      )
      .toBe(1);
    const preview = app
      .windows()
      .find((p) => p.url().includes("print-preview-controls"))!;
    await expect(preview.getByText("PRUEBA DE IMPRESIÓN")).toBeVisible();
    const native = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        visible: w.isVisible(),
        focused: w.isFocused(),
        throttling: w.webContents.getBackgroundThrottling(),
      })),
    );
    expect(native).toEqual(
      Array(2).fill({ visible: false, focused: false, throttling: false }),
    );
    await mkdir(evidence, { recursive: true });
    const pixels = await preview.screenshot({
      path: join(evidence, "hidden-print-preview.png"),
    });
    expect(pixels.byteLength).toBeGreaterThan(10_000);
    await preview.getByRole("button", { name: "Cancelar" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__printResult))
      .toEqual({
        printed: false,
        message: "Impresión cancelada. No se imprimió nada.",
      });
    expect(await app.evaluate(({ app }) => (app as any).__printCount)).toBe(0);
    expect(await page.evaluate(() => window.gastronomy.bootstrap())).toEqual(
      baseline,
    );
    await writeFile(
      join(evidence, "hidden-print-preview.json"),
      JSON.stringify(
        {
          native,
          noPhysicalPrinting: true,
          canceled: true,
          unchangedData: true,
          screenshotBytes: pixels.byteLength,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
    );
    await app.close();
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-background-probe-")
    )
      throw new Error("Unsafe profile cleanup");
    await rm(profile, { recursive: true, force: true });
  }
});
