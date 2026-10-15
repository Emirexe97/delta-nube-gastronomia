// Operator only. Password arrives over stdin, never argv/stdout or Git.
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPanelPassword } from "../dist/panel-auth.js";

const file = process.argv[2];
const repo = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const within = (root, candidate) => {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
};
if (!file || !isAbsolute(file) || within(repo, resolve(file)))
  throw new Error(
    "Specify an absolute private destination outside the repository",
  );
const chunks = [];
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 1026) throw new Error("Password input exceeds limit");
  chunks.push(chunk);
}
const password = Buffer.concat(chunks)
  .toString("utf8")
  .replace(/\r?\n$/, "");
const hash = await hashPanelPassword(password);
await mkdir(dirname(file), { recursive: true, mode: 0o700 });
// Resolve junctions/symlinks as well as Windows case aliases before any secret write.
const physicalParent = await realpath(dirname(file));
if (within(await realpath(repo), physicalParent))
  throw new Error("Private destination resolves inside the repository");
await writeFile(file, hash + "\n", { mode: 0o600, flag: "wx" });
if ((await readFile(file, "utf8")).trim() !== hash)
  throw new Error("Password hash verification failed");
console.log(
  "Private panel password hash created. Existing files are never overwritten.",
);
