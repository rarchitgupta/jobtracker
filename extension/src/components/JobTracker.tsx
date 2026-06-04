import { useEffect, useState } from 'react'
import { useAuth, UserButton } from '@clerk/chrome-extension'
import { generateObject } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

type View = 'scanning' | 'extracting' | 'confirm' | 'success' | 'error'
type SaveStatus = 'applied' | 'shortlisted'

interface Job {
  title: string
  company: string
  url: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const MOONSHOT_KEY = import.meta.env.VITE_MOONSHOT_API_KEY as string | undefined

const kimi = MOONSHOT_KEY
  ? createOpenAI({ baseURL: 'https://api.moonshot.cn/v1', apiKey: MOONSHOT_KEY })
  : null

const extractionSchema = z.object({
  title: z.string().describe('Job title or position name. Empty string if not determinable.'),
  company: z.string().describe('Company or organisation name. Empty string if not determinable.'),
})

// Runs in page context — must be completely self-contained, no imports or closures.
function scrapeJobPage(): { title: string; company: string; url: string; pageText: string } {
  const hostname = window.location.hostname
  const pathParts = window.location.pathname.split('/').filter(Boolean)

  function q(sel: string): string {
    return (document.querySelector(sel) as HTMLElement)?.innerText?.trim() ?? ''
  }
  function getMeta(prop: string): string {
    return (
      (document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement)?.content ||
      (document.querySelector(`meta[name="${prop}"]`) as HTMLMetaElement)?.content ||
      ''
    )
  }
  function titleCase(s: string): string {
    return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  let title = ''
  let company = ''

  if (hostname.includes('linkedin.com')) {
    title =
      q('.job-details-jobs-unified-top-card__job-title h1') ||
      q('h1.t-24') ||
      q('.jobs-unified-top-card__job-title h1')
    company =
      q('.job-details-jobs-unified-top-card__company-name a') ||
      q('.jobs-unified-top-card__company-name a') ||
      q('.topcard__org-name-link')
  } else if (hostname.includes('greenhouse.io')) {
    title = q('.app-title') || q('#app_body h1') || q('h1')
    company = q('.company-name') || titleCase(pathParts[0] ?? '')
  } else if (hostname.includes('lever.co')) {
    title = q('.posting-headline h2') || q('h2')
    company = titleCase(pathParts[0] ?? '')
  } else if (hostname.includes('myworkdayjobs.com') || hostname.includes('workday.com')) {
    title =
      q('[data-automation-id="jobPostingHeader"]') ||
      q('h2[data-automation-id="jobTitle"]') ||
      q('h1')
    company = titleCase(hostname.split('.')[0] ?? '')
  } else if (hostname.includes('indeed.com')) {
    title =
      q('h1.jobsearch-JobInfoHeader-title') ||
      q('[data-testid="jobsearch-JobInfoHeader-title"]') ||
      q('h1')
    company =
      q('[data-company-name]') ||
      q('[data-testid="inlineHeader-companyName"] a') ||
      q('.icl-u-lg-mr--sm.icl-u-xs-mr--xs')
  } else if (hostname.includes('glassdoor.com')) {
    title = q('[data-test="job-title"]') || q('h1')
    company = q('[data-test="employer-name"]') || q('.employer-name')
  } else if (hostname.includes('smartrecruiters.com')) {
    title = q('.job-title') || q('h1')
    company = q('.company-name') || getMeta('og:site_name')
  } else if (hostname.includes('ashbyhq.com') || hostname.includes('jobs.ashby.io')) {
    title = q('[class*="JobPostingTitle"]') || q('h1')
    company = titleCase(pathParts[0] ?? '') || getMeta('og:site_name')
  }

  if (!title) title = getMeta('og:title') || q('h1') || document.title
  if (!company) company = getMeta('og:site_name') || ''

  const mainEl =
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('article') ||
    document.body
  const pageText = ((mainEl as HTMLElement)?.innerText ?? '').slice(0, 3000).trim()

  return { title, company, url: window.location.href, pageText }
}

export function JobTracker() {
  const { getToken } = useAuth()
  const [view, setView] = useState<View>('scanning')
  const [job, setJob] = useState<Job>({ title: '', company: '', url: '' })
  const [errorMsg, setErrorMsg] = useState('')
  const [savedStatus, setSavedStatus] = useState<SaveStatus>('applied')
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [aiUsed, setAiUsed] = useState(false)

  useEffect(() => { autoScan() }, [])

  async function autoScan() {
    setView('scanning')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    let scraped = { title: '', company: '', url: '', pageText: '' }

    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: scrapeJobPage,
      })
      scraped = result as typeof scraped
    } catch {
      // silently fall through — user fills in manually
    }

    setJob({ title: scraped.title, company: scraped.company, url: scraped.url })

    const needsAI = kimi && scraped.pageText && (!scraped.title || !scraped.company)

    if (needsAI) {
      setView('extracting')
      try {
        const { object } = await generateObject({
          model: kimi!('kimi-k2-5'),
          output: 'object',
          schema: extractionSchema,
          prompt: buildExtractionPrompt(scraped),
        })
        setJob(j => ({
          ...j,
          title: j.title || object.title,
          company: j.company || object.company,
        }))
        setAiUsed(true)
      } catch {
        // LLM failed — proceed with whatever DOM scraping found
      }
    }

    setView('confirm')
  }

  async function handleSave(status: SaveStatus) {
    if (!job.title || !job.company) {
      setErrorMsg('Title and company are required.')
      setView('error')
      return
    }
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/jobs/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token!}`,
        },
        body: JSON.stringify({ ...job, status }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const json = await res.json()
      setSavedStatus(status)
      setIsDuplicate(json.duplicate ?? false)
      setView('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setView('error')
    }
  }

  function resetToNew() {
    setJob({ title: '', company: '', url: '' })
    setAiUsed(false)
    autoScan()
  }

  return (
    <div className="flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className="flex size-5 items-center justify-center rounded bg-zinc-900">
            <BriefcaseIcon />
          </div>
          <span className="text-sm font-semibold">Job Tracker</span>
        </div>
        <UserButton />
      </header>

      <div className="p-4">
        {view === 'scanning' && (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
            <SpinnerIcon />
            Scanning page…
          </div>
        )}

        {view === 'extracting' && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded bg-violet-100">
                <SparklesIcon />
              </span>
              <span className="text-xs font-medium text-violet-700">Extracting with AI…</span>
            </div>
            <div className="space-y-2">
              {job.title
                ? <Field label="Title" value={job.title} onChange={v => setJob(j => ({ ...j, title: v }))} />
                : <SkeletonField label="Title" />}
              {job.company
                ? <Field label="Company" value={job.company} onChange={v => setJob(j => ({ ...j, company: v }))} />
                : <SkeletonField label="Company" />}
              <SkeletonField label="URL" />
            </div>
          </div>
        )}

        {view === 'confirm' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Review &amp; Save</p>
              {aiUsed && (
                <span className="inline-flex items-center gap-1 text-xs text-violet-500">
                  <SparklesIcon />
                  AI-extracted
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Field label="Title" value={job.title} onChange={v => setJob(j => ({ ...j, title: v }))} />
              <Field label="Company" value={job.company} onChange={v => setJob(j => ({ ...j, company: v }))} />
              <Field label="URL" value={job.url} onChange={v => setJob(j => ({ ...j, url: v }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleSave('shortlisted')}
                className="flex-1 border border-zinc-200 text-sm py-2 px-3 rounded-md hover:bg-zinc-50 transition-colors cursor-pointer text-zinc-700"
              >
                Save for Later
              </button>
              <button
                onClick={() => handleSave('applied')}
                className="flex-1 bg-zinc-900 text-white text-sm font-medium py-2 px-3 rounded-md hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Save as Applied
              </button>
            </div>
          </div>
        )}

        {view === 'success' && (
          <div className="space-y-3 text-center py-2">
            <div className={`inline-flex size-10 items-center justify-center rounded-full ${
              isDuplicate ? 'bg-amber-50' : savedStatus === 'shortlisted' ? 'bg-violet-50' : 'bg-green-50'
            }`}>
              {isDuplicate ? <RepeatIcon /> : savedStatus === 'shortlisted' ? <BookmarkIcon /> : <CheckIcon />}
            </div>
            <p className="text-sm font-medium">
              {isDuplicate ? 'Already tracking this job.' : savedStatus === 'shortlisted' ? 'Saved for later.' : 'Job saved!'}
            </p>
            <button
              onClick={resetToNew}
              className="w-full border border-zinc-200 text-sm py-2 px-4 rounded-md hover:bg-zinc-50 transition-colors cursor-pointer"
            >
              Track another
            </button>
          </div>
        )}

        {view === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-500">{errorMsg}</p>
            <button
              onClick={() => setView('confirm')}
              className="w-full border border-zinc-200 text-sm py-2 px-4 rounded-md hover:bg-zinc-50 transition-colors cursor-pointer"
            >
              Go back
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function buildExtractionPrompt(scraped: { title: string; company: string; pageText: string }) {
  return `Extract the job title and company name from this job posting page.
${scraped.title ? `Title is already known: "${scraped.title}" — return it unchanged.` : 'Title is missing — extract it.'}
${scraped.company ? `Company is already known: "${scraped.company}" — return it unchanged.` : 'Company is missing — extract it.'}
If you cannot determine a field with confidence, return an empty string.

Page text:
${scraped.pageText}`
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm border border-zinc-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-900 bg-white"
      />
    </div>
  )
}

function SkeletonField({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <div className="h-[30px] rounded-md bg-zinc-100 animate-pulse" />
    </div>
  )
}

function BriefcaseIcon() {
  return (
    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="size-4 animate-spin text-zinc-300" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg className="size-3 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="size-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg className="size-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
    </svg>
  )
}

function RepeatIcon() {
  return (
    <svg className="size-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.657 48.657 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
    </svg>
  )
}
