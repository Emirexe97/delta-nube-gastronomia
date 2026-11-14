import { cp, mkdir } from "node:fs/promises";
const source = new URL("../panel/", import.meta.url);
const target = new URL("../dist/panel/", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
const publicSource = new URL("../public/", import.meta.url);
const publicTarget = new URL("../dist/public/", import.meta.url);
await mkdir(publicTarget, { recursive: true });
await cp(publicSource, publicTarget, { recursive: true });
