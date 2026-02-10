import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Avoid throwing to keep the login page renderable; we'll show a clearer UI error there.
  // eslint-disable-next-line no-console
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Create apps/admin/.env from apps/admin/.env.example.'
  );
}

export const supabase = createClient(url ?? '', anonKey ?? '');

