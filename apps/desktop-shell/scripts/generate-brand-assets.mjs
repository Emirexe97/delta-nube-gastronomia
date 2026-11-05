// Maintainer task: regenerate only brand assets, never a release or an installer.
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = fileURLToPath(new URL("../", import.meta.url));
const source = join(shell, "../gastronomy-portal/public/portal-assets");
const renderer = join(shell, "../gastronomy-web/src/assets/brand");
const native = join(shell, "build/icons");
// Use the same pinned encoder as electron-builder (no image editor or OS-specific SDK).
const require = createRequire(import.meta.url);
const builderRequire = createRequire(
  require.resolve("electron-builder/package.json"),
);
const { runIconsTool } = builderRequire("app-builder-lib/out/toolsets/icons");
const temp = await mkdtemp(join(tmpdir(), "gastronomy-brand-"));
try {
  await Promise.all([
    mkdir(renderer, { recursive: true }),
    mkdir(native, { recursive: true }),
  ]);
  for (const part of ["simbolo.png", "marca.png"]) {
    await copyFile(join(source, part), join(renderer, part));
  }
  const symbol = await readFile(join(source, "simbolo.png"));
  // The supplied 248px tile was on white paper. Clip only its exterior corners;
  // the white cloud, orange cutlery and original pixels inside are untouched.
  const wrap = (
    viewBox,
  ) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="${viewBox}">
    <defs><clipPath id="tile"><rect x="0.75" y="0.75" width="246.5" height="246.5" rx="55"/></clipPath></defs>
    <image width="248" height="248" clip-path="url(#tile)" xlink:href="data:image/png;base64,${symbol.toString("base64")}"/>
  </svg>`;
  for (const [format, name, viewBox] of [
    ["set", "256x256.png", "0 0 248 248"],
    ["ico", "icon.ico", "0 0 248 248"],
    // Give the macOS Dock icon its usual optical margin on a transparent canvas.
    ["icns", "icon.icns", "-25 -25 298 298"],
  ]) {
    const outDir = join(temp, format);
    await mkdir(outDir);
    const inputFile = join(outDir, "symbol.svg");
    await writeFile(inputFile, wrap(viewBox));
    await runIconsTool({ inputFile, outputFormat: format, outDir });
    await copyFile(
      join(outDir, name),
      join(native, "app-icon." + (format === "set" ? "png" : format)),
    );
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
