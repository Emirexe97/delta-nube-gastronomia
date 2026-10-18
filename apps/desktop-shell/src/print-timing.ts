import { performance } from "node:perf_hooks";

export type PrintTimingStage =
  "getPrinters" | "loadURL" | "layout" | "nativeprint";
export type PrintTimingOutcome = "success" | "error";
export type PrintTiming = {
  stage: PrintTimingStage;
  durationMs: number;
  outcome: PrintTimingOutcome;
  maxEventLoopDelayMs: number;
};
export type PrintTimingObserver = (timing: PrintTiming) => void;

/** Measures one stage. Diagnostics are best-effort and never alter the result. */
export async function measurePrintStage<T>(
  stage: PrintTimingStage,
  observer: PrintTimingObserver | undefined,
  operation: () => Promise<T>,
  resultOutcome?: (result: T) => PrintTimingOutcome,
): Promise<T> {
  const started = performance.now();
  let lastTick = started;
  let maxEventLoopDelayMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, now - lastTick - 100);
    lastTick = now;
  }, 100);
  timer.unref();
  let outcome: PrintTimingOutcome = "success";
  try {
    const result = await operation();
    if (resultOutcome) outcome = resultOutcome(result);
    return result;
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    const elapsedSinceLastTick = performance.now() - lastTick;
    maxEventLoopDelayMs = Math.max(
      maxEventLoopDelayMs,
      elapsedSinceLastTick - 100,
    );
    clearInterval(timer);
    try {
      observer?.({
        stage,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        outcome,
        maxEventLoopDelayMs: Math.max(0, Math.round(maxEventLoopDelayMs)),
      });
    } catch {
      // Timing collection is deliberately isolated from printing behavior.
    }
  }
}
