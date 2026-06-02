import { useEffect } from 'react'
import { ClerkProvider, useAuth } from '@clerk/chrome-extension'
import { JobTracker } from './components/JobTracker'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
const POPUP_URL = chrome.runtime.getURL('popup.html')
const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL ?? 'http://localhost:3000'

export default function App() {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      syncHost={WEB_APP_URL}
      __experimental_syncHostListener
      afterSignOutUrl={POPUP_URL}
      signInFallbackRedirectUrl={POPUP_URL}
      signUpFallbackRedirectUrl={POPUP_URL}
    >
      <AppContent />
    </ClerkProvider>
  )
}

function AppContent() {
  const { isSignedIn, isLoaded } = useAuth()

  useEffect(() => {
    console.log('[JobTracker] auth state:', { isLoaded, isSignedIn })
  }, [isLoaded, isSignedIn])

  if (!isLoaded) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    )
  }

  if (!isSignedIn) {
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100">
          <div className="flex size-5 items-center justify-center rounded bg-zinc-900">
            <BriefcaseIcon />
          </div>
          <span className="text-sm font-semibold">Job Tracker</span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-zinc-500">
            Sign in to start tracking job applications.
          </p>
          <button
            onClick={() => {
              console.log('[JobTracker] opening sign-in tab:', `${WEB_APP_URL}/sign-in`)
              chrome.tabs.create({ url: `${WEB_APP_URL}/sign-in` })
              window.close()
            }}
            className="w-full bg-zinc-900 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Sign in to Job Tracker
          </button>
          <p className="text-xs text-zinc-400 text-center">
            Opens the web app. Come back after signing in.
          </p>
        </div>
      </div>
    )
  }

  return <JobTracker />
}

function BriefcaseIcon() {
  return (
    <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}
