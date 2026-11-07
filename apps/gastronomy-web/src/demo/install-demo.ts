export const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

export async function installDemoApi() {
  if (isDemoMode && !window.gastronomy) {
    const { createDemoApi } = await import("./demo-api");
    window.gastronomy = createDemoApi();
  }
}
