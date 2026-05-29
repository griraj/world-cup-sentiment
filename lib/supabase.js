import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anon) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// Browser client — uses anon key, respects row level security
export const supabase = createClient(url, anon)

// Server-only client — uses service role key, bypasses RLS for writes
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}
