import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: "إعدادات الخادم غير مكتملة." }, { status: 500 });
  }

  const adminClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: admins, error } = await adminClient
    .from("profiles")
    .select("id, auth_user_id")
    .eq("role", "admin")
    .limit(10);

  if (error) return NextResponse.json({ error: "تعذر التحقق من حالة الإعداد." }, { status: 500 });
  return NextResponse.json({ configured: Boolean(admins?.some((profile) => Boolean(profile.auth_user_id))) });
}
