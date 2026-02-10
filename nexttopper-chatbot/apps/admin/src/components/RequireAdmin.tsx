import type { ReactNode } from 'react';
import { useSession } from '../lib/useSession';
import { useProfile } from '../lib/useProfile';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const { profile, loading, error } = useProfile(session);

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        Loading profile…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        Profile error: {error}
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        No profile found for this user. Ask your admin to create it in Supabase
        `profiles`.
      </div>
    );
  }

  if (profile.role !== 'admin') {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        Access denied. Your role is `{profile.role}`.
      </div>
    );
  }

  return children;
}

