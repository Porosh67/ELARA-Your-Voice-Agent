/**
 * Database row types mirroring the schema in
 * `supabase/migrations/0001_init.sql`.
 *
 * These are intentionally plain and hand-written (no codegen) to keep the
 * foundation easy to read during the hackathon.
 */

export type MessageRole = "user" | "assistant" | "system";

export interface Profile {
  id: string;
  email: string | null;
  /** Chosen at signup. NULL for guest and OAuth users. Added in 0002. */
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  /** email | google | anonymous. Added in 0003. NULL on a legacy row. */
  auth_method: string | null;
  /** Last username change; drives the 7-day cooldown. Added in 0003. */
  username_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  preferred_language: string;
  tts_voice: string | null;
  tts_rate: number;
  theme: string;
  memory_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}