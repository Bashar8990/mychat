"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [setupKey, setSetupKey] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const createAdmin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("كلمتا السر غير متطابقتين.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupKey, username, displayName, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error || "تعذر إنشاء المدير.");
        return;
      }
      setDone(true);
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#1c1c1e] flex items-center justify-center px-6" dir="rtl">
      <section className="w-full max-w-sm bg-white rounded-[20px] p-6 shadow-xl">
        <h1 className="text-center text-2xl font-bold text-black">الإعداد الأولي</h1>
        <p className="text-center text-sm text-zinc-500 mt-1 mb-6">أنشئ مدير العائلة مرة واحدة</p>
        {done ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-green-50 p-4 text-sm text-green-800" role="status">تم إنشاء المدير بنجاح.</div>
            <button onClick={() => router.push("/login")} className="w-full h-12 rounded-xl bg-black text-white font-semibold">الانتقال لتسجيل الدخول</button>
          </div>
        ) : (
          <form onSubmit={createAdmin} className="space-y-4">
            <Field label="مفتاح الإعداد" value={setupKey} onChange={setSetupKey} type="password" required />
            <Field label="اسم المستخدم" value={username} onChange={setUsername} placeholder="admin" required />
            <Field label="الاسم الظاهر" value={displayName} onChange={setDisplayName} placeholder="مدير العائلة" required />
            <Field label="كلمة السر" value={password} onChange={setPassword} type="password" minLength={8} required />
            <Field label="تأكيد كلمة السر" value={confirmPassword} onChange={setConfirmPassword} type="password" minLength={8} required />
            {error && <div className="text-sm text-red-700 bg-red-50 p-3 rounded-xl" role="alert">{error}</div>}
            <button disabled={loading} className="w-full h-12 rounded-xl bg-black text-white font-semibold disabled:opacity-50">{loading ? "جار الإنشاء…" : "إنشاء المدير"}</button>
            <button type="button" onClick={() => router.push("/login")} className="w-full text-sm text-zinc-500">رجوع لتسجيل الدخول</button>
          </form>
        )}
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = "text", placeholder, minLength, required }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; minLength?: number; required?: boolean }) {
  const id = `setup-${label}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-zinc-700">{label}</label>
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} minLength={minLength} required={required} className="mt-1 w-full h-12 rounded-xl border border-zinc-200 px-4 text-black outline-none focus:border-black" />
    </div>
  );
}
