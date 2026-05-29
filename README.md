# World Cup Sentiment Tracker

A real-time sentiment dashboard that tracks what football fans are saying during World Cup matches. It pulls comments from Reddit, Bluesky, and RSS news feeds, runs them through sentiment analysis, and displays the results on a live dashboard.

## What it does

- Fetches posts from Reddit (r/soccer, r/worldcup), Bluesky, and BBC/Sky Sports/ESPN RSS feeds
- Classifies each post as positive, negative, or neutral using a HuggingFace NLP model
- Detects match events like goals and red cards based on sudden spikes in volume and sentiment
- Shows a live dashboard with a sentiment timeline, crowd momentum gauge, team comparison chart, and trending words

## Tech stack

- Next.js 14 on Vercel (frontend and API routes)
- Supabase (Postgres database)
- HuggingFace Inference API (sentiment and emotion models)
- Reddit public JSON API, Bluesky AppView API, BBC/Sky/ESPN RSS

## Getting started

### 1. Set up Supabase

Create a project at supabase.com, then run the SQL in `supabase/schema.sql` in the SQL editor. Grab your project URL, anon key, and service role key from Settings > API.

### 2. Deploy to Vercel

Push the repo to GitHub, then import it on vercel.com. Add these environment variables:

```
NEXT_PUBLIC_SUPABASE_URL      your Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY your anon key
SUPABASE_SERVICE_ROLE_KEY     your service role key
USE_MOCK_STREAM               true (use false for live data)
CRON_SECRET                   any random string
```

Optional variables for live data:

```
REDDIT_CLIENT_ID       from reddit.com/prefs/apps
REDDIT_CLIENT_SECRET   from reddit.com/prefs/apps
HF_API_TOKEN           from huggingface.co/settings/tokens
```

### 3. Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. To test the ingest pipeline manually, run:

```bash
curl http://localhost:3000/api/trigger
```

## Project structure

```
app/
  page.js                 dashboard UI
  api/
    trigger/route.js      called by the browser to fetch and save new posts
    ingest/route.js       called by Vercel cron (daily on free plan)
    stats/route.js        returns all dashboard data in one request
lib/
  reddit.js               fetches posts from Reddit
  bluesky.js              fetches posts from Bluesky
  rss.js                  fetches headlines from RSS feeds
  sentiment.js            runs NLP analysis via HuggingFace
  eventDetector.js        detects goals and red cards from sentiment patterns
  supabase.js             database client setup
  utils.js                text cleaning and team detection
supabase/
  schema.sql              database schema
```

## How the data pipeline works

Every time the dashboard loads, it calls /api/trigger, which does the following:

1. Fetches posts from Reddit, Bluesky, and RSS in parallel
2. Filters out duplicates already in the database
3. Sends each post through sentiment and emotion classification
4. Saves the results to Supabase
5. Updates per-minute aggregate metrics
6. Checks for match events based on volume and sentiment patterns

The dashboard then calls /api/stats to get the latest data and re-renders.

## Notes on the free tier

Reddit and Bluesky are free with no limits for public data. The HuggingFace free tier allows around 30,000 characters per month, after which the API returns errors and the system falls back to a keyword-based mock classifier. Supabase free tier supports 500MB storage and 50,000 rows, which is more than enough for a tournament.

If USE_MOCK_STREAM is true, the app generates fake posts instead of fetching real ones. This is useful for testing without credentials.
