import { useEffect, useState } from 'react'
import { useAuth, UserButton } from '@clerk/chrome-extension'

type View = 'scanning' | 'confirm' | 'success' | 'error'
type SaveStatus = 'applied' | 'shortlisted'

interface ScrapedJob {
  title: string
  company: string
  url: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// Runs in the page context — must be completely self-contained.
function scrapeJobPage(): { title: string; company: string; url: string } {
  const hostname = window.location.hostname
  const pathParts = window.location.pathname.split('/').filter(Boolean)

  function q(selector: string): string {
    return (document.querySelector(selector) as HTMLElement)?.innerText?.trim() ?? ''
  }
  function getMeta(prop: string): string {
    return (
      (document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement)?.content ||
      (document.querySelector(`meta[name="${prop}"]`) as HTMLMetaElement)?.content ||
      ''
    )
  }
  function toTitleCase(s: string): string {
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
    // boards.greenhouse.io/<company>/jobs/<id>
    company = q('.company-name') || toTitleCase(pathParts[0] ?? '')
  } else if (hostname.includes('lever.co')) {
    title = q('.posting-headline h2') || q('h2')
    // jobs.lever.co/<company>/<id>
    company = toTitleCase(pathParts[0] ?? '')
  } else if (hostname.includes('myworkdayjobs.com') || hostname.includes('workday.com')) {
    title =
      q('[data-automation-id="jobPostingHeader"]') ||
      q('h2[data-automation-id="jobTitle"]') ||
      q('h1')
    // Extract company from subdomain: amazon.myworkdayjobs.com → Amazon
    company = toTitleCase(hostname.split('.')[0] ?? '')
  } else if (hostname.includes('indeed.com')) {
    title = q('h1.jobsearch-JobInfoHeader-title') || q('[data-testid="jobsearch-JobInfoHeader-title"]') || q('h1')
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
    company = toTitleCase(pathParts[0] ?? '') || getMeta('og:site_name')
  }

  // Generic fallback
  if (!title) title = getMeta('og:title') || q('h1') || document.title
  if (!company) company = getMeta('og:site_name') || ''

  return { title, company, url: window.location.href }
}

export function JobTracker() {
  const { getToken } = useAuth()
  const [view, setView] = useState<View>('scanning')
  const [job, setJob] = useState<ScrapedJob>({ title: '', company: '', url: '' })
  const [errorMsg, setErrorMsg] = useState('')
  const [savedStatus, setSavedStatus] = useState<SaveStatus>('applied')
  const [isDuplicate, setIsDuplicate] = useState(false)

  useEffect(() => {
    autoScan()
  }, [])

  async function autoScan() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: scrapeJobPage,
      })
      setJob(result as ScrapedJob)
    } catch {
      // Silently fall through — user can fill in manually
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
    setView('scanning')
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
          <div className="flex items-center gap-2 py-4 text-sm text-zinc-400">
            <SpinnerIcon />
            Scanning page…
          </div>
        )}

        {view === 'confirm' && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Review &amp; Save</p>
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
            <div className={`inline-flex size-10 items-center justify-center rounded-full ${isDuplicate ? 'bg-amber-50' : savedStatus === 'shortlisted' ? 'bg-violet-50' : 'bg-green-50'}`}>
              {isDuplicate ? <RepeatIcon /> : savedStatus === 'shortlisted' ? <BookmarkIcon /> : <CheckIcon />}
            </div>
            <p className="text-sm font-medium">
              {isDuplicate
                ? 'Already tracking this job.'
                : savedStatus === 'shortlisted'
                ? 'Saved for later.'
                : 'Job saved!'}
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
            <div className="flex gap-2">
              <button
                onClick={() => setView('confirm')}
                className="flex-1 border border-zinc-200 text-sm py-2 px-4 rounded-md hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                Go back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
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

function BriefcaseIcon() {
  return (
    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="size-4 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
