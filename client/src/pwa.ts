export function registerPwa(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        // Pull a fresh SW as soon as possible after deploy.
        void reg.update();
        if (reg.waiting) void reg.waiting.postMessage({ type: "SKIP_WAITING" });
      })
      .catch(() => undefined);
  });
}
