import { useState } from 'react'
import { useAuth, UserButton } from '@clerk/chrome-extension'

type View = 'scan' | 'confirm' | 'success' | 'error'

interface ScrapedJob {
  title: string
  company: string
  url: string
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// Runs in the page context — must be self-contained, no imports or closures.
function scrapeJobPage(): ScrapedJob {
  function getMeta(prop: string) {
    return (
      (document.querySelector(`meta[property="${prop}"]`) as HTMLMetaElement)?.content ||
      (document.querySelector(`meta[name="${prop}"]`) as HTMLMetaElement)?.content ||
      ''
    )
  }
  return {
    title:
      getMeta('og:title') ||
      (document.querySelector('h1') as HTMLElement)?.innerText?.trim() ||
      document.title ||
      '',
    company:
      getMeta('og:site_name') ||
      (document.querySelector('[data-company]') as HTMLElement)?.innerText?.trim() ||
      '',
    url: window.location.href,
  }
}

export function JobTracker() {
  const { getToken } = useAuth()
  const [view, setView] = useState<View>('scan')
  const [job, setJob] = useState<ScrapedJob>({ title: '', company: '', url: '' })
  const [errorMsg, setErrorMsg] = useState('')
  const [errorReturn, setErrorReturn] = useState<'scan' | 'confirm'>('scan')
  const [isDuplicate, setIsDuplicate] = useState(false)

  async function handleScan() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: scrapeJobPage,
      })
      setJob(result as ScrapedJob)
      setView('confirm')
    } catch {
      setErrorMsg('Could not scan this page.')
      setErrorReturn('scan')
      setView('error')
    }
  }

  async function handleSave() {
    if (!job.title || !job.company) {
      setErrorMsg('Title and company are required.')
      setErrorReturn('confirm')
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
        body: JSON.stringify(job),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const json = await res.json()
      setIsDuplicate(json.duplicate ?? false)
      setView('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error')
      setErrorReturn('confirm')
      setView('error')
    }
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
        {view === 'scan' && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">Open a job listing and scan the page to track your application.</p>
            <button
              onClick={handleScan}
              className="w-full bg-zinc-900 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              Scan this page
            </button>
          </div>
        )}

        {view === 'confirm' && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Review &amp; Save</p>
            <div className="space-y-2">
              <Field label="Title" value={job.title} onChange={v => setJob(j => ({ ...j, title: v }))} />
              <Field label="Company" value={job.company} onChange={v => setJob(j => ({ ...j, company: v }))} />
              <Field label="URL" value={job.url} onChange={v => setJob(j => ({ ...j, url: v }))} />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setView('scan')}
                className="flex-1 border border-zinc-200 text-sm py-2 px-4 rounded-md hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 bg-zinc-900 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Save job
              </button>
            </div>
          </div>
        )}

        {view === 'success' && (
          <div className="space-y-3 text-center py-2">
            <div className={`inline-flex size-10 items-center justify-center rounded-full ${isDuplicate ? 'bg-amber-50' : 'bg-green-50'}`}>
              {isDuplicate ? <RepeatIcon /> : <CheckIcon />}
            </div>
            <p className="text-sm font-medium">
              {isDuplicate ? 'Already tracking this job.' : 'Job saved!'}
            </p>
            <button
              onClick={() => setView('scan')}
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
                onClick={() => setView(errorReturn)}
                className="flex-1 border border-zinc-200 text-sm py-2 px-4 rounded-md hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                Go back
              </button>
              <button
                onClick={errorReturn === 'confirm' ? handleSave : handleScan}
                className="flex-1 bg-zinc-900 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
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

function CheckIcon() {
  return (
    <svg className="size-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
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
