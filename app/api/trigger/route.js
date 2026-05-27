// app/api/trigger/route.js
// Public endpoint called by the browser dashboard to trigger a data refresh.
// Internally calls the ingest route with the CRON_SECRET header.

import { NextResponse } from 'next/server'

export const revalidate = 0

export async function GET(request) {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000'

    const res = await fetch(`${baseUrl}/api/ingest`, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET || ''}`,
      },
    })

    const data = await res.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
