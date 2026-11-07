export async function initializeRenderer(options: {
  installApi: () => Promise<void>;
  renderApp: () => void;
  renderError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await options.installApi();
    options.renderApp();
    return true;
  } catch (error) {
    options.renderError(error);
    return false;
  }
}

export async function resetDemoAndReload(
  loadReset: () => Promise<() => void>,
  reload: () => void,
  reportError: (error: unknown) => void,
) {
  try {
    const reset = await loadReset();
    reset();
    reload();
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}
