/**
 * Shared state shape for the auth Server Actions.
 *
 * IMPORTANT: this module deliberately has NO `"use server"` directive.
 *
 * A `"use server"` file may only export async functions. Exporting a plain
 * value (such as `initialAuthState` below) from `lib/auth/actions.ts` throws at
 * runtime:
 *
 *   Error: A "use server" file can only export async functions, found object.
 *
 * Client Components need `initialAuthState` for React's `useActionState`, so
 * the type and the default value live here instead — in an ordinary module that
 * both the server actions and the client form can safely import.
 */

/** Result shape returned to client components using React's `useActionState`. */
export interface AuthActionState {
  error: string | null;
  message: string | null;
}

/** Idle state: no error and no success message yet. */
export const initialAuthState: AuthActionState = {
  error: null,
  message: null,
};
