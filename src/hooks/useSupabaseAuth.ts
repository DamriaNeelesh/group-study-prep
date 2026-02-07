"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function formatAuthErrorMessage(message: string) {
  const m = message.toLowerCase();
  if (m.includes("anonymous sign-ins are disabled")) {
    return [
      "Anonymous sign-ins are disabled in your Supabase project.",
      "Enable it in Supabase Dashboard: Authentication -> Providers -> Anonymous.",
      "Or sign in with Google/email instead.",
    ].join(" ");
  }
  if (m.includes("manual linking") && m.includes("disabled")) {
    return [
      "Manual identity linking is disabled in your Supabase project.",
      'This app uses "Upgrade with Google" to link Google to the current Guest user (so the user ID stays the same).',
      "Enable it in Supabase Dashboard: Authentication -> Settings -> Identity Linking -> Enable Manual Linking (beta).",
      "If you don't need to keep the same Guest ID, change the app to use Google sign-in (OAuth) instead of linking.",
    ].join(" ");
  }
  return message;
}

type UseSupabaseAuthState = {
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  error: string | null;
  displayName: string;
};

export function useSupabaseAuth() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const missingEnvError = supabase
    ? null
    : "Missing env: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY";
  const [state, setState] = useState<UseSupabaseAuthState>({
    isLoading: Boolean(supabase),
    session: null,
    user: null,
    error: missingEnvError,
    displayName: "",
  });

  const refreshProfile = useCallback(
    async (user: User) => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        setState((s) => ({ ...s, error: formatAuthErrorMessage(error.message) }));
        return;
      }

      setState((s) => ({
        ...s,
        displayName: (data?.display_name as string | null) ?? "",
      }));
    },
    [supabase],
  );

  useEffect(() => {
    if (!supabase) return;
    let ignore = false;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (ignore) return;
        if (error) {
          setState((s) => ({
            ...s,
            isLoading: false,
            error: formatAuthErrorMessage(error.message),
          }));
          return;
        }

        setState((s) => ({
          ...s,
          isLoading: false,
          session: data.session,
          user: data.session?.user ?? null,
        }));

        if (data.session?.user) refreshProfile(data.session.user);
      })
      .catch((e: unknown) => {
        if (ignore) return;
        setState((s) => ({
          ...s,
          isLoading: false,
          error: formatAuthErrorMessage(
            e instanceof Error ? e.message : String(e),
          ),
        }));
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ignore) return;
      setState((s) => ({ ...s, session, user: session?.user ?? null }));
      if (session?.user) refreshProfile(session.user);
    });

    return () => {
      ignore = true;
      data.subscription.unsubscribe();
    };
  }, [refreshProfile, supabase]);

  const signInAnonymously = useCallback(async () => {
    if (!supabase) return;
    setState((s) => ({ ...s, error: null }));
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setState((s) => ({ ...s, error: formatAuthErrorMessage(error.message) }));
    }
  }, [supabase]);

  const signInWithEmailOtp = useCallback(
    async (email: string) => {
      if (!supabase) return;
      setState((s) => ({ ...s, error: null }));
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // With App Router, this is the easiest way to complete the magic-link flow.
          emailRedirectTo: `${location.origin}/`,
        },
      });
      if (error) {
        setState((s) => ({ ...s, error: formatAuthErrorMessage(error.message) }));
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setState((s) => ({ ...s, error: null }));
    const { error } = await supabase.auth.signOut();
    if (error) {
      setState((s) => ({ ...s, error: formatAuthErrorMessage(error.message) }));
    }
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    setState((s) => ({ ...s, error: null }));

    // If the user is currently anonymous, prefer linking Google so the user ID stays the same.
    const isAnonymous = Boolean(state.user?.is_anonymous);
    const redirectTo = `${location.origin}/`;
    const res = isAnonymous
      ? await supabase.auth.linkIdentity({
          provider: "google",
          options: { redirectTo },
        })
      : await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });

    if (res.error) {
      setState((s) => ({
        ...s,
        error: formatAuthErrorMessage(res.error.message),
      }));
      return;
    }

    if (res.data?.url) window.location.href = res.data.url;
  }, [state.user?.is_anonymous, supabase]);

  const setDisplayName = useCallback(
    async (displayName: string) => {
      if (!supabase) return;
      setState((s) => ({ ...s, displayName, error: null }));
      const user = state.user;
      if (!user) return;

      const { error } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, display_name: displayName },
          { onConflict: "id" },
        );

      if (error) {
        setState((s) => ({ ...s, error: formatAuthErrorMessage(error.message) }));
      }
    },
    [state.user, supabase],
  );

  // Default to anonymous auth so every browser gets a stable user ID for Presence/RTC.
  useEffect(() => {
    if (state.isLoading) return;
    if (state.user) return;
    void signInAnonymously();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoading, state.user]);

  return {
    ...state,
    signInAnonymously,
    signInWithEmailOtp,
    signInWithGoogle,
    signOut,
    setDisplayName,
  };
}
