import { cp, mkdir } from "node:fs/promises";
const source = new URL("../panel/", import.meta.url);
const target = new URL("../dist/panel/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
