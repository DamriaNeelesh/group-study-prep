import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url || !anonKey) {
      setError(
        'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Create apps/admin/.env from apps/admin/.env.example.'
      );
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 28 }}>
      <h2 style={{ margin: 0 }}>Admin Login</h2>
      <p style={{ color: '#64748b', marginTop: 6 }}>
        Next Toppers AI Counselor
      </p>

      <form onSubmit={(e) => void onSubmit(e)} style={{ maxWidth: 380 }}>
        <label style={{ display: 'block', marginTop: 14, fontWeight: 700 }}>
          Email
        </label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="admin@nexttoppers.test"
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            marginTop: 6,
          }}
        />

        <label style={{ display: 'block', marginTop: 12, fontWeight: 700 }}>
          Password
        </label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="••••••••"
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            marginTop: 6,
          }}
        />

        {error ? (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 10,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#7f1d1d',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          style={{
            marginTop: 14,
            width: '100%',
            padding: '10px 12px',
            borderRadius: 10,
            border: 'none',
            cursor: busy ? 'not-allowed' : 'pointer',
            fontWeight: 900,
            background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
            color: 'white',
          }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

