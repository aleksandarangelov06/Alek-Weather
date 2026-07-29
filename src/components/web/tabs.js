import { useState } from 'react'

const TAB_KEY = 'alek-weather-web-tab'

// Only the pages the app actually has data for. There is deliberately no
// Monthly / Allergies / Pollen tab: the forecast API is capped at 7 days and
// nothing in the app fetches pollen, so those would be empty shells.
export const TABS = [
  { id: 'today',   label: 'Today'       },
  { id: 'hourly',  label: 'Hourly'      },
  { id: 'daily',   label: '7 Day'       },
  { id: 'details', label: 'Details'     },
  { id: 'radar',   label: 'Radar'       },
  { id: 'air',     label: 'Air Quality' },
]

// The selected page. It lives above both the header (which draws the tab bar)
// and the page area (which draws the tab's contents), so it is owned by App
// rather than by either of them.
export function useWebTab() {
  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem(TAB_KEY)
    return TABS.some((t) => t.id === saved) ? saved : 'today'
  })

  const changeTab = (id) => {
    setTab(id)
    localStorage.setItem(TAB_KEY, id)
    // A page swap is a navigation, so it starts at the top of the new page
    // rather than wherever the previous one happened to be scrolled to.
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  return [tab, changeTab]
}
