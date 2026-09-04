"use client";

import { supabase } from "./supabase";

export type LocalUser = {
  id: string;
  username: string;
  displayName: string;
  password: string;
  role: "admin" | "member";
};

const USERS_KEY = "mychat_users";
const SESSION_KEY = "mychat_session";

const DEFAULT_USERS: LocalUser[] = [
  { id: "f1762fbc-dbc4-4bc1-a6bd-e51882522124", username: "admin", displayName: "الآدمن", password: "123456", role: "admin" },
  { id: "6cfa85bb-4082-4a39-bafa-536bc181c8c5", username: "ahmed", displayName: "أحمد", password: "123456", role: "member" },
  { id: "085fdf93-5556-4c90-890f-3a1b3ace51ed", username: "mama", displayName: "ماما", password: "123456", role: "member" },
];

export function getUsers(): LocalUser[] {
  if (typeof window === "undefined") return DEFAULT_USERS;
  const raw = localStorage.getItem(USERS_KEY);
  if (!raw) {
    localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS;
  }
  try {
    const parsed = JSON.parse(raw) as LocalUser[];
    // migrate old ids "1","2","3" to UUIDs
    if (parsed.some((u) => u.id === "1" || u.id === "2" || u.id === "3")) {
      localStorage.setItem(USERS_KEY, JSON.stringify(DEFAULT_USERS));
      // also clear stale session
      const sess = localStorage.getItem(SESSION_KEY);
      if (sess && (sess.includes('"id":"1"') || sess.includes('"id":"2"') || sess.includes('"id":"3"'))) {
        localStorage.removeItem(SESSION_KEY);
      }
      return DEFAULT_USERS;
    }
    return parsed;
  } catch {
    return DEFAULT_USERS;
  }
}

export function saveUsers(users: LocalUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export async function loginSupabase(username: string, password: string): Promise<LocalUser | null> {
  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("username", username)
      .eq("password_hash", password)
      .single();
    if (!error && data) {
      const u: LocalUser = {
        id: data.id,
        username: data.username,
        displayName: data.display_name,
        password: data.password_hash,
        role: data.role,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(u));
      // also sync local users cache
      const users = getUsers();
      if (!users.find((x) => x.id === u.id)) {
        users.push(u);
        saveUsers(users);
      }
      return u;
    }
  } catch {}
  // fallback local
  const users = getUsers();
  const u = users.find((x) => x.username === username && x.password === password);
  if (u) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    return u;
  }
  return null;
}

export function login(username: string, password: string): LocalUser | null {
  const users = getUsers();
  const u = users.find((x) => x.username === username && x.password === password);
  if (u) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    return u;
  }
  return null;
}

export function getSession(): LocalUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalUser;
    // migrate old session ids
    if (parsed.id === "1" || parsed.id === "2" || parsed.id === "3") {
      const map: Record<string, LocalUser> = Object.fromEntries(DEFAULT_USERS.map((u) => [u.username, u]));
      const fixed = map[parsed.username];
      if (fixed) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(fixed));
        return fixed;
      }
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("vault_unlocked");
}

export function addUser(username: string, displayName: string, password: string): LocalUser {
  const users = getUsers();
  if (users.find((u) => u.username === username)) throw new Error("اسم المستخدم موجود");
  const nu: LocalUser = { id: String(Date.now()), username, displayName, password, role: "member" };
  users.push(nu);
  saveUsers(users);
  // also try insert in Supabase async (fire and forget)
  supabase.from("profiles").insert({ username, display_name: displayName, password_hash: password, role: "member" }).then(()=>{});
  return nu;
}

export async function fetchProfiles(): Promise<LocalUser[]> {
  try {
    const { data } = await supabase.from("profiles").select("*");
    if (data && data.length > 0) {
      return data.map((d: any) => ({
        id: d.id,
        username: d.username,
        displayName: d.display_name,
        password: d.password_hash,
        role: d.role,
      }));
    }
  } catch {}
  return getUsers();
}
