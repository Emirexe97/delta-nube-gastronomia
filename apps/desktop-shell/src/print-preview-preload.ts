import { ipcRenderer } from "electron";

const bind = () => {
  const print = document.getElementById("print-preview-print");
  const cancel = document.getElementById("print-preview-cancel");
  const error = document.getElementById("print-preview-error");
  if (!print || !cancel || !error) return;
  const onPrint = () => {
    error.textContent = "";
    ipcRenderer.send("print-preview:print");
  };
  const onCancel = () => ipcRenderer.send("print-preview:cancel");
  const onError = (_event: Electron.IpcRendererEvent, message: string) => {
    error.textContent = message || "Falló la impresión.";
  };
  print.addEventListener("click", onPrint);
  cancel.addEventListener("click", onCancel);
  ipcRenderer.on("print-preview:error", onError);
  window.addEventListener(
    "unload",
    () => {
      print.removeEventListener("click", onPrint);
      cancel.removeEventListener("click", onCancel);
      ipcRenderer.removeListener("print-preview:error", onError);
    },
    { once: true },
  );
};

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", bind, { once: true });
else bind();
