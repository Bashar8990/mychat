"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginSupabase, getSession } from "@/lib/auth";
import { isVaultUnlocked } from "@/lib/vault";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      if (!isVaultUnlocked()) {
        router.replace("/");
        return;
      }
      if (await getSession()) router.replace("/chat");
      if (!cancelled) setLoading(false);
    };
    checkSession();
    return () => { cancelled = true; };
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const u = await loginSupabase(identifier, password);
      if (!u) {
        setError("بيانات الدخول غير صحيحة أو الحساب غير مرتبط بالتطبيق");
        return;
      }
      router.push("/chat");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-[100dvh] bg-[#1c1c1e]" aria-label="جار التحميل" />;

  return (
    <div className="min-h-[100dvh] bg-[#1c1c1e] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm bg-white rounded-[20px] p-6 shadow-xl">
        <h1 className="text-center text-2xl font-bold text-black mb-1">تسجيل الدخول</h1>
        <p className="text-center text-sm text-zinc-500 mb-6">خاص بالعائلة فقط</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="login-identifier" className="text-sm font-medium text-zinc-700">اسم المستخدم أو البريد الإلكتروني</label>
            <input
              id="login-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="مثال: ahmed أو name@example.com"
              className="mt-1 w-full h-12 rounded-xl border border-zinc-200 px-4 text-black outline-none focus:border-black"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-sm font-medium text-zinc-700">كلمة السر</label>
            <div className="relative mt-1">
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة السر"
                className="w-full h-12 rounded-xl border border-zinc-200 px-4 pl-16 text-black outline-none focus:border-black"
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500" aria-label={showPassword ? "إخفاء كلمة السر" : "إظهار كلمة السر"}>
                {showPassword ? "إخفاء" : "إظهار"}
              </button>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-black text-white font-semibold hover:bg-zinc-800 transition disabled:opacity-50"
          >
            {submitting ? "جار الدخول…" : "دخول"}
          </button>
        </form>

        <button
          onClick={() => router.push("/")}
          className="mt-4 w-full text-sm text-zinc-500 hover:text-black"
        >
          رجوع للآلة الحاسبة
        </button>
        <button
          onClick={() => router.push("/setup")}
          className="mt-3 w-full text-xs text-zinc-400 hover:text-black"
        >
          إعداد أول مدير
        </button>
      </div>
    </div>
  );
}
