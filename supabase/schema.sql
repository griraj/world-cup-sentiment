-- ============================================================
--  World Cup Sentiment Tracker – Supabase Schema
--  Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Enable realtime for live dashboard updates
-- (Done via Dashboard UI: Database → Replication → enable for each table)

-- ── Posts (tweets / Reddit comments) ─────────────────────────
create table if not exists posts (
  id            bigint primary key generated always as identity,
  post_id       text unique not null,
  username      text,
  content       text not null,
  cleaned_text  text,
  created_at    timestamptz default now() not null,
  sentiment     text check (sentiment in ('POSITIVE','NEGATIVE','NEUTRAL')),
  confidence    float,
  emotion       text,
  team_tag      text,
  source        text default 'mock',   -- 'reddit' | 'mock'
  like_count    int default 0,
  is_viral      boolean default false
);

create index if not exists idx_posts_created_at on posts (created_at desc);
create index if not exists idx_posts_sentiment   on posts (sentiment);
create index if not exists idx_posts_team_tag    on posts (team_tag);

-- ── Match events (detected spikes / goals / cards) ────────────
create table if not exists match_events (
  id              bigint primary key generated always as identity,
  event_type      text not null,
  detected_at     timestamptz default now() not null,
  sentiment_shift float,
  post_volume     int,
  team_tag        text,
  description     text
);

create index if not exists idx_events_detected_at on match_events (detected_at desc);

-- ── Per-minute aggregated metrics (fast dashboard reads) ──────
create table if not exists metrics_minutely (
  id              bigint primary key generated always as identity,
  bucket_time     timestamptz not null,
  team_tag        text,
  post_count      int default 0,
  positive_count  int default 0,
  negative_count  int default 0,
  neutral_count   int default 0,
  sentiment_score float,           -- range -1 to +1
  unique (bucket_time, team_tag)
);

create index if not exists idx_metrics_bucket on metrics_minutely (bucket_time desc);
create index if not exists idx_metrics_team   on metrics_minutely (team_tag, bucket_time desc);

-- ── Enable Realtime ───────────────────────────────────────────
-- Run these in Supabase SQL Editor to enable realtime pushes:
alter publication supabase_realtime add table posts;
alter publication supabase_realtime add table match_events;
alter publication supabase_realtime add table metrics_minutely;

-- ── Row Level Security (open read for dashboard) ──────────────
alter table posts             enable row level security;
alter table match_events      enable row level security;
alter table metrics_minutely  enable row level security;

-- Allow anonymous read (dashboard doesn't require login)
create policy "Public read posts"    on posts            for select using (true);
create policy "Public read events"   on match_events     for select using (true);
create policy "Public read metrics"  on metrics_minutely for select using (true);

-- Allow service_role to insert/upsert (used by API routes with SERVICE_ROLE_KEY)
create policy "Service insert posts"   on posts            for insert with check (true);
create policy "Service insert events"  on match_events     for insert with check (true);
create policy "Service upsert metrics" on metrics_minutely for all   using (true);
