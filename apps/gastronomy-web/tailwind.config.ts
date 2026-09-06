import type { Config } from "tailwindcss";
import { deltaNubeTailwindPreset } from "@gastronomy/ui/preset";

export default {
  presets: [deltaNubeTailwindPreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: { extend: { boxShadow: { soft: "0 18px 50px -30px rgba(15,23,42,.45)" } } },
  plugins: []
} satisfies Config;
