import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PrintTiming, PrintTimingObserver } from "./print-timing";

const MAX_FILE_BYTES = 1_000_000;
const MAX_PENDING_RECORDS = 128;
const ACTIVE_FILE = "print-timing.jsonl";
const PREVIOUS_FILE = `${ACTIVE_FILE}.1`;

export type PrintDiagnostics = {
  start(): PrintTimingObserver;
  flush(): Promise<void>;
};

/** Creates a privacy-filtered, best-effort, bounded local timing logger. */
export function createPrintDiagnostics(directory: string): PrintDiagnostics {
  const activePath = join(directory, ACTIVE_FILE);
  const previousPath = join(directory, PREVIOUS_FILE);
  const pending: string[] = [];
  let draining: Promise<void> | undefined;

  const drain = async () => {
    try {
      await mkdir(directory, { recursive: true });
      while (pending.length) {
        const batch = pending.splice(0, MAX_PENDING_RECORDS);
        let activeSize = 0;
        try {
          activeSize = (await stat(activePath)).size;
        } catch {
          activeSize = 0;
        }
        let chunk = "";
        for (const line of batch) {
          const bytes = Buffer.byteLength(line);
          if (activeSize + Buffer.byteLength(chunk) + bytes > MAX_FILE_BYTES) {
            if (chunk) {
              await appendFile(activePath, chunk, "utf8");
              activeSize += Buffer.byteLength(chunk);
              chunk = "";
            }
            await rm(previousPath, { force: true });
            try {
              await rename(activePath, previousPath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            activeSize = 0;
          }
          if (bytes <= MAX_FILE_BYTES) chunk += line;
        }
        if (chunk) await appendFile(activePath, chunk, "utf8");
      }
    } catch {
      pending.length = 0;
      // Diagnostics must never affect the caller or printing.
    }
  };

  const scheduleDrain = () => {
    if (!draining) {
      draining = Promise.resolve()
        .then(drain)
        .finally(() => {
          draining = undefined;
          if (pending.length) scheduleDrain();
        });
    }
  };

  return {
    start() {
      const runId = randomUUID();
      return (timing: PrintTiming) => {
        if (pending.length >= MAX_PENDING_RECORDS) return;
        if (
          !timing ||
          !["getPrinters", "loadURL", "layout", "nativeprint"].includes(
            timing.stage,
          ) ||
          !["success", "error"].includes(timing.outcome) ||
          !Number.isFinite(timing.durationMs) ||
          !Number.isFinite(timing.maxEventLoopDelayMs) ||
          timing.maxEventLoopDelayMs < 0
        )
          return;
        const record = {
          runId,
          time: new Date().toISOString(),
          stage: timing.stage,
          durationMs: Math.max(0, Math.round(timing.durationMs)),
          outcome: timing.outcome,
          maxEventLoopDelayMs: Math.round(timing.maxEventLoopDelayMs),
        };
        try {
          pending.push(`${JSON.stringify(record)}\n`);
          scheduleDrain();
        } catch {
          // Ignore malformed values and serialization errors.
        }
      };
    },
    async flush() {
      while (draining || pending.length) {
        if (draining) await draining;
        else scheduleDrain();
      }
    },
  };
}
