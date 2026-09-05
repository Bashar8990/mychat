import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SetupRequest = { username?: string; displayName?: string; password?: string };

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return NextResponse.json({ error: "إعدادات الخادم غير مكتملة." }, { status: 500 });

  let body: SetupRequest;
  try {
    body = await request.json() as SetupRequest;
  } catch {
    return NextResponse.json({ error: "البيانات غير صالحة." }, { status: 400 });
  }
  const username = body.username?.trim().toLowerCase() || "";
  const displayName = body.displayName?.trim() || "";
  const password = body.password || "";
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) || displayName.length < 2 || password.length < 8) {
    return NextResponse.json({ error: "تحقق من الاسم وكلمة السر (8 أحرف على الأقل)." }, { status: 400 });
  }

  const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: existingAdmins, error: countError } = await adminClient
    .from("profiles")
    .select("id, auth_user_id")
    .eq("role", "admin")
    .limit(10);
  if (countError) return NextResponse.json({ error: "تعذر التحقق من حالة الإعداد." }, { status: 500 });
  if (existingAdmins?.some((profile) => Boolean(profile.auth_user_id))) {
    return NextResponse.json({ error: "تم إعداد المدير مسبقًا. استخدم تسجيل الدخول." }, { status: 409 });
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: `${username}@mychat.local`,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  });
  if (createError || !created.user) return NextResponse.json({ error: "تعذر إنشاء المدير الأول." }, { status: 400 });

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .upsert({ auth_user_id: created.user.id, username, display_name: displayName, role: "admin" }, { onConflict: "username" })
    .select("id, username, display_name, role")
    .single();
  if (profileError || !profile) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "تعذر تجهيز ملف المدير." }, { status: 500 });
  }
  return NextResponse.json({ user: { id: profile.id, username: profile.username, displayName: profile.display_name, role: profile.role } }, { status: 201 });
}
