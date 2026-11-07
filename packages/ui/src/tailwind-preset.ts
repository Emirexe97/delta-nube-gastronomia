export const deltaNubeTailwindPreset = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--dn-font-sans)"],
        mono: ["JetBrains Mono", "Cascadia Code", "ui-monospace", "monospace"],
      },
      colors: {
        dn: {
          background: "var(--dn-color-background)",
          surface: "var(--dn-color-surface)",
          "surface-2": "var(--dn-color-surface-2)",
          text: "var(--dn-color-text)",
          body: "var(--dn-color-text-body)",
          muted: "var(--dn-color-text-muted)",
          border: "var(--dn-color-border)",
          primary: "var(--dn-color-primary)",
          "primary-hover": "var(--dn-color-primary-hover)",
          "primary-soft": "var(--dn-color-primary-soft)",
        },
        brand: {
          50: "#FFF7ED",
          100: "#FFEDD5",
          200: "#FED7AA",
          300: "#FDBA74",
          400: "#FB923C",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
          800: "#9A3412",
          900: "#7C2D12",
        },
      },
    },
  },
};
