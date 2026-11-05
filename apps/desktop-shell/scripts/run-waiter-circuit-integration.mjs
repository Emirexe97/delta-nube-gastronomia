import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const electronRequire = createRequire(resolve(appRoot, "package.json"));
const databaseRequire = createRequire(
  resolve(appRoot, "../../packages/database/package.json"),
);
const electron = electronRequire("electron");
const tsxLoader = databaseRequire.resolve("tsx");
const testFile = resolve(appRoot, "src/waiter-circuit.integration.ts");
const child = spawn(
  electron,
  ["--import", pathToFileURL(tsxLoader).href, "--test", testFile],
  {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  },
);

child.on("error", (error) => {
  process.stderr.write(
    `No se pudo iniciar Electron para la prueba de integración: ${error.message}\n`,
  );
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
