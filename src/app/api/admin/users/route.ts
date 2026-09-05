import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CreateUserRequest = {
  username?: string;
  displayName?: string;
  password?: string;
};

type DeleteUserRequest = { profileId?: string };

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function getRequestUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization");
  if (!url || !anonKey || !authorization?.startsWith("Bearer ")) return null;

  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await authClient.auth.getUser(authorization.slice(7));
  return error || !data.user ? null : data.user;
}

function validateUserInput(body: CreateUserRequest) {
  const username = body.username?.trim().toLowerCase() || "";
  const displayName = body.displayName?.trim() || "";
  const password = body.password || "";
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) return { error: "اسم المستخدم يجب أن يكون 3-32 رمزًا إنجليزيًا." };
  if (displayName.length < 2 || displayName.length > 80) return { error: "الاسم الظاهر يجب أن يكون بين حرفين و80 حرفًا." };
  if (password.length < 8) return { error: "كلمة السر يجب أن تحتوي على 8 أحرف على الأقل." };
  return { username, displayName, password };
}

export async function POST(request: Request) {
  const adminClient = getAdminClient();
  if (!adminClient) return NextResponse.json({ error: "إعدادات الخادم غير مكتملة." }, { status: 500 });

  const requestUser = await getRequestUser(request);
  if (!requestUser) return NextResponse.json({ error: "يجب تسجيل الدخول أولًا." }, { status: 401 });
  const { data: adminProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("auth_user_id", requestUser.id)
    .single();
  if (profileError || adminProfile?.role !== "admin") return NextResponse.json({ error: "هذه العملية متاحة للمدير فقط." }, { status: 403 });

  let body: CreateUserRequest;
  try {
    body = await request.json() as CreateUserRequest;
  } catch {
    return NextResponse.json({ error: "البيانات غير صالحة." }, { status: 400 });
  }
  const input = validateUserInput(body);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const email = `${input.username}@mychat.local`;
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { username: input.username, display_name: input.displayName },
  });
  if (createError || !created.user) {
    const duplicate = createError?.message.toLowerCase().includes("already") || createError?.message.toLowerCase().includes("exist");
    return NextResponse.json({ error: duplicate ? "اسم المستخدم مستخدم مسبقًا." : "تعذر إنشاء المستخدم." }, { status: duplicate ? 409 : 400 });
  }

  const { data: profile, error: profileUpsertError } = await adminClient
    .from("profiles")
    .upsert({ auth_user_id: created.user.id, username: input.username, display_name: input.displayName, role: "member" }, { onConflict: "username" })
    .select("id, username, display_name, role, avatar_url")
    .single();
  if (profileUpsertError || !profile) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "تعذر تجهيز ملف المستخدم." }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      role: profile.role,
      avatarUrl: profile.avatar_url,
    },
  }, { status: 201 });
}

export async function DELETE(request: Request) {
  const adminClient = getAdminClient();
  if (!adminClient) return NextResponse.json({ error: "إعدادات الخادم غير مكتملة." }, { status: 500 });

  const requestUser = await getRequestUser(request);
  if (!requestUser) return NextResponse.json({ error: "يجب تسجيل الدخول أولًا." }, { status: 401 });
  const { data: adminProfile, error: adminProfileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("auth_user_id", requestUser.id)
    .single();
  if (adminProfileError || adminProfile?.role !== "admin") return NextResponse.json({ error: "هذه العملية متاحة للمدير فقط." }, { status: 403 });

  let body: DeleteUserRequest;
  try {
    body = await request.json() as DeleteUserRequest;
  } catch {
    return NextResponse.json({ error: "البيانات غير صالحة." }, { status: 400 });
  }
  if (!body.profileId) return NextResponse.json({ error: "المستخدم المطلوب غير محدد." }, { status: 400 });

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, auth_user_id, role")
    .eq("id", body.profileId)
    .single();
  if (profileError || !profile) return NextResponse.json({ error: "المستخدم غير موجود." }, { status: 404 });
  if (profile.role === "admin" || profile.auth_user_id === requestUser.id) {
    return NextResponse.json({ error: "لا يمكن حذف المدير الحالي." }, { status: 400 });
  }

  const { data: memberships, error: membershipsError } = await adminClient
    .from("conversation_participants")
    .select("conversation_id, conversations!inner(is_group)")
    .eq("user_id", profile.id);
  if (membershipsError) return NextResponse.json({ error: "تعذر تجهيز محادثات المستخدم للحذف." }, { status: 500 });

  const privateConversationIds = (memberships || [])
    .filter((membership) => !(membership.conversations as { is_group?: boolean } | null)?.is_group)
    .map((membership) => membership.conversation_id);
  if (privateConversationIds.length > 0) {
    const { error: conversationsError } = await adminClient
      .from("conversations")
      .delete()
      .in("id", privateConversationIds);
    if (conversationsError) return NextResponse.json({ error: "تعذر حذف محادثات المستخدم." }, { status: 500 });
  }

  if (profile.auth_user_id) {
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(profile.auth_user_id);
    if (deleteAuthError) return NextResponse.json({ error: "تعذر حذف حساب المستخدم." }, { status: 400 });
  } else {
    const { error: deleteProfileError } = await adminClient.from("profiles").delete().eq("id", profile.id);
    if (deleteProfileError) return NextResponse.json({ error: "تعذر حذف المستخدم." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
