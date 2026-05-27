import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
export const revalidate = 0
export async function GET() {
  try {
    const db = getAdminClient()
    const { data, error } = await db.from('posts').select('id').limit(1)
    if (error) return NextResponse.json({ error: error.message, hint: error.hint })
    const { error: insertError } = await db.from('posts').insert([{
      post_id: `test_${Date.now()}`,
      username: 'test',
      content: 'test post',
      sentiment: 'NEUTRAL',
      confidence: 0.5,
      source: 'test',
      created_at: new Date().toISOString(),
    }])
    if (insertError) return NextResponse.json({ insertError: insertError.message, hint: insertError.hint })
    return NextResponse.json({ ok: true, connected: true, rowCount: data.length })
  } catch (err) {
    return NextResponse.json({ error: err.message })
  }
}
