"use client";

import { supabase } from "./supabase";

export type LocalUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  avatarUrl?: string | null;
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "member";
  avatar_url?: string | null;
};

const SYNTHETIC_EMAIL_DOMAIN = "mychat.local";

function loginEmail(identifier: string) {
  const value = identifier.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function toLocalUser(profile: ProfileRow): LocalUser {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    role: profile.role,
    avatarUrl: profile.avatar_url,
  };
}

async function profileForAuthUser(authUserId: string): Promise<LocalUser | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, avatar_url")
    .eq("auth_user_id", authUserId)
    .single();

  if (error || !data) return null;
  return toLocalUser(data as ProfileRow);
}

export async function loginSupabase(identifier: string, password: string): Promise<LocalUser | null> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail(identifier),
    password,
  });
  if (error || !data.user) return null;
  const profile = await profileForAuthUser(data.user.id);
  if (!profile) {
    await supabase.auth.signOut();
    return null;
  }
  return profile;
}

export async function getSession(): Promise<LocalUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return profileForAuthUser(data.user.id);
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function fetchProfiles(): Promise<LocalUser[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role, avatar_url")
    .order("display_name", { ascending: true });

  if (error || !data) return [];
  return (data as ProfileRow[]).map(toLocalUser);
}
