"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

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

  if (!installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstallEvent(null);
  };

  return (
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
  );
}
