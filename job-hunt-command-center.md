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
│   │  polls every N   │            │  auto-scrapes on open        │  │
│   │  minutes for     │            │  + AI extraction fallback    │  │
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
│   └─────────────────────────┬───────────────────────────────────┘   │
│                                 │                                   │
│   ┌─────────────────────────────▼───────────────────────────────┐   │
│   │                        POSTGRES                             │   │
│   │   jobs · users · gmail_credentials · status_history        │   │
│   └─────────────────────────┬───────────────────────────────────┘   │
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

## Job statuses

Six statuses, intentionally simple:

| Status | Meaning |
|---|---|
| **Shortlisted** | Saved to apply later — not yet submitted |
| **Applied** | Application submitted |
| **Interview** | Any stage of interviewing (phone, technical, final) |
| **Offer** | Offer received |
| **Rejected** | Explicitly rejected |
| **Ghosted** | Auto-set after 30 days with no update from Applied/Interview |

Granular sub-stages (phone screen vs technical vs final) are deliberately omitted — the pattern agent can infer these from email content without cluttering the kanban.

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
1. User opens the extension on any job listing page
2. Extension auto-scrapes on open (DOM selectors for LinkedIn, Greenhouse, Lever, Workday, Indeed, Glassdoor, Ashby, SmartRecruiters)
3. If title or company are missing, falls back to a Kimi K2.5 LLM call (via Vercel AI SDK) with the page text
4. User reviews pre-filled fields and clicks **Save as Applied** or **Save for Later** (shortlisted)
5. Extension POSTs to `/jobs/` with JWT auth

### What to watch out for

**DOM scraping fragility** — selectors are site-specific and break without notice. The LLM fallback handles unknown boards and broken selectors gracefully.

**Auth** — extension uses `@clerk/chrome-extension` v3 with `syncHost` pointing at the web app. Signs in via the web app; session is read from `__clerk_db_jwt` cookie via `chrome.cookies`.

---

## Deduplication — the hard problem

This is the most critical correctness concern in the entire system. The same job can arrive from both sources with slightly different text:

- Extension scrapes: `"Software Engineer, New Grad — Stripe"`
- Gmail subject line: `"Your application to Software Engineer at Stripe"`

### Strategy

1. **Normalize** both inputs: lowercase, strip punctuation, remove common noise words ("your application to", "re:", "—", etc.)
2. **Extract two signals**: normalized job title + company domain (not company name — use the email sender domain or URL hostname, which are stable)
3. **Fuzzy match** normalized title against existing jobs at the same company domain using `rapidfuzz`. A similarity score above ~85% is a match.
4. If matched: merge the new source's metadata into the existing record, log the duplicate source
5. If not matched: create a new record

### What to watch out for

**Same company, different roles** — "Software Engineer" and "Senior Software Engineer" at the same company should NOT be deduplicated. Your fuzzy threshold needs to be high enough to catch typos but low enough to preserve distinct roles.

**Timing race condition** — if the extension and a Gmail poll both arrive within seconds of each other, two concurrent inserts can both pass the dedup check before either commits. Use a database-level unique constraint with an upsert (`INSERT ... ON CONFLICT`) rather than a check-then-insert pattern.

---

## Agent designs

### Agent 1 — Status inference (email-triggered)

**Trigger**: new email arrives that matches a known job  
**Input**: email subject + body + current job status  
**Output**: new status + reasoning + optional note

**Agent loop**:
1. Tool call: fetch the full email thread for context
2. Tool call: fetch current job record and status history
3. Reasoning: classify the email intent — rejection, scheduling, offer, or noise?
4. Tool call: update job status if confidence is high, otherwise set `needs_review`

---

### Agent 2 — JD enrichment (insert-triggered, async)

**Trigger**: new job record inserted (from either source)  
**Input**: job title, company, URL, raw JD text (if available from extension scrape)  
**Output**: tech stack tags, seniority, remote/hybrid/onsite, salary range, resume fit score

**Agent loop**:
1. Tool call: fetch full JD text (from extension scrape or URL fetch)
2. Tool call: fetch user's resume snapshot
3. Reasoning: extract structured fields + score fit (0–100) with gap/strength explanation
4. Tool call: write enrichment back to job record

---

### Agent 3 — Nudge agent (scheduled)

**Trigger**: daily schedule  
**Input**: all jobs in Applied/Interview with no status change in N days  
**Output**: drafted follow-up message per stale application

Implements "ghosted after 30 days" rule: if a job has been in Applied or Interview with no email activity for 30 days, auto-move to Ghosted.

---

### Agent 4 — Pattern agent (threshold-triggered)

**Trigger**: fires when total job count crosses 20, then every 10 new jobs  
**Output**: 3–5 natural language insights written to an `insights` table

---

## Build order

| Phase | Status | What |
|---|---|---|
| 1 — Core data layer | ✅ Done | Postgres + FastAPI + SQLAlchemy + Alembic + full CRUD |
| 2 — Chrome extension | ✅ Done | Vite + React + Clerk auth + auto-scrape + AI extraction fallback (Kimi K2.5) + Save for Later |
| 3 — Deduplication | ✅ Done | rapidfuzz token_sort_ratio, 85% threshold, domain-scoped per user |
| 4a — Auth (Clerk) | ✅ Done | ClerkProvider on frontend, JWT verification on backend, multi-tenant jobs |
| 4b — Gmail OAuth | ✅ Done | OAuth flow, token storage in `gmail_credentials`, connect/disconnect UI |
| 5 — Gmail polling | 🔲 Next | Background task polling Gmail API, email parsing, linking to job records |
| 6 — Status inference agent | 🔲 | Pydantic AI agent: email → classify → update kanban status |
| 7 — Frontend kanban | ✅ Done | 6-column drag-and-drop kanban, status update via PATCH, full-viewport layout |
| 8 — Enrichment agent | 🔲 | Async JD parsing + resume fit score on every new job insert |
| 9 — Ghosting rule | 🔲 | Auto-move Applied/Interview → Ghosted after 30 days with no email activity |
| 10 — Nudge agent | 🔲 | Scheduled follow-up drafts for stale applications |
| 11 — Pattern agent | 🔲 | Insights after 20+ jobs accumulated |

---

## What's next (Phase 5 — Gmail polling)

The OAuth credentials are stored in `gmail_credentials`. The next step is to actually read emails:

1. **Background polling task** — `asyncio` task started at app startup, loops every 15–30 min per user who has Gmail connected
2. **History-based fetching** — store `historyId` on `GmailCredential` and use `users.history.list` to only fetch new messages since last poll
3. **Token refresh** — check `token_expiry` before each API call; use refresh token to get a new access token if expired
4. **Email parser** — extract sender domain + subject line; run deduplication against existing jobs
5. **Status agent trigger** — pass each matched email to the status inference agent

Key decision before building: **polling vs Pub/Sub**. Polling is simpler and sufficient for a personal tool. Pub/Sub gives real-time updates but requires a Google Cloud project with Pub/Sub enabled. Recommend polling for now.

---

## Tech stack (actual)

| Layer | Technology |
|---|---|
| Backend API | Python 3.12, FastAPI, SQLAlchemy (async), asyncpg |
| Database | PostgreSQL 18 (Docker) |
| Migrations | Alembic |
| Auth | Clerk (`@clerk/nextjs` v7, `@clerk/chrome-extension` v3), JWT via `python-jose` |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui (Base UI) |
| Kanban | `@reui/c-kanban-3` (dnd-kit under the hood) |
| Chrome extension | Vite 6, React 19, TypeScript, Tailwind v4, `@clerk/chrome-extension` |
| AI extraction | Vercel AI SDK v6, `@ai-sdk/openai`, Kimi K2.5 (Moonshot AI) |
| AI agents (planned) | Pydantic AI |
| Deduplication | rapidfuzz |
| Gmail | Google OAuth 2.0, Gmail REST API |
| Package manager (JS) | Bun |
| Package manager (Python) | uv |
