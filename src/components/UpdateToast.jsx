import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { IS_ANDROID_APP } from '../utils/version'

// How long to leave the app alone before the first check. Not a performance
// number — the check is one small request on a native thread — but a "let the
// weather arrive first" one: the update bar sliding in over a still-loading
// screen reads as part of the loading, and gets dismissed as such.
const DELAY_MS = 4000

// At most one check this often. The APK is sideloaded and a release is a manual
// act, so a release is at most a weekly event; checking on every cold start
// would be a request per launch to learn nothing. Kept short enough that an
// update still surfaces the same day it lands.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

const LAST_CHECK_KEY = 'alek-weather-update-checked'
// The version the user said Later to. Stored as the version rather than a flag,
// so declining 0.6 says nothing about 0.7 — the bar comes back for the next
// release without ever nagging about the one that was turned down.
const SKIPPED_KEY = 'alek-weather-update-skipped'

/**
 * The APK's "there is a new version" bar.
 *
 * Everything underneath this is already native and already used by Settings'
 * manual Check (see UpdateSection in SettingsPage, and Updater in
 * MainActivity): window.AndroidUpdate.check() asks the GitHub Releases API,
 * install(url) downloads and hands the APK to the system installer, and both
 * report back as `alekupdate` / `alekupdateprogress` events on window. This is
 * the automatic half — the check nobody has to remember to run.
 *
 * Only ever appears with an answer worth acting on. A check that comes back
 * current, or that fails because the phone is offline, leaves no trace: this
 * wasn't asked for, so it has nothing to report back.
 */
export function UpdateToast() {
  // hidden | available | downloading | permission | error
  const [phase, setPhase] = useState('hidden')
  const [latest, setLatest] = useState('')
  const [pct, setPct] = useState(0)
  const urlRef = useRef(null)
  // Read inside the event listeners, which are bound once and would otherwise
  // close over the first render's phase.
  const phaseRef = useRef('hidden')
  const go = (next) => { phaseRef.current = next; setPhase(next) }
  // Whether the result now arriving is the answer to *our* check. Settings can
  // run its own at any time, and its results belong in Settings — without this,
  // tapping Check there would pop this bar over the page you tapped it on.
  const mine = useRef(false)

  useEffect(() => {
    if (!IS_ANDROID_APP) return

    const onResult = (e) => {
      const d = e.detail || {}
      const showing = phaseRef.current !== 'hidden'
      if (d.status === 'available') {
        // Not ours, and nothing on screen to update: Settings is handling it.
        if (!mine.current && !showing) return
        mine.current = false
        if (!showing && localStorage.getItem(SKIPPED_KEY) === d.latest) return
        urlRef.current = d.url
        setLatest(d.latest)
        go('available')
        return
      }
      mine.current = false
      // 'current' and 'error' are only worth saying while the bar is up, and
      // then only because the user has just pressed something and is waiting on
      // an answer. Silent otherwise.
      if (!showing) return
      if (d.status === 'permission') go('permission')
      else if (d.status === 'error') go('error')
      else go('hidden')
    }
    const onProgress = (e) => {
      if (phaseRef.current === 'hidden') return
      setPct(Number(e.detail) || 0)
      go('downloading')
    }
    window.addEventListener('alekupdate', onResult)
    window.addEventListener('alekupdateprogress', onProgress)

    let timer = null
    const last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0
    if (Date.now() - last >= CHECK_EVERY_MS) {
      timer = setTimeout(() => {
        // Written before the answer, not after: a check that fails should still
        // hold the next one off, or an offline phone retries every launch.
        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
        mine.current = true
        window.AndroidUpdate?.check()
      }, DELAY_MS)
    }

    return () => {
      clearTimeout(timer)
      window.removeEventListener('alekupdate', onResult)
      window.removeEventListener('alekupdateprogress', onProgress)
    }
  }, [])

  if (phase === 'hidden') return null

  const dismiss = () => {
    // Only "Later" on an offered update is a decision about that version; a
    // dismissed error or permission notice shouldn't silence the next check.
    if (phase === 'available' && latest) localStorage.setItem(SKIPPED_KEY, latest)
    go('hidden')
  }

  const install = () => {
    setPct(0)
    go('downloading')
    window.AndroidUpdate?.install(urlRef.current)
  }

  const text = {
    available: `Version ${latest} is ready to install.`,
    downloading: `Downloading… ${pct}%`,
    permission: 'Allow installs from Alek Weather, then tap Update again.',
    error: "Couldn't download the update. Try again later.",
  }[phase]

  return (
    <div className="update-toast" role="status">
      <div className="update-toast-text">
        <span className="update-toast-title">
          {phase === 'downloading' ? 'Updating' : 'Update available'}
        </span>
        <span className="update-toast-sub">{text}</span>
      </div>
      {phase === 'downloading' ? (
        // No way out mid-download: the install is native from here and there is
        // nothing this bar could cancel. A progress bar under the row is the
        // whole of what it has left to say.
        <div className="update-toast-bar"><div style={{ width: `${pct}%` }} /></div>
      ) : (
        <div className="update-toast-actions">
          {phase !== 'error' && (
            <button className="install-btn" onClick={install}>Update</button>
          )}
          <button className="update-toast-close" onClick={dismiss} aria-label="Dismiss">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
