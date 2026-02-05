const SERVICE_WORKER_PATH = "/sw.js";

function shouldRegisterServiceWorker(): boolean {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (import.meta.env.PROD) return true;
  return import.meta.env.VITE_ENABLE_SW_IN_DEV === "true";
}

export function registerServiceWorker() {
  if (!shouldRegisterServiceWorker()) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => {
      // Development can run without service worker; keep failure silent.
    });
  });
}
