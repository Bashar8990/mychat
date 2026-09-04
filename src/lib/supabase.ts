import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";

export const supabase =
  supabaseUrl.includes("placeholder") || supabaseAnonKey.includes("placeholder")
    ? createClient("https://placeholder.supabase.co", "placeholder-key")
    : createClient(supabaseUrl, supabaseAnonKey);

// Types for our schema
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "member";
  avatar_url?: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  is_group: boolean;
  group_name: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
};
