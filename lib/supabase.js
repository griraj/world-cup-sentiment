// lib/supabase.js
// Two clients:
//   supabase       – anon key (safe to use in browser, read-only per RLS)
//   supabaseAdmin  – service role key (server-side only, full write access)

import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anon) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

// Browser-safe client (anon key, respects RLS)
export const supabase = createClient(url, anon)

// Server-only admin client (service role key – never expose to browser)
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}
