import { useState } from 'react'
import { createPortal } from 'react-dom'
import { TriangleAlert } from 'lucide-react'
import { AlertModal } from '../WeatherAlerts'
import { resolveStyle } from '../../utils/alertStyle'

// Severity order for picking which alert the pill speaks for when several are
// active. Only Extreme and Severe reach here — the pill exists for the alerts
// that would change what you do today, and a Minor advisory following you from
// tab to tab is noise.
const RANK = { Extreme: 0, Severe: 1 }

// The alert banner lives on the Today page, which means that on the web app's
// other five tabs a severe alert is invisible until you navigate back. This is
// the marker that follows you: a pill beside the page tabs that opens the alert
// in place, so no tab is a dead end for it. Not rendered on Today itself, where
// the full banner is already on screen.
export function WebAlertPill({ alerts, tab }) {
  const [open, setOpen] = useState(false)

  const severe = (alerts ?? [])
    .filter((a) => RANK[a.properties?.severity] != null)
    .sort((a, b) => RANK[a.properties.severity] - RANK[b.properties.severity])

  if (tab === 'today' || !severe.length) return null

  const top = severe[0]
  const style = resolveStyle(top.properties)
  // A Warning means the hazard is happening or imminent, so it pulses — the
  // same test .alert-row-icon uses on the banner, rather than severity, which
  // rates a Tornado Watch Extreme too.
  const critical = /warning$/i.test((top.properties.event ?? '').trim())

  return (
    <>
      <button
        className={`web-alert-pill${critical ? ' web-alert-pill--critical' : ''}`}
        style={{ '--alert-color': style.color, '--alert-bg': style.bg }}
        onClick={() => setOpen(true)}
        // The pill is an icon alone, so its whole meaning has to live here.
        aria-label={`${top.properties.event}. Open alert details`}
      >
        <TriangleAlert size={16} aria-hidden="true" />
      </button>

      {open && createPortal(
        <AlertModal alert={top} onClose={() => setOpen(false)} />,
        document.getElementById('alert-portal-root') ?? document.body
      )}
    </>
  )
}
