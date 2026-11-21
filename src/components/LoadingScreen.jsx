import { useEffect, useRef, useState } from 'react'
import { cloneBootStage, startBootCycle } from '../utils/bootStage'

// What the headline under the animation says while a forecast loads: a line
// picked at random every couple of seconds (never one of the last few), with
// some that only make sense by day or by night. Past SLOW_AFTER_MS it owns up
// that the load is slow instead: "Taking a little longer" first, then the rest
// of SLOW_LINES at random. Sentence case, no closing punctuation, and short
// enough to stay on one line on a narrow phone.
const LINES = [
  'Inspecting the sky',
  'Scanning ahead',
  'Looking for clouds',
  'Reading the radar',
  'Checking the wind',
  'Counting raindrops',
  'Asking the clouds',
  'Watching the horizon',
  'Measuring the breeze',
  'Tracking the weather',
  'Charting the skies',
  'Feeling for rain',
  'Reading the barometer',
  'Following the jet stream',
  'Mapping the pressure',
  'Sampling the air',
  'Checking the humidity',
  'Listening for thunder',
  'Studying the satellites',
  'Gauging the temperature',
  'Weighing the clouds',
  'Plotting the week ahead',
  'Sorting out the showers',
  'Deciding on umbrellas',
  'Spotting the fronts',
  'Peering into tomorrow',
  'Counting snowflakes',
  'Checking the dew point',
  'Looking past the clouds',
  'Polishing the forecast',
]
const DAY_LINES = [
  'Peeking at the sun',
  'Following the sunshine',
  'Measuring the sunshine',
  'Squinting at the sun',
  'Checking the UV',
  'Chasing the daylight',
]
const NIGHT_LINES = [
  'Looking for stars',
  'Checking on the moon',
  'Watching the night sky',
  'Counting the stars',
  'Scanning the dark skies',
  'Waiting on the sunrise',
]
const SLOW_LINES = [
  'Taking a little longer',
  'Still working on it',
  'Hang tight',
  'The forecast is on its way',
  'The clouds are being shy',
  'Still gathering the data',
  'Waiting on the forecast',
  'Good weather takes time',
  'Worth the wait, hopefully',
]

const SWAP_MS = 2400        // a new line this often
const SLOW_AFTER_MS = 7000  // when it switches to SLOW_LINES
const SLOW_SWAP_MS = 3600   // and how often those change (slower: less fidgety)
const RECENT = 4            // lines not reused until this many others have shown

function linePool() {
  const hour = new Date().getHours()
  return LINES.concat(hour >= 6 && hour < 20 ? DAY_LINES : NIGHT_LINES)
}

function pickFresh(pool, recent) {
  const fresh = pool.filter((line) => !recent.includes(line))
  const from = fresh.length ? fresh : pool
  return from[Math.floor(Math.random() * from.length)]
}

// The headline's lines as they come and go: the current one, plus the one it
// replaced while that rolls out. `slow` flips once the load passes
// SLOW_AFTER_MS, for the screen reader status.
function useLoadingLines() {
  const [first] = useState(() => pickFresh(linePool(), []))
  const [lines, setLines] = useState(() => [{ id: 0, text: first, out: false }])
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const started = performance.now()
    const pool = linePool()
    const recent = [first]
    const recentSlow = []
    let id = 0
    let timer = 0
    const show = (text) => {
      id += 1
      const next = { id, text, out: false }
      setLines((current) => [{ ...current[current.length - 1], out: true }, next])
    }
    const tick = () => {
      const elapsed = performance.now() - started
      if (elapsed >= SLOW_AFTER_MS - 50) {
        // "Taking a little longer" first, then the others at random, with the
        // same no-recent-repeats rule as the regular lines.
        let text = SLOW_LINES[0]
        if (recentSlow.length) text = pickFresh(SLOW_LINES.slice(1), recentSlow)
        else setSlow(true)
        recentSlow.push(text)
        if (recentSlow.length > RECENT) recentSlow.shift()
        show(text)
        timer = setTimeout(tick, SLOW_SWAP_MS)
        return
      }
      const text = pickFresh(pool, recent)
      recent.push(text)
      if (recent.length > RECENT) recent.shift()
      show(text)
      // Land the switch to the slow lines on time rather than up to a whole
      // swap late.
      timer = setTimeout(tick, Math.min(SWAP_MS, SLOW_AFTER_MS - (performance.now() - started)))
    }
    timer = setTimeout(tick, Math.min(SWAP_MS, SLOW_AFTER_MS))
    return () => clearTimeout(timer)
  }, [first])

  return { lines, slow }
}

// Shown while a forecast loads on the phone layouts: the boot screen's weather
// animation (the logo, rain, a storm, snow and sun popping in, in a random
// order), centred where the forecast will appear, so loading a place looks the
// same as opening the app. Under it, the headline (useLoadingLines), lettered
// like the header's place name.
//
// The animation itself is a clone of the boot screen's stage (see
// utils/bootStage.js), placed into an element React renders empty and never
// touches again, and removed with it; each showing gets its own shuffled scene
// order. The headline is hidden from screen readers, which would otherwise
// announce every playful swap; the status they get is one plain sentence,
// updated once if the load turns slow.
export function LoadingScreen() {
  const hostRef = useRef(null)
  const { lines, slow } = useLoadingLines()

  // Placed two frames in rather than with the first render. A refresh mounts
  // this in the same commit that takes the whole forecast down (the radar map
  // with it), and the teardown's cleanup runs just after; inserting the stage
  // then had its first pop and the drawing of its layers land in the busiest
  // frames of the refresh. Two frames on, that is over, and the animation
  // starts clean. The host keeps the stage's size meanwhile (App.css), so the
  // text doesn't shift when it arrives.
  //
  // Not at all while the boot screen still covers the app (a forecast loading
  // as it opens): that screen is already playing the animation on top. The
  // stage goes in once it starts to lift, so the loop starts fresh under the
  // fade. (The shuffled order runs on the Web Animations API, which the CSS
  // pause that holds the text back doesn't reach, hence holding the whole
  // stage back instead.)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = document.documentElement
    let stage = null
    let raf = 0
    let watch = null
    const place = () => {
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          stage = cloneBootStage()
          if (!stage) return
          host.appendChild(stage)
          startBootCycle(stage)
        })
      })
    }
    if (root.dataset.boot === 'cover') {
      watch = new MutationObserver(() => {
        if (root.dataset.boot === 'cover') return
        watch.disconnect()
        watch = null
        place()
      })
      watch.observe(root, { attributes: true, attributeFilter: ['data-boot'] })
    } else {
      place()
    }
    return () => {
      watch?.disconnect()
      cancelAnimationFrame(raf)
      stage?.remove()
    }
  }, [])

  return (
    <div className="loading-screen loading-cycle" role="status">
      <div ref={hostRef} className="loading-cycle-host" />
      <div className="loading-cycle-text" aria-hidden="true">
        <p className="loading-cycle-headline">
          {lines.map((line) => (
            <span
              key={line.id}
              className={`loading-cycle-line${line.out ? ' loading-cycle-line--out' : line.id > 0 ? ' loading-cycle-line--in' : ''}`}
            >
              {line.text}
            </span>
          ))}
        </p>
      </div>
      <span className="loading-cycle-sr">
        {slow ? 'Loading weather. This is taking a little longer.' : 'Loading weather'}
      </span>
    </div>
  )
}
