import { launchConfiguredPos } from "./pos-fixture";
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const slug = "bonis";
const url = `https://${slug}.deltanubeweb.com`;

test("comercio activo abre, copia y descarga su QR; respeta la cancelación", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(join(tmpdir(), "gastronomy-website-share-"));
  const output = join(userData, "share");
  await mkdir(output);
  let app: ElectronApplication | undefined;
  let server: Server | undefined;
  try {
    server = createServer((_req, res) => {
      res.writeHead(503);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        server!.off("error", reject);
        resolve();
      });
    });
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const launch = () =>
      launchConfiguredPos({
        args: ["apps/desktop-shell", `--user-data-dir=${userData}`],
        cwd: process.cwd(),
        env: {
          ...process.env,
          GASTRONOMY_WEB_PROVISION_URL: baseUrl,
          GASTRONOMY_WEB_ORDERS_URL: "",
          GASTRONOMY_WEB_ORDERS_TOKEN: "",
          GASTRONOMY_WEB_ORDERS_STORE_ID: "",
        },
      });

    // Create the fixture with Electron's actual OS-backed safeStorage, then let
    // the real provisioner load that persisted state on a fresh app launch.
    app = await launch();
    await app.firstWindow(); // safeStorage is ready only after Electron finishes startup.
    const encryptedCredential = await app.evaluate(({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Electron safeStorage unavailable in E2E environment");
      return safeStorage
        .encryptString(
          JSON.stringify({ storeId: "bonis", receiveToken: "t".repeat(64) }),
        )
        .toString("base64");
    });
    await app.close();
    app = undefined;
    await writeFile(
      join(userData, "web-site-state.json"),
      JSON.stringify({
        schema: 2,
        status: {
          state: "ACTIVE",
          slug,
          url,
          displayName: "Bonis",
          tagline: "Pizza de la casa",
          accent: "#773311",
          designMode: "STANDARD",
          message: "Tienda web lista",
        },
        encryptedCredential,
        encryptedSignup: null,
      }),
    );

    app = await launch();
    const page: Page = await app.firstWindow();
    await app.evaluate(
      ({ app: electronApp, clipboard, dialog, shell }, savePath) => {
        const state = {
          opened: [] as string[],
          copied: [] as string[],
          dialogPaths: [] as string[],
          cancelNext: false,
        };
        shell.openExternal = async (target: string) => {
          state.opened.push(target);
        };
        clipboard.writeText = (value: string) => {
          state.copied.push(value);
        };
        dialog.showSaveDialog = async () => {
          if (state.cancelNext) {
            state.cancelNext = false;
            return { canceled: true, filePath: "" };
          }
          state.dialogPaths.push(savePath);
          return { canceled: false, filePath: savePath };
        };
        (
          electronApp as typeof electronApp & { __shareCalls?: typeof state }
        ).__shareCalls = state;
        return state;
      },
      join(output, "bonis-qr.png"),
    );
    // Keep native APIs at the OS boundary mocked; do not use the host clipboard,
    // browser, or a real save dialog during the test.
    await page.getByRole("link", { name: "Configuración" }).click();
    await page.getByRole("tab", { name: "Página web", exact: true }).click();
    await expect(
      page.locator("#settings-website").getByText("Activa", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Abrir carta" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copiar enlace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Descargar QR" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Abrir carta" }).click();
    await expect(
      page.locator("#settings-website").getByRole("status"),
    ).toHaveText("Carta abierta en el navegador.");
    await page.getByRole("button", { name: "Copiar enlace" }).click();
    await expect(
      page.locator("#settings-website").getByRole("status"),
    ).toHaveText("Enlace copiado.");
    await page.getByRole("button", { name: "Descargar QR" }).click();
    await expect(
      page.locator("#settings-website").getByRole("status"),
    ).toHaveText("Código QR descargado.");
    const saved = await readFile(join(output, "bonis-qr.png"));
    expect(saved.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(saved.length).toBeGreaterThan(100);
    const { decodeWebSiteQr } =
      await import("../../apps/desktop-shell/test/verify-website-qr.mjs");
    expect(decodeWebSiteQr(saved)).toBe(url);

    await app.evaluate(({ app: electronApp }) => {
      (
        electronApp as typeof electronApp & {
          __shareCalls?: { cancelNext: boolean };
        }
      ).__shareCalls!.cancelNext = true;
    });
    await page.getByRole("button", { name: "Descargar QR" }).click();
    await expect(
      page.getByRole("button", { name: "Descargar QR" }),
    ).toBeEnabled();
    await expect(
      page.locator("#settings-website").getByRole("status"),
    ).toHaveCount(0);
    const captured = await app.evaluate(
      ({ app: electronApp }) =>
        (
          electronApp as typeof electronApp & {
            __shareCalls: {
              opened: string[];
              copied: string[];
              dialogPaths: string[];
            };
          }
        ).__shareCalls,
    );
    expect(captured.opened).toEqual([url]);
    expect(captured.copied).toEqual([url]);
    expect(captured.dialogPaths).toEqual([join(output, "bonis-qr.png")]);
  } finally {
    await app
      ?.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      )
      .catch(() => {});
    await app?.close();
    if (server?.listening)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 6,
      retryDelay: 150,
    });
  }
});
