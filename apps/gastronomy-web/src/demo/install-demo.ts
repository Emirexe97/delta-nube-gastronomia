import { createDemoApi } from "./demo-api";

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

export function installDemoApi() {
  if (isDemoMode && !window.gastronomy) window.gastronomy = createDemoApi();
}
