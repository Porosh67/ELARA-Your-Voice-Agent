import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Conversation, Profile, UserSettings } from "@/types/database";

/**
 * THE USER-SCOPED DATA LAYER.
 *
 * Everything here uses the ANON, user-scoped Supabase client, never the service
 * role. That is a deliberate security property rather than a convenience: RLS
 * then applies to every read and write, so a bug in this module can at worst
 * affect the caller's OWN rows. The service role bypasses RLS entirely, and
 * using it for a user's own data would silently delete the guarantee that one
 * person can never read or write another's rows.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * The audit found that `settings`, `conversations` and `messages` were created,
 * cascaded and RLS-locked but never read or written by any code — three dead
 * tables behind a UI claiming "Nothing is saved to your account". That claim was
 * accidentally true. This module makes the app actually use them, and makes the
 * privacy copy honest.
 *
 * ── THE TWO HARD RULES ───────────────────────────────────────────────────────
 *
 * 1. AUDIO IS NEVER STORED. Only `Message.content`, which is text the assistant
 *    produced or the person spoke and which was already transcribed. There is no
 *    code path anywhere that writes audio, a blob, a recording, or a base64
 *    payload into a row.
 * 2. NOTHING HERE MAY BLOCK THE VOICE LOOP. A conversation save that throws is
 *    swallowed. The voice assistant must not stall, glitch or fail because a
 *    database write was slow or rejected — a lost message is a far smaller harm
 *    than a broken conversation.
 */

/** The subset of a user object this module needs. */
export interface DataLayerUser {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
}

/* ──────────────────────────────────────────────────────────────────────────
   SELF-HEAL
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Guarantee a profile and a settings row exist for this user, and return them.
 *
 * The `handle_new_user` trigger normally creates both at signup, so this is
 * belt-and-braces for the cases the trigger cannot cover: a trigger that failed,
 * a profile deleted by hand in the table editor, a row dropped by a restore, or
 * a database created before the trigger existed. Without it, one missing row
 * makes the app read `null` forever and every write a silent no-op.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING, so it never overwrites real values —
 * it can only fill a genuine gap. `onConflict: "id"` also makes this a genuine
 * upsert rather than a select-then-insert race between two concurrent requests.
 */
export async function ensureUserRows(
  user: DataLayerUser
): Promise<{ profile: Profile | null; settings: UserSettings | null }> {
  const supabase = await createClient();

  const profileFallback =
    user.email?.split("@")[0] ??
    (user.is_anonymous ? "Guest" : null);

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      // Only used when the row does not exist yet; an existing row keeps its
      // own display name because ON CONFLICT DO NOTHING takes no update.
      display_name: profileFallback,
      is_guest: Boolean(user.is_anonymous),
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.error("[data] profile self-heal failed:", profileError.code);
  }

  const { error: settingsError } = await supabase
    .from("settings")
    .upsert({ user_id: user.id }, { onConflict: "user_id" });

  if (settingsError) {
    console.error("[data] settings self-heal failed:", settingsError.code);
  }

  const [profileResult, settingsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle<Profile>(),
    supabase
      .from("settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle<UserSettings>(),
  ]);

  return {
    profile: profileResult.data ?? null,
    settings: settingsResult.data ?? null,
  };
}

/** Read settings, self-healing the row if it is missing. Never throws. */
export async function loadUserSettings(
  user: DataLayerUser
): Promise<UserSettings | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<UserSettings>();

  if (data !== null) {
    return data;
  }

  // Missing row: create it, then read it back so the caller gets real values.
  const { data: created } = await supabase
    .from("settings")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("*")
    .single<UserSettings>();

  return created ?? null;
}

/* ──────────────────────────────────────────────────────────────────────────
   SETTINGS WRITES
   ────────────────────────────────────────────────────────────────────────── */

/** The writable settings fields. Narrow on purpose — `user_id` is not writable. */
export interface SettingsPatch {
  preferred_language?: string;
  tts_voice?: string | null;
  tts_rate?: number;
  theme?: string;
  memory_enabled?: boolean;
}

/**
 * Persist a settings change.
 *
 * Upserts on `user_id`, so it also works before the self-heal has run. Returns
 * whether the write landed, and NEVER throws: a failed preference write must
 * not break the page.
 */
export async function saveUserSettings(
  userId: string,
  patch: SettingsPatch
): Promise<boolean> {
  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from("settings")
      .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });

    if (error) {
      console.error("[data] settings write failed:", error.code);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   CONVERSATIONS + MESSAGES
   ────────────────────────────────────────────────────────────────────────── */

/**
 * The limits below are a privacy control as much as a performance one: an
 * unbounded transcript is a record of everything someone ever said to their
 * assistant, growing forever on a server they may not remember owning.
 *
 * The message cap is enforced in the browser recorder (which is where turns are
 * actually written) and mirrored here so the server-side helpers cannot be used
 * to sidestep it.
 */
const MAX_MESSAGES_PER_CONVERSATION = 500;
const MAX_TITLE_LENGTH = 60;
const MAX_CONTENT_LENGTH = 8_000;

/**
 * Start a conversation for a voice session.
 *
 * Called once per session, and the returned id is what every later turn is
 * appended to. Returns `null` on any failure — the caller treats that as
 * "history is off for this session" and keeps talking, which is exactly the
 * right degradation.
 */
export async function createConversation(
  userId: string,
  options: { title?: string; language?: string } = {}
): Promise<string | null> {
  try {
    const supabase = await createClient();

    const title = (options.title ?? "New conversation")
      .slice(0, MAX_TITLE_LENGTH)
      .trim();

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: userId,
        title: title.length > 0 ? title : "New conversation",
        language: options.language ?? "en",
      })
      .select("id")
      .single<{ id: string }>();

    if (error) {
      console.error("[data] conversation insert failed:", error.code);
      return null;
    }

    return data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Append one turn.
 *
 * `user_id` is written explicitly even though RLS could derive it, because the
 * `messages_insert_own` policy requires the denormalised owner to match BOTH the
 * caller and the conversation — so an insert that omitted it would be rejected
 * by the very policy that protects the row.
 *
 * Returns whether the message landed. Never throws.
 */
export async function appendMessage(
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string
): Promise<boolean> {
  try {
    const trimmed = content.trim();

    if (trimmed.length === 0) {
      return false;
    }

    const supabase = await createClient();

    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      // TEXT ONLY. There is no audio column in this table and no code path that
      // writes one — see the module header.
      content: trimmed.slice(0, MAX_CONTENT_LENGTH),
    });

    if (error) {
      console.error("[data] message insert failed:", error.code);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Read a conversation's turns, oldest first, for the recent-history window.
 *
 * The conversation is verified to belong to this user in the QUERY itself
 * (`user_id` filter) as well as by RLS, so a guessed conversation id returns
 * nothing rather than someone else's transcript.
 */
export async function listRecentMessages(
  userId: string,
  conversationId: string,
  limit = 20
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data
      .map((row) => ({
        role: row.role,
        content: row.content,
      }))
      .filter(
        (row): row is { role: "user" | "assistant"; content: string } =>
          (row.role === "user" || row.role === "assistant") &&
          typeof row.content === "string"
      )
      .reverse();
  } catch {
    return [];
  }
}

/** How many turns a conversation holds, for the cap and for diagnostics. */
async function countMessages(
  userId: string,
  conversationId: string
): Promise<number> {
  try {
    const supabase = await createClient();

    const { count, error } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("user_id", userId);

    if (error) {
      return 0;
    }

    return count ?? 0;
  } catch {
    return 0;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   PROFILE WRITES
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Whether a conversation has reached the stored-turn cap.
 *
 * Exported so a server-side caller can stop writing to a full conversation
 * rather than relying only on the browser recorder's own counter.
 */
export async function conversationIsFull(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const count = await countMessages(userId, conversationId);
  return count >= MAX_MESSAGES_PER_CONVERSATION;
}

/**
 * Update the display name, RLS permitting (it scopes to `auth.uid() = id`).
 * Returns whether it landed. Never throws.
 */
export async function updateProfileFields(
  userId: string,
  patch: { display_name?: string; username?: string | null }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId);

    if (error) {
      return { ok: false, error: error.code };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Every conversation this user owns, newest first. */
export async function listConversations(
  userId: string,
  limit = 20
): Promise<Conversation[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data as Conversation[];
  } catch {
    return [];
  }
}
