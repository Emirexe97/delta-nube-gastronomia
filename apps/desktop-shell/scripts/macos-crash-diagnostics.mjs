import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function summarizeCrash(text) {
  // IPS reports contain a one-line metadata JSON followed by the report JSON.
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    report = JSON.parse(text.slice(text.indexOf("\n") + 1));
  }
  const thread = report.threads?.[report.faultingThread];
  return {
    procName: report.procName,
    exception: report.exception,
    termination: report.termination,
    asi: report.asi,
    faultingThread: report.faultingThread,
    frames: thread?.frames?.slice(0, 15),
    images: report.usedImages?.map(({ name, arch }) => ({ name, arch })),
  };
}

export async function printRecentMacCrashes(since) {
  if (process.platform !== "darwin") return;
  // Only disposable GitHub runners call this helper, never user profiles.
  await new Promise((done) => setTimeout(done, 4000));
  for (const directory of [
    join(homedir(), "Library", "Logs", "DiagnosticReports"),
    "/Library/Logs/DiagnosticReports",
  ]) {
    try {
      const recent = [];
      for (const name of await readdir(directory)) {
        if (!name.endsWith(".ips")) continue;
        const path = join(directory, name);
        if ((await stat(path)).mtimeMs >= since - 10000) recent.push(path);
      }
      for (const path of recent.slice(-3)) {
        console.error(
          "Packaged Mac crash diagnostic:",
          JSON.stringify(summarizeCrash(await readFile(path, "utf8"))),
        );
      }
    } catch (error) {
      console.error(
        "Crash diagnostics unavailable:",
        error.code ?? error.message,
      );
    }
  }
}
