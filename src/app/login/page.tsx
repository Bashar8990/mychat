"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loginSupabase, getSession } from "@/lib/auth";
import { isVaultUnlocked } from "@/lib/vault";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isVaultUnlocked()) {
      router.replace("/");
      return;
    }
    if (getSession()) router.replace("/chat");
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const u = await loginSupabase(username.trim(), password);
    if (!u) {
      setError("اسم المستخدم أو كلمة السر غير صحيحة");
      return;
    }
    router.push("/chat");
  };

  return (
    <div className="min-h-[100dvh] bg-[#1c1c1e] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm bg-white rounded-[20px] p-6 shadow-xl">
        <h1 className="text-center text-2xl font-bold text-black mb-1">تسجيل الدخول</h1>
        <p className="text-center text-sm text-zinc-500 mb-6">خاص بالعائلة فقط</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-zinc-700">اسم المستخدم</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="مثال: ahmed"
              className="mt-1 w-full h-12 rounded-xl border border-zinc-200 px-4 text-black outline-none focus:border-black"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-zinc-700">كلمة السر</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              className="mt-1 w-full h-12 rounded-xl border border-zinc-200 px-4 text-black outline-none focus:border-black"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">{error}</div>}

          <button
            type="submit"
            className="w-full h-12 rounded-xl bg-black text-white font-semibold hover:bg-zinc-800 transition"
          >
            دخول
          </button>
        </form>

        <div className="mt-6 p-3 bg-zinc-50 rounded-xl text-xs text-zinc-600 leading-5">
          <div className="font-semibold">حسابات تجريبية:</div>
          <div>admin / 123456 (آدمن)</div>
          <div>ahmed / 123456</div>
          <div>mama / 123456</div>
        </div>

        <button
          onClick={() => router.push("/")}
          className="mt-4 w-full text-sm text-zinc-500 hover:text-black"
        >
          رجوع للآلة الحاسبة
        </button>
      </div>
    </div>
  );
}
