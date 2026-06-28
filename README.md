# Job Scraper

A Node.js CLI that scrapes job listings from multiple company career pages, scores them against your keyword profile, and saves only new relevant results to a JSON file. Supports 10+ ATS platforms and custom strategies for sites that load jobs via JavaScript or internal APIs.

## How It Works

1. For each company in `companies.json`, it detects the right scraping strategy (Workday, Lever, Ashby, etc. or a generic browser-based approach).
2. Every fetched job is scored against your `keywords.json` profile — title matches score higher than description matches; exclude keywords score -1.
3. Only jobs with `score >= min_score` that haven't been seen before are written to the output.
4. Job IDs are saved to `seen.json` so duplicate results don't appear on subsequent runs.

---

## Prerequisites

- **Node.js** v18 or later
- **Playwright** browser binaries (installed separately after `npm install`)

---

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure companies

Edit `companies.json` — each entry is a company career page:

```json
[
  {
    "name": "Acme Corp",
    "url": "https://jobs.lever.co/acme",
    "strategy": "auto"
  }
]
```

**`strategy`** options:

| Value | When to use |
|---|---|
| `"auto"` | Let the scraper detect the right strategy on first run and cache it |
| `"lever"` | Lever ATS (`jobs.lever.co`) |
| `"greenhouse"` | Greenhouse ATS (`boards.greenhouse.io`) |
| `"ashby"` | Ashby ATS (`ashbyhq.com`) |
| `"workday"` | Workday ATS (`myworkdayjobs.com`) |
| `"recruitee"` | Recruitee ATS (`recruitee.com`) |
| `"ripplehire"` | RippleHire ATS (`ripplehire.com`) |
| `"smartrecruiters"` | SmartRecruiters ATS |
| `"teamtailor"` | Teamtailor ATS |
| `"breezy"` | Breezy HR ATS |
| `"static"` | Career page rendered in plain HTML (no JS needed) |
| `"domwait"` | Career page that needs JavaScript to render (uses a real browser) |
| `"intercept"` | Career page that loads jobs via an internal JSON API |

> **Tip:** Start with `"strategy": "auto"` for any new company. The scraper will detect and cache the right strategy on the first run (saved back into `companies.json` as `_detectedStrategy`). Once detected, you can pin it manually to skip re-detection.

**URL tips:**
- For ATS platforms, use the URL exactly as it appears in your browser — query params and hash fragments are respected (e.g., Workday locale, RippleHire location filters).
- For Workday, include the locale prefix in the URL (`/en-US/`) — the scraper handles it.
- For RippleHire, location filters in the URL hash (`#list/location=Bangalore`) are forwarded to the API automatically.

### 3. Configure keywords

Edit `keywords.json` to match what you're looking for:

```json
{
  "profiles": {
    "default": {
      "title_keywords": ["frontend", "react", "full stack"],
      "description_keywords": ["typescript", "next.js", "css"],
      "exclude_keywords": ["java", ".net", "ios", "android"],
      "min_score": 1
    }
  },
  "active_profile": "default"
}
```

**Scoring rules:**
- Each `title_keywords` match → **+3 points**
- Each `description_keywords` match → **+1 point**
- Any `exclude_keywords` match in title or description → **score = -1** (job is dropped)
- Jobs with `score < min_score` are filtered out

You can define multiple profiles and switch between them by changing `active_profile`:

```json
{
  "profiles": {
    "frontend": { ... },
    "data-engineer": { ... }
  },
  "active_profile": "data-engineer"
}
```

### 4. Set up Telegram notifications

The scraper sends a daily digest of new relevant jobs to a Telegram bot.

**Step 1 — Create a bot:**
1. Open Telegram and message `@BotFather`
2. Send `/newbot` and follow the prompts to get a **bot token**

**Step 2 — Get your chat ID:**
1. Start a chat with your new bot (search for it and hit Start)
2. Open this URL in your browser (replace with your token):
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
3. Find `"chat"` → `"id"` in the response — that's your chat ID

**Step 3 — Add to `.env`:**
```
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=987654321
```

After each run, you'll receive one or more Telegram messages with all new relevant jobs (batched 10 per message). If no new jobs are found, you'll get a short "no new jobs today" message so you know the scraper ran.

---

### 5. (Optional) Set up RapidAPI for fallback search

If a company's career page fails to scrape, the scraper can fall back to the [JSearch API](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) on RapidAPI as a last resort.

**To get a key:**
1. Sign up at [rapidapi.com](https://rapidapi.com)
2. Go to the [JSearch API page](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) and subscribe (free tier available)
3. Copy your key from the **X-RapidAPI-Key** header shown in the API playground

Then copy `.env.example` to `.env` and fill in your key:

```bash
cp .env.example .env
```

```
RAPIDAPI_KEY=your_rapidapi_key_here
```

This is optional — scraping works fine without it. The fallback is only triggered when all other strategies fail for a company.

---

## Automated Daily Scheduling (Windows)

The scraper can run automatically every day using Windows Task Scheduler. It handles two failure cases out of the box:
- **Laptop was closed at the scheduled time** — runs as soon as the laptop wakes up
- **No network at startup** — waits up to 5 minutes for a connection before starting

### Setup (one-time)

1. Open **PowerShell as Administrator** (right-click Start → Terminal (Admin))
2. Run the following command, adjusting the time to your preference:

```powershell
$scriptPath = "C:\path\to\job-scraper\run.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "09:00AM"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "JobScraper" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force
```

Replace `C:\path\to\job-scraper\run.ps1` with the actual path to `run.ps1` in this project.

That's it — the task is now registered and runs automatically every day. You never need to touch PowerShell again unless you want to change the schedule time.

### Logs

Each run appends to `output/run.log`:
```
2026-06-28 09:00:05 - === Job Scraper task started ===
2026-06-28 09:00:05 - Network available
2026-06-28 09:00:05 - Running: node scrape.js
2026-06-28 09:02:41 - Scraper exited with code 0
2026-06-28 09:02:41 - === Done ===
```

### To remove the scheduled task

```powershell
Unregister-ScheduledTask -TaskName "JobScraper" -Confirm:$false
```

---

## Running manually

```bash
npm start
# or
node scrape.js
```

Example output:

```
Job Scraper — Starting run at 2026-06-26 13:51:13
──────────────────────────────────────────────────
Scraping Acme Corp…
[1/5] Acme Corp           → lever          →   24 jobs fetched → 3 new, relevant
Scraping Bunq…
[2/5] Bunq                → static         →   22 jobs fetched → 1 new, relevant
──────────────────────────────────────────────────
Total new relevant jobs: 4
Output: output/jobs_2026-06-26.json
```

---

## Output Files

| File | Description |
|---|---|
| `output/jobs_YYYY-MM-DD.json` | New relevant jobs found in today's run |
| `output/all_jobs.json` | All new relevant jobs accumulated across every run |

Each job entry looks like:

```json
{
  "id": "acme:frontend-engineer",
  "title": "Frontend Engineer",
  "company": "Acme Corp",
  "location": "Amsterdam",
  "url": "https://jobs.lever.co/acme/abc123",
  "postedAt": "2026-06-20T00:00:00.000Z",
  "description": "We are looking for...",
  "source": "lever",
  "score": 6,
  "matchedKeywords": ["frontend", "react"]
}
```

---

## seen.json

`seen.json` is auto-generated and tracks every job ID that has already been reported. On each run, only jobs absent from this file are written to the output.

```json
{
  "acme:frontend-engineer": true,
  "bunq:lead-security-engineer": true
}
```

**You don't need to edit this file manually.** But if you want to re-report jobs you've already seen (e.g., after changing your keyword profile), delete `seen.json` and the next run will treat all fetched jobs as new.

---

## Project Structure

```
job-scraper/
├── scrape.js                  # Main entry point
├── run.ps1                    # Task Scheduler wrapper (network retry + logging)
├── setup-task.ps1             # One-time script to register the Windows scheduled task
├── companies/                 # Company lists (one JSON file per group)
├── keywords.json              # Keyword profiles and scoring config
├── seen.json                  # Auto-generated: tracks already-reported job IDs
├── .env                       # Your secrets (not committed)
├── .env.example               # Template — copy to .env and fill in keys
├── output/
│   ├── jobs_YYYY-MM-DD.json   # Per-run results
│   ├── all_jobs.json          # Cumulative results
│   └── run.log                # Auto-generated: log of every scheduled run
└── src/
    ├── detector.js            # Auto-detects the right strategy for a company URL
    ├── normalizer.js          # Normalizes job fields across strategies
    ├── scorer.js              # Scores jobs against keyword profile
    ├── seen.js                # Reads/writes seen.json
    ├── notifier.js            # Sends Telegram digest
    ├── noiseFilter.js         # Filters nav links and junk from scraped pages
    └── strategies/
        ├── static.js          # Plain HTML pages (axios + cheerio)
        ├── domwait.js         # JS-rendered pages (Playwright)
        ├── intercept.js       # Pages that call an internal JSON API
        ├── iframe.js          # Career pages embedded in an iframe
        └── ats/
            ├── ashby.js
            ├── breezy.js
            ├── greenhouse.js
            ├── lever.js
            ├── recruitee.js
            ├── ripplehire.js
            ├── smartrecruiters.js
            ├── teamtailor.js
            └── workday.js
```

---

## Adding a New Company

1. Find the company's careers page URL in your browser.
2. Add an entry to `companies.json`:
   ```json
   { "name": "Company Name", "url": "https://...", "strategy": "auto" }
   ```
3. Run `npm start`. The scraper will detect and cache the strategy automatically.
4. If `auto` detection fails or picks the wrong strategy, set `strategy` to the correct value manually (see the strategy table above) and remove any cached `_detectedStrategy` / `_apiUrl` fields.
