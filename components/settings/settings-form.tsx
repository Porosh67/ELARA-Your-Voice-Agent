"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2, X } from "lucide-react";
import { AuthInput } from "@/components/auth/auth-input";
import { AuthError } from "@/components/auth/auth-error";
import { PasswordStrength } from "@/components/auth/password-strength";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  USERNAME_HINT,
  isPasswordAcceptable,
  isUsernameWellFormed,
  normalizeUsername,
  usernameFormatError,
} from "@/lib/auth/password-policy";
import { VOICE_LANGUAGES } from "@/lib/voice/languages";

/**
 * THE SETTINGS SCREEN.
 *
 * Writes are optimistic and fire-and-forget: a preference the person just
 * changed is already reflected in the UI, so a slow round trip must not feel
 * like the control is stuck. Every PATCH carries only the field that changed,
 * and a failure rolls that one control back and says so.
 *
 * Nothing here ever holds a password longer than the field itself, and the
 * delete flow requires the exact word DELETE on the server as well as here.
 */

/** The word that arms account deletion. Case-sensitive, by design. */
const CONFIRMATION_WORD = "DELETE";

interface ProfileShape {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  is_guest: boolean;
}

interface SettingsShape {
  preferred_language: string;
  tts_voice: string | null;
  tts_rate: number;
  theme: string;
  memory_enabled: boolean;
}

export function SettingsForm({
  initialProfile,
  initialSettings,
  isGuest,
}: {
  initialProfile: ProfileShape;
  initialSettings: SettingsShape;
  isGuest: boolean;
}) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(initialProfile.display_name ?? "");
  const [username, setUsername] = useState(initialProfile.username ?? "");
  const [settings, setSettings] = useState<SettingsShape>(initialSettings);

  const [profileNotice, setProfileNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pendingField, setPendingField] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /* ── PREFERENCES ───────────────────────────────────────────────────────── */

  /** Optimistic local update + a single-field PATCH, with rollback on failure. */
  const patchSetting = useCallback(
    async <K extends keyof SettingsShape>(field: K, value: SettingsShape[K]) => {
      const previous = settings;

      setSettings((current) => ({ ...current, [field]: value }));
      setPendingField(field);
      setSavedAt(null);

      try {
        const response = await fetch("/api/account/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });

        if (!response.ok) {
          // Roll this one control back; leave the others alone.
          setSettings(previous);
          return;
        }

        setSavedAt(Date.now());
      } catch {
        setSettings(previous);
      } finally {
        setPendingField(null);
      }
    },
    [settings]
  );

  /* ── PROFILE ───────────────────────────────────────────────────────────── */

  const usernameFormat = usernameFormatError(username);
  const usernameOk = isUsernameWellFormed(username);
  const nameChanged = displayName.trim() !== (initialProfile.display_name ?? "");
  const usernameChanged = normalizeUsername(username) !== (initialProfile.username ?? "");
  const profileDirty = nameChanged || usernameChanged;

  async function saveProfile() {
    setSavingProfile(true);
    setProfileNotice(null);

    const payload: { display_name?: string; username?: string } = {};

    if (nameChanged) {
      payload.display_name = displayName.trim();
    }

    // An emptied username RELEASES the handle rather than failing validation.
    if (usernameChanged) {
      payload.username = username.trim() === "" ? "" : normalizeUsername(username);
    }

    try {
      const response = await fetch("/api/account/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;

      if (!response.ok) {
        setProfileNotice({
          tone: "error",
          text:
            typeof result?.error === "string"
              ? result.error
              : "We couldn't save that. Please try again.",
        });
        return;
      }

      setProfileNotice({ tone: "ok", text: "Profile saved." });
      router.refresh();
    } catch {
      setProfileNotice({
        tone: "error",
        text: "We couldn't reach the server. Please try again.",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  /* ── DELETE ────────────────────────────────────────────────────────────── */

  const canDelete = deleteConfirm === CONFIRMATION_WORD && !deleting;

  async function deleteAccount() {
    if (!canDelete) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: deleteConfirm }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;

        setDeleteError(
          typeof result?.error === "string"
            ? result.error
            : "We couldn't delete your account. Please try again."
        );
        setDeleting(false);
        return;
      }

      setDeleteOpen(false);

      /*
       * A HARD navigation on purpose. The server has just deleted the auth user
       * and cleared these cookies, and this tab still holds that user's id, the
       * transcript and the session state in memory. A client-side push would
       * keep that tree alive and merely re-render the landing page over stale
       * account data; a full document load discards every byte of it. For a
       * destructive, irreversible operation that is the safer default.
       */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/?deleted=1";
    } catch {
      setDeleteError("We couldn't reach the server. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ── 1. PROFILE ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
          <p className="text-sm text-muted-foreground">
            How you appear in Elara, and the handle you sign up with.
          </p>
        </header>

        <div className="flex flex-col gap-4">
          <AuthInput
            id="displayName"
            label="Full name"
            type="text"
            autoComplete="name"
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />

          <div className="flex flex-col gap-2">
            <AuthInput
              id="username"
              label="Username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              error={usernameFormat}
              aria-describedby="username-status"
            />
            <p
              id="username-status"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              {usernameFormat !== null ? (
                <>
                  <X className="h-3 w-3 shrink-0 text-red-500" aria-hidden="true" />
                  {usernameFormat}
                </>
              ) : username.trim() === "" ? (
                USERNAME_HINT
              ) : usernameOk ? (
                <>
                  <Check
                    className="h-3 w-3 shrink-0 text-emerald-500"
                    aria-hidden="true"
                  />
                  Looks valid — we&apos;ll tell you if it&apos;s taken when you save.
                </>
              ) : null}
            </p>
          </div>

          <AuthInput
            id="email"
            label="Email"
            type="email"
            value={initialProfile.email ?? "—"}
            readOnly
            disabled
          />

          {profileNotice !== null ? (
            <AuthError
              error={profileNotice.tone === "error" ? profileNotice.text : null}
              message={profileNotice.tone === "ok" ? profileNotice.text : null}
            />
          ) : null}

          <div>
            <Button
              type="button"
              onClick={() => void saveProfile()}
              loading={savingProfile}
              disabled={!profileDirty || savingProfile || usernameFormat !== null}
              size="sm"
            >
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </div>
      </section>

      {/* ── 2. PREFERENCES ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Preferences</h2>
          <p className="text-sm text-muted-foreground">
            Saved to your account and applied the next time you talk.
          </p>
        </header>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="preferredLanguage"
              className="text-sm font-medium text-foreground/90"
            >
              Preferred language
            </label>
            <select
              id="preferredLanguage"
              value={settings.preferred_language}
              onChange={(event) =>
                void patchSetting("preferred_language", event.target.value)
              }
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-ring/40"
            >
              {VOICE_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                  {language.ttsLang ? "" : " (no browser voice)"}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="ttsRate" className="text-sm font-medium text-foreground/90">
              Speaking rate
            </label>
            <div className="flex items-center gap-4">
              <input
                id="ttsRate"
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={settings.tts_rate}
                onChange={(event) =>
                  void patchSetting("tts_rate", Number(event.target.value))
                }
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-foreground/15 accent-primary"
              />
              <span className="w-14 text-right text-sm tabular-nums text-muted-foreground">
                {settings.tts_rate.toFixed(2)}×
              </span>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {pendingField === "tts_rate" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : savedAt !== null && pendingField === null ? (
                <>
                  <Check
                    className="h-3 w-3 text-emerald-500"
                    aria-hidden="true"
                  />
                  Saved
                </>
              ) : null}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground/90">Theme</span>
              <span className="text-xs text-muted-foreground">
                Follows your system by default.
              </span>
            </div>
            <ThemeToggle />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground/90">
                Save my conversation history
              </span>
              <span className="text-xs text-muted-foreground">
                Stores the TEXT of your conversations. Audio is never stored, ever.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.memory_enabled}
              aria-label="Save my conversation history"
              onClick={() =>
                void patchSetting("memory_enabled", !settings.memory_enabled)
              }
              disabled={pendingField === "memory_enabled"}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                settings.memory_enabled ? "bg-primary" : "bg-foreground/20"
              } disabled:opacity-60`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                  settings.memory_enabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* ── 3. LEGAL ────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">About &amp; legal</h2>
          <p className="text-sm text-muted-foreground">
            Plain-language answers about what Elara does with your data.
          </p>
        </header>

        <ul className="flex flex-col gap-2 text-sm">
          {[
            { href: "/about", label: "About Elara — what it is, and what it does" },
            { href: "/terms", label: "Terms of use" },
            { href: "/privacy", label: "Privacy — exactly what is stored, and what isn't" },
          ].map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="text-primary-soft underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* ── 4. ACCOUNT ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Account</h2>
          <p className="text-sm text-muted-foreground">
            {isGuest
              ? "You're using a guest session — there's no password to manage."
              : "Manage your sign-in details or remove your account entirely."}
          </p>
        </header>

        {isGuest ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface-muted/30 px-4 py-4">
            <p className="text-sm text-muted-foreground">
              A guest session is temporary and cannot be recovered later. Create
              an account to keep your preferences between visits.
            </p>
            <div>
              <a href="/signup">
                <Button type="button" size="sm">
                  Create an account
                </Button>
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface-muted/30 px-4 py-4">
            <p className="text-sm text-muted-foreground">
              Changing your email or password is done from the login page.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/forgot-password">
                <Button type="button" variant="secondary" size="sm">
                  Reset password
                </Button>
              </a>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-4">
          <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
            Delete account
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            This permanently removes your profile, settings, conversations and
            every message in them. It cannot be undone.
          </p>

          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setDeleteOpen(true);
                setDeleteConfirm("");
                setDeleteError(null);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete account
            </Button>
          </div>
        </div>
      </section>

      {/* ── DELETE DIALOG ───────────────────────────────────────────────── */}
      {deleteOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h3 id="delete-title" className="text-lg font-semibold tracking-tight">
              Delete your account?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Everything goes: your profile, preferences, conversations and all
              messages. There is no way to undo this.
            </p>

            <div className="mt-4">
              <AuthInput
                id="deleteConfirm"
                label={`Type ${CONFIRMATION_WORD} to confirm`}
                type="text"
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>

            <AuthError error={deleteError} message={null} />

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void deleteAccount()}
                loading={deleting}
                disabled={!canDelete}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? "Deleting…" : "Delete everything"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Kept beside the form so the strength component is reachable for reuse. */
export { PasswordStrength, isPasswordAcceptable };
