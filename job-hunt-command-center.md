# Job Hunt Command Center — System Design & Build Plan

> A full-stack agentic AI app. Python · FastAPI · Pydantic AI · TypeScript · React · Postgres · Docker · Kubernetes

---

## What this app does

Two ingestion sources (Gmail and a Chrome extension) independently discover jobs you've applied to. They feed into a shared backend that deduplicates, stores, and enriches each job. Four AI agents run on top: one infers application status from emails, one enriches job listings with structured data, one proactively nudges you to follow up, and one surfaces patterns across your entire job search. A React frontend presents everything as a kanban board with an agent reasoning log.

---

## System diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INGESTION LAYER                              │
│                                                                     │
│   ┌──────────────────┐            ┌──────────────────────────────┐  │
│   │   Gmail (OAuth)  │            │     Chrome Extension         │  │
│   │  polls every N   │            │  user clicks "Track this"    │  │
│   │  minutes for     │            │  → scrapes current page      │  │
│   │  recruiter mail  │            │  → POSTs to /jobs endpoint   │  │
│   └────────┬─────────┘            └───────────────┬──────────────┘  │
│            │                                      │                 │
└────────────┼──────────────────────────────────────┼─────────────────┘
             │                                      │
             ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FASTAPI BACKEND                              │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                   DEDUPLICATION LAYER                       │   │
│   │  normalize title + extract company domain → fuzzy match    │   │
│   │  against existing jobs → merge or create new record        │   │
│   └─────────────────────────────┬───────────────────────────────┘   │
│                                 │                                   │
│   ┌─────────────────────────────▼───────────────────────────────┐   │
│   │                        POSTGRES                             │   │
│   │   jobs · applications · emails · status_history · nudges   │   │
│   └─────────────────────────────┬───────────────────────────────┘   │
│                                 │                                   │
│   ┌─────────────────────────────▼───────────────────────────────┐   │
│   │               ASYNC BACKGROUND WORKERS                     │   │
│   │   asyncio tasks / Celery — triggered on insert/schedule     │   │
│   └──────┬──────────────┬──────────────┬────────────────────────┘   │
│          │              │              │                            │
└──────────┼──────────────┼──────────────┼────────────────────────────┘
           │              │              │
           ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐
│   STATUS     │  │ ENRICHMENT   │  │    NUDGE     │  │   PATTERN      │
│    AGENT     │  │    AGENT     │  │    AGENT     │  │    AGENT       │
│              │  │              │  │              │  │                │
│ reads email  │  │ parses JD →  │  │ K8s CronJob  │  │ runs after 20+ │
│ → classifies │  │ tech stack,  │  │ checks stale │  │ jobs → finds   │
│ → updates    │  │ salary, fit  │  │ apps → draft │  │ callback       │
│   status     │  │   score      │  │  follow-ups  │  │   patterns     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬─────────┘
       │                 │                 │                  │
       └─────────────────┴────────┬────────┴──────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       REACT FRONTEND                                │
│                                                                     │
│   Kanban board · Agent reasoning log · Resume fit scores           │
│   Pattern insights · Follow-up queue · Application timeline        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Ingestion flow — Gmail

### How it works
1. User authenticates via Google OAuth 2.0 (you request `gmail.readonly` scope)
2. Backend polls Gmail API on a schedule (every 15–30 min) using a background task
3. Each email is passed to the **status agent** which classifies it and links it to an existing job record

### What to watch out for

**OAuth token lifecycle** — access tokens expire after 1 hour. You must store the refresh token securely and use it to get new access tokens automatically. If you miss this, polling silently breaks. Store tokens encrypted at rest, never in plaintext.

**Rate limits** — Gmail API has a quota of 250 quota units per user per second. A `messages.list` call costs 5 units, `messages.get` costs 5. For a job seeker with heavy recruiter mail this adds up. Implement exponential backoff and cache the `historyId` so you only fetch emails that arrived since the last poll, not the full inbox every time.

**Webhook vs polling** — Gmail supports push notifications via Pub/Sub (Google Cloud), which is more efficient than polling. This is worth setting up if you want real-time status updates, but it adds infrastructure complexity. Start with polling, migrate later.

**Email threading** — recruiter conversations are threaded. One `threadId` may contain an initial outreach, your reply, a scheduling email, and an outcome. You need to process the whole thread to understand the full context, not just the latest message.

---

## Ingestion flow — Chrome extension

### How it works
1. User is on a job listing page (LinkedIn, Greenhouse, Lever, Workday, etc.)
2. User clicks the extension icon → extension scrapes the visible DOM for title, company, URL, and any visible job description text
3. Extension POSTs a JSON payload to your FastAPI backend
4. Backend runs deduplication, then the enrichment agent async

### What to watch out for

**CORS** — your FastAPI backend needs to explicitly allow requests from Chrome extension origins. Chrome extensions have a unique origin format (`chrome-extension://<id>`). Add this to your CORS middleware config, otherwise every POST silently fails.

**Authentication from the extension** — the extension needs to prove it's your extension, not a random caller. The simplest approach is a user-specific API key stored in Chrome's `storage.sync`, passed as a header. Do not hardcode a shared secret in the extension — it's readable by anyone who installs it.

**DOM scraping fragility** — every job board has a different HTML structure, and they change it without notice. Workday is especially notorious. Design your scraper to extract what it can and gracefully degrade — a job with just a title and URL is better than a failed POST. Let the enrichment agent fill in the gaps from the URL.

**Manifest V3** — Chrome extensions must now use Manifest V3. Service workers replace background pages, `fetch` replaces `XMLHttpRequest`, and content security policies are stricter. If you follow a tutorial using Manifest V2, it won't work in production.

---

## Deduplication — the hard problem

This is the most critical correctness concern in the entire system. The same job can arrive from both sources with slightly different text:

- Extension scrapes: `"Software Engineer, New Grad — Stripe"`
- Gmail subject line: `"Your application to Software Engineer at Stripe"`

### Strategy

1. **Normalize** both inputs: lowercase, strip punctuation, remove common noise words ("your application to", "re:", "—", etc.)
2. **Extract two signals**: normalized job title + company domain (not company name — use the email sender domain or URL hostname, which are stable)
3. **Fuzzy match** normalized title against existing jobs at the same company domain using a library like `rapidfuzz`. A similarity score above ~85% is a match.
4. If matched: merge the new source's metadata into the existing record, log the duplicate source
5. If not matched: create a new record

### What to watch out for

**Same company, different roles** — "Software Engineer" and "Senior Software Engineer" at the same company should NOT be deduplicated. Your fuzzy threshold needs to be high enough to catch typos but low enough to preserve distinct roles. Test this logic with real data early.

**Timing race condition** — if the extension and a Gmail poll both arrive within seconds of each other, two concurrent inserts can both pass the dedup check before either commits. Use a database-level unique constraint (on company domain + normalized title hash) with an upsert (`INSERT ... ON CONFLICT`) rather than a check-then-insert pattern. This is the correct fix — application-level locks are fragile.

**Company name vs domain** — "Google", "Alphabet", "Google LLC" all refer to the same company. Normalize to domain (`google.com`) extracted from the job URL or email sender, not the display name.

---

## Agent designs

### Agent 1 — Status inference (email-triggered)

**Trigger**: new email arrives that matches a known job  
**Input**: email subject + body + current job status  
**Output**: new status (applied / phone screen / technical / final / offer / rejected / ghosted) + reasoning + optional note

**Agent loop**:
1. Tool call: fetch the full email thread for context
2. Tool call: fetch current job record and status history
3. Reasoning: classify the email intent — is this a rejection, a scheduling request, an offer, or noise?
4. Tool call: update job status if classification confidence is high, otherwise log a note for manual review

**What to watch out for**: Automated rejection emails are easy to classify. The hard cases are ambiguous recruiter emails ("We'd love to connect" — is this a screen or spam?). Give the agent a `needs_review` status it can set instead of guessing, and surface those in the UI for the user to resolve manually. Do not auto-update status on low-confidence classifications.

---

### Agent 2 — JD enrichment (insert-triggered, async)

**Trigger**: new job record inserted (from either source)  
**Input**: job title, company, URL, raw JD text (if available)  
**Output**: structured enrichment — tech stack tags, seniority level, remote/hybrid/onsite, salary range if mentioned, resume fit score

**Agent loop**:
1. Tool call: fetch the job URL and extract full JD text if not already provided (extension may have partial text)
2. Reasoning: extract structured fields from the JD
3. Tool call: fetch user's stored resume snapshot
4. Reasoning: score fit (0–100) with a brief explanation of gaps and strengths
5. Tool call: write enrichment back to the job record

**What to watch out for**: Job board pages are often JavaScript-rendered, meaning a simple HTTP GET won't get the JD content — you'll get a shell HTML with no text. You'll need a headless browser (Playwright) or to rely on the text the Chrome extension already scraped. For the MVP, use extension-scraped text and fall back to a best-effort fetch. Don't block the job insert on enrichment — run it async so the user sees the card immediately.

---

### Agent 3 — Nudge agent (scheduled, K8s CronJob)

**Trigger**: runs on a schedule (e.g. every morning at 8am)  
**Input**: all jobs with status "applied" and no status change in N days  
**Output**: a drafted follow-up message per stale application, surfaced in the UI as a nudge card

**Agent loop**:
1. Tool call: query all stale applications (configurable threshold, default 7 days)
2. For each stale job: reasoning — is a follow-up appropriate? (e.g. don't nudge if the last email was a rejection)
3. Tool call: fetch any email history for context
4. Tool call: draft a short, personalized follow-up email using job title and company name
5. Tool call: write nudge record to DB with draft text and expiry

**What to watch out for**: This agent runs on a schedule, so it will re-process the same stale jobs every day if the user dismisses the nudge without acting. Implement a "snoozed until" field per nudge so the agent skips jobs the user has already seen a nudge for. Also cap the number of nudges generated per run — surfacing 30 follow-up drafts at once is overwhelming.

---

### Agent 4 — Pattern agent (threshold-triggered)

**Trigger**: fires when total job count crosses 20, then every 10 new jobs  
**Input**: full applications table with status history, enrichment tags, company metadata  
**Output**: 3–5 natural language insights written to a `insights` table

**Example insights the agent should produce**:
- "You get a response 3× more often from companies with fewer than 500 employees"
- "Roles mentioning Kubernetes have a 12% callback rate vs 31% for roles that don't"
- "Your applications on Mondays have a lower response rate — most are sent on Friday evenings"

**What to watch out for**: This agent needs real data to be useful — don't show pattern insights until there's enough signal. 20 jobs is a reasonable minimum, but surface a progress indicator ("Track 14 more jobs to unlock pattern insights") rather than running the agent on insufficient data and producing hallucinated patterns. Validate any statistical claims the agent makes against actual counts in the DB before displaying them.

---

## Concurrency and async design

FastAPI is async-native. Use this deliberately:

- **Enrichment agent** runs as an async background task triggered on insert — `asyncio.create_task()` or FastAPI's `BackgroundTasks`. The HTTP response to the extension returns immediately; enrichment happens after.
- **Gmail polling** runs as a long-lived background coroutine started at app startup with `asyncio.create_task()`, looping with a sleep interval.
- **Deduplication** must be synchronous within a database transaction to avoid race conditions — use `async with db.begin()` and let the DB constraint enforce uniqueness.
- **Nudge agent** runs as a K8s CronJob — a separate container that runs the agent, writes results, and exits. Do not run scheduled jobs inside the main API process in production.
- **Pattern agent** is the most expensive agent. Run it as an async task but with a semaphore to prevent it running more than once concurrently.

---

## Potential issues to address before you start building

**Gmail OAuth in development** — Google requires your OAuth app to be verified before production users can grant access. During development you'll be in "testing" mode, which limits you to 100 test users and shows a scary consent screen. Plan for this — it won't block you, but don't leave OAuth setup to the last week.

**Chrome extension review** — publishing to the Chrome Web Store requires a review that can take days. If you want this in a portfolio, either publish early or host it as an unpacked extension for demo purposes (which requires enabling developer mode in the browser — fine for demos, not for real users).

**Secret management** — you will have at minimum: a Google OAuth client secret, an LLM API key, a Postgres password, and a user API key for the extension. In Docker Compose, use an `.env` file (never committed). In Kubernetes, use Secrets manifests (also never committed — use `kubectl create secret` or a secrets manager).

**LLM costs** — the enrichment agent runs on every job insert. If you're applying to 50 jobs, that's 50 agent runs. Set `max_tokens` conservatively and log token usage per run. The status agent is triggered by emails which can be high volume — add a pre-filter that only passes emails through to the agent if they contain recruiter-related keywords, saving unnecessary LLM calls.

**Resume versioning** — your resume will change during your job search. Store snapshots with timestamps so the enrichment agent's fit scores are always compared against the resume version that was active when you applied, not your current resume.

---

## Build order

Build in this sequence so every phase produces something usable:

1. **Phase 1 — Core data layer**: Postgres + FastAPI with full CRUD for jobs and applications. No agents yet. Manual data entry only. Get the data model right before anything else.

2. **Phase 2 — Chrome extension**: Build the extension to scrape and POST to Phase 1's endpoint. You can now track jobs from your browser. This is immediately useful.

3. **Phase 3 — Deduplication**: Add the fuzzy matching logic before adding Gmail, since Gmail will immediately create duplicates of things you've already tracked via extension.

4. **Phase 4 — Gmail ingestion**: OAuth flow + email polling. Jobs from recruiter emails start appearing automatically.

5. **Phase 5 — Enrichment agent**: Async JD parsing and resume fit scoring. Every new job gets enriched in the background.

6. **Phase 6 — Status inference agent**: Email classification and automatic kanban updates. This is the "wow" demo moment.

7. **Phase 7 — React frontend**: Kanban board, agent log, fit scores. Until now you've been testing via the API directly — now it's a real app.

8. **Phase 8 — Nudge agent**: K8s CronJob + follow-up drafts. Add this once you have real data to work with.

9. **Phase 9 — Pattern agent**: Insights surface once you've accumulated enough applications. Build last, needs real data volume.

---

## Tech stack summary

| Layer | Technology |
|---|---|
| Backend API | Python, FastAPI |
| AI agents | Pydantic AI |
| Database | PostgreSQL |
| Async workers | asyncio background tasks (dev), Celery + Redis (prod) |
| Frontend | TypeScript, React, Next.js |
| Chrome extension | TypeScript, Manifest V3 |
| Containerization | Docker, Docker Compose |
| Orchestration | Kubernetes (CronJob for nudge agent, Deployment for API) |
| Gmail integration | Google OAuth 2.0, Gmail REST API |
| Deduplication | rapidfuzz (Python) |
| LLM | Anthropic Claude via Pydantic AI |
