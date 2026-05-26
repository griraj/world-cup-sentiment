'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Supabase browser client ───────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:       '#0a0e1a',
  surface:  '#111827',
  surface2: '#1c2433',
  border:   '#2d3748',
  accent:   '#00d4ff',
  accent2:  '#ff6b35',
  positive: '#00e676',
  negative: '#ff4444',
  neutral:  '#78909c',
  text:     '#e2e8f0',
  textDim:  '#718096',
  gold:     '#ffd700',
  purple:   '#a855f7',
}

const TEAM_COLORS = {
  Argentina:'#74acdf', Brazil:'#009c3b', France:'#002395',
  England:'#cf111b', Germany:'#c8c8c8', Spain:'#c60b1e',
  Portugal:'#006600', Morocco:'#c1272d', Japan:'#bc002d', USA:'#3c3b6e',
}

const EVENT_ICON = {
  GOAL:'⚽', RED_CARD_OR_VAR:'🟥', MATCH_SPIKE:'📈',
  POSITIVE_SHIFT:'📣', NEGATIVE_SHIFT:'😠',
}

const ALL_TEAMS = ['Argentina','Brazil','France','England','Germany','Spain','Portugal','Morocco']

// ── Reusable components ───────────────────────────────────────

function StatCard({ title, value, sub, color = C.accent }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '14px 16px', textAlign: 'center',
      transition: 'border-color .2s',
    }}>
      <p style={{ fontSize: '.68rem', color: C.textDim, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>{title}</p>
      <h2 style={{ color, fontSize: '1.5rem', fontFamily: 'Orbitron, sans-serif', margin: '4px 0' }}>{value}</h2>
      <p style={{ fontSize: '.68rem', color: C.textDim }}>{sub}</p>
    </div>
  )
}

function Panel({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '16px', overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ icon = '', text }) {
  return (
    <p style={{
      fontSize: '.72rem', color: C.accent, letterSpacing: '2px',
      textTransform: 'uppercase', fontWeight: 700,
      borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 12,
    }}>
      {icon} {text}
    </p>
  )
}

const tooltipStyle = {
  contentStyle: { background: '#1c2433', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: C.textDim },
  itemStyle:    { color: C.text },
}

// ── Momentum gauge (pure CSS/SVG, no extra lib) ────────────────

function MomentumGauge({ score = 0 }) {
  const clamped = Math.max(-1, Math.min(1, score))
  const pct = (clamped + 1) / 2  // 0→1
  const angle = pct * 180 - 90   // -90°..+90°
  const color = clamped > 0.3 ? C.positive : clamped < -0.3 ? C.negative : clamped > 0.1 ? C.accent : clamped < -0.1 ? C.accent2 : C.neutral
  const label = clamped > 0.3 ? 'ELECTRIC 🔥' : clamped > 0.1 ? 'POSITIVE ↑' : clamped < -0.3 ? 'ANGRY 😤' : clamped < -0.1 ? 'NEGATIVE ↓' : 'NEUTRAL ●'

  const cx = 100, cy = 90, r = 72
  const toRad = a => (a * Math.PI) / 180
  const arcX = cx + r * Math.cos(toRad(angle - 90 + 90 - 90))
  // Draw arc from -90° to angle
  const startX = cx + r * Math.cos(toRad(-90))
  const startY = cy + r * Math.sin(toRad(-90))
  const endX   = cx + r * Math.cos(toRad(angle))
  const endY   = cy + r * Math.sin(toRad(angle))
  const large  = pct > 0.5 ? 1 : 0

  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 200 110" width="100%" style={{ maxWidth: 200, display: 'block', margin: '0 auto' }}>
        {/* Track */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={C.border} strokeWidth="14" strokeLinecap="round" />
        {/* Fill */}
        {pct > 0 && (
          <path d={`M ${startX} ${startY} A ${r} ${r} 0 ${large} 1 ${endX} ${endY}`}
            fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
        )}
        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={cx + (r - 10) * Math.cos(toRad(angle))}
          y2={cy + (r - 10) * Math.sin(toRad(angle))}
          stroke={color} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill={color} />
        {/* Score */}
        <text x={cx} y={cy + 22} textAnchor="middle"
          fill={color} fontSize="18" fontFamily="Orbitron, sans-serif" fontWeight="700">
          {clamped > 0 ? '+' : ''}{(clamped * 100).toFixed(0)}
        </text>
      </svg>
      <p style={{ fontSize: '.7rem', color, letterSpacing: '3px', fontWeight: 700, fontFamily: 'Orbitron, sans-serif' }}>
        {label}
      </p>
    </div>
  )
}

// ── Word cloud ─────────────────────────────────────────────────

function WordCloud({ words }) {
  if (!words || Object.keys(words).length === 0) {
    return <p style={{ color: C.textDim, fontSize: '.8rem', textAlign: 'center', padding: '20px 0' }}>Collecting data…</p>
  }
  const max = Math.max(...Object.values(words))
  const palette = [C.accent, C.positive, C.purple, C.gold, C.accent2]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', padding: '8px 4px', minHeight: 140 }}>
      {Object.entries(words).map(([word, count], i) => {
        const ratio = count / max
        const size = 0.7 + ratio * 1.5
        return (
          <span key={word} style={{
            fontSize: `${size}rem`, color: palette[i % palette.length],
            opacity: 0.5 + ratio * 0.5, fontWeight: ratio > 0.5 ? 700 : 400,
            padding: '2px 3px', cursor: 'default',
          }}>{word}</span>
        )
      })}
    </div>
  )
}

// ── Live feed item ─────────────────────────────────────────────

function FeedItem({ post }) {
  const { sentiment, content, username, team_tag, emotion, confidence, is_viral } = post
  const badgeColor = sentiment === 'POSITIVE' ? C.positive : sentiment === 'NEGATIVE' ? C.negative : C.neutral
  const badgeBg    = sentiment === 'POSITIVE' ? '#00e67620' : sentiment === 'NEGATIVE' ? '#ff444420' : '#78909c20'
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '10px 12px', borderBottom: `1px solid ${C.surface2}`,
    }}>
      <span style={{
        background: badgeBg, color: badgeColor,
        border: `1px solid ${badgeColor}40`,
        padding: '2px 8px', borderRadius: 12, fontSize: '.65rem',
        fontWeight: 700, letterSpacing: 1, flexShrink: 0, marginTop: 2,
      }}>
        {sentiment?.slice(0, 3)}
      </span>
      <div>
        <span style={{ fontSize: '.85rem', color: '#cbd5e0', lineHeight: 1.4 }}>
          {content?.slice(0, 160)}
        </span>
        {is_viral && <span style={{ fontSize: '.65rem', color: C.gold, marginLeft: 6 }}>🔥 VIRAL</span>}
        <p style={{ fontSize: '.7rem', color: C.textDim, marginTop: 3 }}>
          {username && `@${username}`}{team_tag && ` · #${team_tag}`}{emotion && ` · ${emotion}`}{confidence && ` · ${(confidence * 100).toFixed(0)}%`}
        </p>
      </div>
    </div>
  )
}

// ── Axis formatters ────────────────────────────────────────────

const fmtTime = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// ══════════════════════════════════════════════════════════════
//  Main Dashboard
// ══════════════════════════════════════════════════════════════

export default function Dashboard() {
  const [data, setData]             = useState(null)
  const [clock, setClock]           = useState('')
  const [selectedTeams, setSelected]= useState(['Argentina','Brazil','France'])
  const [loading, setLoading]       = useState(true)
  const intervalRef = useRef(null)

  // ── Fetch all stats ────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      if (!res.ok) throw new Error('Stats fetch failed')
      const json = await res.json()
      setData(json)
      setLoading(false)
    } catch (e) {
      console.error(e)
    }
  }, [])

  // ── Supabase Realtime subscription ────────────────────────
  useEffect(() => {
    fetchStats()

    // Poll every 5s (realtime as bonus)
    intervalRef.current = setInterval(fetchStats, 5000)

    // Supabase Realtime: re-fetch on any new post
    const channel = supabase
      .channel('dashboard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, fetchStats)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events' }, fetchStats)
      .subscribe()

    // Clock
    const clockInterval = setInterval(() => {
      setClock(new Date().toUTCString().slice(17, 25))
    }, 1000)

    return () => {
      clearInterval(intervalRef.current)
      clearInterval(clockInterval)
      supabase.removeChannel(channel)
    }
  }, [fetchStats])

  // ── Toggle team selection ──────────────────────────────────
  const toggleTeam = team => setSelected(prev =>
    prev.includes(team) ? prev.filter(t => t !== team) : [...prev, team]
  )

  const { timeline = [], volume = [], teams = [], feed = [], events = [], words = {}, momentum = 0, stats = {} } = data || {}

  // Filter team data
  const teamData = (() => {
    if (!teams.length) return []
    const map = {}
    teams.filter(r => selectedTeams.includes(r.team_tag)).forEach(r => {
      const t = fmtTime(r.bucket_time)
      if (!map[t]) map[t] = { time: t }
      map[t][r.team_tag] = r.sentiment_score
    })
    return Object.values(map)
  })()

  // Mean volume for spike line
  const meanVolume = volume.length ? volume.reduce((s, r) => s + (r.post_count || 0), 0) / volume.length : 0

  // ── Styles ────────────────────────────────────────────────
  const gridStyle = (cols) => ({
    display: 'grid',
    gridTemplateColumns: cols,
    gap: 14,
    marginBottom: 14,
  })

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: C.accent, fontFamily: 'Orbitron, sans-serif', fontSize: '1.2rem', letterSpacing: 4 }}>
        ⚽ LOADING DASHBOARD…
      </p>
    </div>
  )

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: "'Rajdhani', sans-serif" }}>
      {/* ── Google Fonts ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Orbitron:wght@700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0e1a; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111827; }
        ::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ maxWidth: 1560, margin: '0 auto', padding: '14px 18px' }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(90deg, #0d1525, #111827)',
          border: `1px solid ${C.accent}30`, borderRadius: 10,
          padding: '12px 22px', marginBottom: 16,
        }}>
          <h1 style={{
            fontFamily: 'Orbitron, sans-serif', fontSize: '1.55rem', fontWeight: 900, letterSpacing: 2,
            background: `linear-gradient(90deg, ${C.accent}, ${C.purple})`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            ⚽ WORLD CUP SENTIMENT
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              background: '#ff444420', color: '#ff4444', border: '1px solid #ff444440',
              padding: '3px 12px', borderRadius: 20, fontSize: '.72rem', fontWeight: 700,
              letterSpacing: 2, animation: 'pulse 2s infinite',
            }}>● LIVE</span>
            <span style={{ fontFamily: 'monospace', color: C.textDim, fontSize: '.82rem' }}>UTC {clock}</span>
          </div>
        </div>

        {/* ── Stat cards ── */}
        <div style={gridStyle('repeat(6, 1fr)')}>
          <StatCard title="Total Posts"   value={(stats.totalPosts || 0).toLocaleString()} sub="all time"           color={C.accent}   />
          <StatCard title="Per Minute"    value={stats.postsPerMin || 0}                   sub="last 5 min"        color={C.purple}   />
          <StatCard title="Positive"      value={`${stats.positivePct || 0}%`}             sub="last 5 min"        color={C.positive} />
          <StatCard title="Negative"      value={`${stats.negativePct || 0}%`}             sub="last 5 min"        color={C.negative} />
          <StatCard title="Mood Score"    value={`${stats.sentimentScore >= 0 ? '+' : ''}${(stats.sentimentScore || 0).toFixed(2)}`} sub="-1 neg / +1 pos" color={C.gold} />
          <StatCard title="Viral Posts"   value={(stats.viralPosts || 0).toLocaleString()} sub="200+ likes"        color={C.accent2}  />
        </div>

        {/* ── Main row ── */}
        <div style={gridStyle('2fr 1fr')}>
          {/* Sentiment Timeline */}
          <Panel>
            <SectionLabel icon="📊" text="Sentiment Timeline – Last 30 min" />
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={timeline} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="pos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.positive} stopOpacity={0.15}/>
                    <stop offset="95%" stopColor={C.positive} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="neg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={C.negative} stopOpacity={0.15}/>
                    <stop offset="95%" stopColor={C.negative} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="bucket_time" tickFormatter={fmtTime} tick={{ fill: C.textDim, fontSize: 11 }} />
                <YAxis tick={{ fill: C.textDim, fontSize: 11 }} />
                <Tooltip {...tooltipStyle} labelFormatter={fmtTime} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="positive_count" name="Positive" stroke={C.positive} fill="url(#pos)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="negative_count" name="Negative" stroke={C.negative} fill="url(#neg)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sentiment_score" name="Score" stroke={C.gold} strokeWidth={2} strokeDasharray="4 2" dot={false} yAxisId={0} />
                {events.slice(0, 4).map(ev => (
                  <ReferenceLine key={ev.id} x={fmtTime(ev.detected_at)}
                    stroke={C.accent} strokeDasharray="3 3"
                    label={{ value: EVENT_ICON[ev.event_type] || '📌', fill: C.accent, fontSize: 14 }} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* Momentum + Events */}
          <Panel>
            <SectionLabel icon="⚡" text="Crowd Momentum" />
            <MomentumGauge score={momentum} />
            <div style={{ height: 14 }} />
            <SectionLabel icon="🚨" text="Match Events" />
            <div style={{ maxHeight: 210, overflowY: 'auto' }}>
              {events.length === 0
                ? <p style={{ color: C.textDim, fontSize: '.8rem' }}>No events detected yet.</p>
                : events.map(ev => (
                  <div key={ev.id} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.surface2}` }}>
                    <span style={{ fontSize: '1.1rem' }}>{EVENT_ICON[ev.event_type] || '📌'}</span>
                    <div>
                      <p style={{ fontSize: '.72rem', color: C.accent, fontWeight: 700, letterSpacing: 1 }}>
                        {ev.event_type?.replace(/_/g, ' ')}
                      </p>
                      <p style={{ fontSize: '.72rem', color: C.textDim, marginTop: 1 }}>
                        {(ev.description || '').slice(0, 70)}{ev.description?.length > 70 ? '…' : ''}
                      </p>
                      <p style={{ fontSize: '.65rem', color: '#4a5568', marginTop: 1 }}>
                        {ev.detected_at ? new Date(ev.detected_at).toLocaleTimeString() : ''}
                      </p>
                    </div>
                  </div>
                ))
              }
            </div>
          </Panel>
        </div>

        {/* ── Bottom row ── */}
        <div style={gridStyle('1fr 1fr 1fr')}>
          {/* Volume */}
          <Panel>
            <SectionLabel icon="📈" text="Post Volume / min" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={volume} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="bucket_time" tickFormatter={fmtTime} tick={{ fill: C.textDim, fontSize: 10 }} />
                <YAxis tick={{ fill: C.textDim, fontSize: 10 }} />
                <Tooltip {...tooltipStyle} labelFormatter={fmtTime} />
                {meanVolume > 0 && (
                  <ReferenceLine y={meanVolume * 3} stroke={C.accent2} strokeDasharray="4 2"
                    label={{ value: 'Spike', fill: C.accent2, fontSize: 10, position: 'insideTopRight' }} />
                )}
                <Bar dataKey="post_count" name="Posts/min" fill={C.accent} opacity={0.85} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {/* Team comparison */}
          <Panel>
            <SectionLabel icon="🏟️" text="Team Sentiment" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {ALL_TEAMS.map(t => (
                <button key={t} onClick={() => toggleTeam(t)} style={{
                  background: selectedTeams.includes(t) ? TEAM_COLORS[t] + '30' : 'transparent',
                  border: `1px solid ${selectedTeams.includes(t) ? TEAM_COLORS[t] : C.border}`,
                  color: selectedTeams.includes(t) ? TEAM_COLORS[t] : C.textDim,
                  padding: '2px 8px', borderRadius: 12, fontSize: '.65rem',
                  cursor: 'pointer', fontWeight: 600,
                }}>{t}</button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={teamData} margin={{ top: 0, right: 5, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="time" tick={{ fill: C.textDim, fontSize: 10 }} />
                <YAxis domain={[-1, 1]} tick={{ fill: C.textDim, fontSize: 10 }} />
                <Tooltip {...tooltipStyle} />
                {selectedTeams.map(t => (
                  <Line key={t} type="monotone" dataKey={t} stroke={TEAM_COLORS[t] || C.accent}
                    strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          {/* Word cloud */}
          <Panel>
            <SectionLabel icon="💬" text="Trending Words" />
            <WordCloud words={words} />
          </Panel>
        </div>

        {/* ── Live feed ── */}
        <Panel>
          <SectionLabel icon="🔴" text="Live Comment Feed" />
          <div>
            {feed.length === 0
              ? <p style={{ color: C.textDim, padding: '14px 12px', fontSize: '.85rem' }}>Waiting for posts…</p>
              : feed.map(p => <FeedItem key={p.post_id} post={p} />)
            }
          </div>
        </Panel>

      </div>
    </div>
  )
}
