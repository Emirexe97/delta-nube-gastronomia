import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts", "src/print-preview-preload.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: [/^@gastronomy\//],
  external: ["electron", "better-sqlite3-multiple-ciphers"]
});
