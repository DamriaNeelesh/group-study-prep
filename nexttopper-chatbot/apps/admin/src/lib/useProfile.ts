import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type Profile = {
  id: string;
  display_name: string | null;
  role: 'admin' | 'counselor';
};

export function useProfile(session: Session | null): {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
} {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(!!session);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user?.id) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      const { data, error } = await supabase
        .from('nt_profiles')
        .select('id, display_name, role')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!alive) return;
      if (error) {
        setError(error.message);
        setProfile(null);
      } else {
        setProfile((data as Profile) ?? null);
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [session?.user?.id]);

  return { profile, loading, error };
}

