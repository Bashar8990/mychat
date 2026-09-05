"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const handleInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;
    let reloading = false;
    let registration: ServiceWorkerRegistration | null = null;

    const showUpdate = () => {
      if (!disposed && navigator.serviceWorker.controller && registration) {
        setUpdateRegistration(registration);
        setUpdateAvailable(true);
      }
    };

    const watchInstallingWorker = () => {
      const worker = registration?.installing;
      if (!worker) return;
      const handleStateChange = () => {
        if (worker.state !== "installed") return;
        worker.removeEventListener("statechange", handleStateChange);
        showUpdate();
      };
      worker.addEventListener("statechange", handleStateChange);
    };

    const checkForUpdate = () => {
      if (registration) void registration.update();
    };

    const setupServiceWorker = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js");
        if (disposed) return;
        setUpdateRegistration(registration);
        registration.addEventListener("updatefound", watchInstallingWorker);
        if (registration.waiting) showUpdate();
        checkForUpdate();
      } catch {
        // The app remains usable without an offline service worker.
      }
    };

    const handleControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const handleFocus = () => checkForUpdate();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void setupServiceWorker();

    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", watchInstallingWorker);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  if (!installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstallEvent(null);
  };

  const update = () => {
    const waitingWorker = updateRegistration?.waiting;
    if (!waitingWorker) {
      setUpdateAvailable(false);
      void updateRegistration?.update();
      return;
    }
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <>
      {updateAvailable && (
        <div className="fixed top-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-[#075e54] px-4 py-3 text-white shadow-2xl" dir="rtl" role="status" aria-live="polite">
          <div>
            <div className="text-sm font-semibold">تحديث جديد متوفر</div>
            <div className="text-xs text-emerald-100">حدّث التطبيق للحصول على آخر تحسينات</div>
          </div>
          <button onClick={update} className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#075e54]">تحديث الآن</button>
        </div>
      )}
      {installEvent && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-black px-4 py-3 text-white shadow-2xl" dir="rtl">
          <div>
            <div className="text-sm font-semibold">ثبّت MyChat على جهازك</div>
            <div className="text-xs text-zinc-300">وصول أسرع وتجربة أفضل</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setInstallEvent(null)} className="text-xs text-zinc-300" aria-label="إغلاق رسالة التثبيت">لاحقًا</button>
            <button onClick={install} className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black">تثبيت</button>
          </div>
        </div>
      )}
    </>
  );
}
