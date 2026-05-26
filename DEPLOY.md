# 🚀 Deploy to Vercel + Supabase

Estimated time: **15 minutes**. Both platforms have permanent free tiers.

---

## Step 1 — Set up Supabase (5 min)

### 1a. Create project
1. Go to **https://supabase.com** → Sign up (free)
2. Click **"New project"**
3. Fill in:
   ```
   Name:     world-cup-sentiment
   Password: (generate a strong one – save it)
   Region:   (pick closest to you)
   ```
4. Click **"Create new project"** — takes ~2 minutes to provision

### 1b. Run the schema
1. In your project → **SQL Editor** (left sidebar)
2. Click **"New query"**
3. Open `supabase/schema.sql` from this project
4. Paste the entire contents → click **"Run"**
5. You should see: "Success. No rows returned"

### 1c. Copy your API keys
Go to **Settings → API** (left sidebar):
```
Project URL:      https://xxxxxxxxxxxx.supabase.co      ← NEXT_PUBLIC_SUPABASE_URL
anon public key:  eyJhbGciOiJIUzI1...                   ← NEXT_PUBLIC_SUPABASE_ANON_KEY
service_role key: eyJhbGciOiJIUzI1...                   ← SUPABASE_SERVICE_ROLE_KEY
```
Save all three — you'll need them in Step 3.

---

## Step 2 — Push code to GitHub (2 min)

Vercel deploys from GitHub.

```bash
# In the wc_sentiment_vercel/ folder:
git init
git add .
git commit -m "World Cup Sentiment Tracker"

# Create a new GitHub repo at https://github.com/new
# Then:
git remote add origin https://github.com/YOUR_USERNAME/world-cup-sentiment.git
git push -u origin main
```

---

## Step 3 — Deploy on Vercel (5 min)

### 3a. Create Vercel account
Go to **https://vercel.com** → Sign up with GitHub (free)

### 3b. Import project
1. Vercel dashboard → **"Add New…" → "Project"**
2. Find your `world-cup-sentiment` repo → click **"Import"**
3. Framework Preset: **Next.js** (auto-detected)
4. Click **"Deploy"** — first deploy runs in ~2 minutes

### 3c. Add environment variables
After deploy, go to your project → **Settings → Environment Variables**

Add each of these:

| Name | Value | Where to find |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Supabase Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase Settings → API |
| `USE_MOCK_STREAM` | `true` | Start with mock, switch later |
| `CRON_SECRET` | any random string | Make one up |

Optional (for live NLP and Reddit):

| Name | Value |
|---|---|
| `HF_API_TOKEN` | From https://huggingface.co/settings/tokens |
| `REDDIT_CLIENT_ID` | From https://reddit.com/prefs/apps |
| `REDDIT_CLIENT_SECRET` | From https://reddit.com/prefs/apps |

### 3d. Redeploy to pick up env vars
Settings → Deployments → **"Redeploy"** (or push any commit)

---

## Step 4 — Verify it works

Your app is live at: `https://your-project-name.vercel.app`

### Check the cron job
Vercel runs `/api/ingest` every minute automatically.
To test manually:
```
https://your-project-name.vercel.app/api/ingest
```
Should return: `{"ok":true,"inserted":5,"elapsed_ms":340}`

### Check the dashboard
Open your Vercel URL — you should see the dashboard populate within 60–90 seconds (one cron cycle).

---

## Step 5 — Switch to live Reddit data (optional)

### Get Reddit API credentials (2 min)
1. Go to **https://www.reddit.com/prefs/apps**
2. Scroll down → **"create another app"**
3. Fill in:
   ```
   Name:         WorldCupSentimentTracker
   Type:         ● script
   Redirect URI: http://localhost:3000
   ```
4. Click **"create app"**
5. Copy:
   - **Client ID**: the string directly under your app name
   - **Secret**: the string next to "secret"

### Update Vercel env vars
In Vercel → Settings → Environment Variables:
```
REDDIT_CLIENT_ID      = your_client_id
REDDIT_CLIENT_SECRET  = your_client_secret
USE_MOCK_STREAM       = false
```
Redeploy → live Reddit data flows in on the next cron tick.

---

## Free tier limits

| Service | Free limit | Notes |
|---|---|---|
| Vercel | Unlimited deploys, 100GB bandwidth | Cron jobs included on Hobby plan |
| Supabase | 500MB DB, 2GB bandwidth, 50k rows | More than enough |
| Reddit API | Unlimited public reads | No auth needed for public subs |
| HuggingFace Inference API | ~30k chars/month | Optional; mock NLP works without it |

---

## Local development

```bash
cp .env.example .env.local
# Fill in your Supabase keys

npm install
npm run dev
# Open http://localhost:3000

# Test ingest manually (in another terminal):
curl http://localhost:3000/api/ingest
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard is empty | Wait 60–90s for first cron run, or hit `/api/ingest` manually |
| Cron not running | Check Vercel dashboard → your project → **Cron Jobs** tab |
| Supabase connection error | Double-check env vars are saved and redeployed |
| `SUPABASE_SERVICE_ROLE_KEY` error | Make sure it's set as a server-only var (not prefixed with `NEXT_PUBLIC_`) |
| RLS blocking inserts | Re-run `schema.sql` — it includes the service_role policies |
