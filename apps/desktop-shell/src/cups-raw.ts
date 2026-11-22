import { spawn } from "node:child_process";

const LP_PATH = "/usr/bin/lp";
const JOB_TITLE = "Delta Nube - Ticket";
const MAX_STDERR_CHARS = 2_000;

type SpawnLike = typeof spawn;

function validateDestination(deviceName: string) {
  if (!deviceName || !deviceName.trim()) {
    throw new Error("La impresora CUPS requiere un destino explícito.");
  }
  // CUPS destination names cannot contain whitespace, slash, or '#'. Reject a
  // leading dash too, so a malformed name can never be parsed as an lp option.
  if (
    deviceName.startsWith("-") ||
    /[\u0000-\u0020\u007f\s/#]/u.test(deviceName)
  ) {
    throw new Error("El destino de impresión CUPS no es válido.");
  }
}

export async function printCupsRaw(
  deviceName: string,
  data: Buffer,
  spawnProcess: SpawnLike = spawn,
): Promise<void> {
  validateDestination(deviceName);

  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<SpawnLike>;
    try {
      child = spawnProcess(
        LP_PATH,
        [
          "-d",
          deviceName,
          "-o",
          "raw",
          "-o",
          "job-sheets=none,none",
          "-n",
          "1",
          "-t",
          JOB_TITLE,
          "-",
        ],
        { shell: false, stdio: ["pipe", "ignore", "pipe"] },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(new Error(`No se pudo iniciar lp: ${detail}`));
      return;
    }

    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length);
      }
    });
    child.once("error", (error) =>
      fail(new Error(`No se pudo iniciar lp: ${error.message}`)),
    );
    child.stdin?.once("error", (error) =>
      fail(new Error(`No se pudo enviar el ticket a CUPS: ${error.message}`)),
    );
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(
          `CUPS rechazó el trabajo${code === null ? ` (señal ${signal ?? "desconocida"})` : ` (código ${code})`}${detail ? `: ${detail}` : "."}`,
        ),
      );
    });

    if (!child.stdin) {
      fail(new Error("No se pudo abrir la entrada binaria de CUPS."));
      child.kill();
      return;
    }
    child.stdin.end(data);
  });
}
