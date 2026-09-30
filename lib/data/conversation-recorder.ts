import { createClient } from "@/lib/supabase/client";

/**
 * THE BROWSER-SIDE CONVERSATION RECORDER.
 *
 * Written with the user-scoped client on purpose: RLS applies, so the browser
 * physically cannot write a row owned by anybody else. It is never given the
 * service role.
 *
 * ── THE ONE RULE: THIS MUST NEVER BE FELT ────────────────────────────────────
 *
 * Elara is speaking when a turn is saved. If the network is slow, the insert
 * stalls, or PostgREST rejects the row, the person must not hear a stutter, a
 * delayed reply, or a lost turn. So:
 *
 *   - every call is fire-and-forget; nothing here is ever awaited by the voice
 *     loop, and no promise is returned to it;
 *   - failures are caught and logged, never re-thrown;
 *   - a failed conversation is remembered as "off" and the recorder stops
 *     trying, so a broken insert cannot turn into a per-turn retry storm.
 *
 * A lost transcript line is a far smaller harm than a glitched conversation, and
 * the privacy copy is written on the assumption that saving is best-effort.
 */

export interface RecorderOptions {
  userId: string;
  /** Honoured live: turning history off stops new writes immediately. */
  memoryEnabled: () => boolean;
}

export class ConversationRecorder {
  private readonly userId: string;
  private readonly memoryEnabled: () => boolean;

  private conversationId: string | null = null;
  /** Set once a create fails, so we stop attempting for the rest of the session. */
  private disabled = false;
  private pending = false;
  /** Turns written in this conversation, for the 500-message cap. */
  private written = 0;

  constructor(options: RecorderOptions) {
    this.userId = options.userId;
    this.memoryEnabled = options.memoryEnabled;
  }

  /** Whether history is currently being saved. */
  get isEnabled(): boolean {
    return !this.disabled && this.memoryEnabled();
  }

  /** The conversation this session is writing to, once it exists. */
  get conversation(): string | null {
    return this.conversationId;
  }

  /**
   * Open a conversation for this voice session.
   *
   * Awaited by the caller ONLY to know whether a conversation exists, and the
   * voice loop treats a null answer as "carry on without saving" rather than as
   * an error.
   */
  async start(title?: string, language?: string): Promise<string | null> {
    if (this.disabled) {
      return null;
    }

    try {
      const supabase = createClient();
      const safeTitle = (title ?? "New conversation").slice(0, 60).trim();

      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: this.userId,
          title: safeTitle.length > 0 ? safeTitle : "New conversation",
          language: language ?? "en",
        })
        .select("id")
        .single<{ id: string }>();

      if (error) {
        this.disabled = true;
        return null;
      }

      this.conversationId = data?.id ?? null;
      return this.conversationId;
    } catch {
      this.disabled = true;
      return null;
    }
  }

  /**
   * Save one delivered turn. Fire-and-forget by design.
   *
   * Called AFTER the reply is already delivered, so a slow insert cannot delay
   * speech. Both halves of a turn are sent together, and a small ordering
   * guard keeps a rapid pair in sequence.
   */
  record(role: "user" | "assistant", content: string): void {
    if (!this.isEnabled) {
      return;
    }

    const conversationId = this.conversationId;

    if (conversationId === null) {
      return;
    }

    const trimmed = content.trim();

    if (trimmed.length === 0) {
      return;
    }

    this.written += 1;

    void this.write(conversationId, role, trimmed.slice(0, 8000));
  }

  private async write(
    conversationId: string,
    role: "user" | "assistant",
    content: string
  ): Promise<void> {
    // Never write audio, and never exceed the cap set in the data layer.
    if (this.written > 500) {
      this.disabled = true;
      return;
    }

    this.pending = true;

    try {
      const supabase = createClient();
      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        // Explicit, because `messages_insert_own` requires the denormalised
        // owner to match both the caller and the conversation.
        user_id: this.userId,
        role,
        content,
      });

      if (error) {
        // Logged and swallowed. The turn is lost; the conversation is not
        // interrupted, and a single rejection does not stop later turns.
        console.error("[recorder] message save failed:", error.code);
      }
    } catch {
      // Network failure. Same reasoning: never surface it to the voice loop.
    } finally {
      this.pending = false;
    }
  }

  /** Whether a write is in flight. Exposed for diagnostics only. */
  get isSaving(): boolean {
    return this.pending;
  }
}
