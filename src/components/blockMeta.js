import { CalendarDays, Clock, Eye, LayoutGrid, Radar as RadarIcon, Sparkles, Umbrella } from 'lucide-react'

// The forecast cards as reorder mode lists them: the name each one carries on
// its own heading, and an icon for it.
const BLOCK_META = {
  overview: { label: 'Weather insight', Icon: Sparkles },
  today:    { label: 'At a glance',     Icon: Eye },
  nowcast:  { label: 'Precipitation',   Icon: Umbrella },
  hourly:   { label: 'Hourly forecast', Icon: Clock },
  daily:    { label: '7-day forecast',  Icon: CalendarDays },
  details:  { label: 'Details',         Icon: LayoutGrid },
  radar:    { label: 'Radar',           Icon: RadarIcon },
}

export const blockMeta = (id) => BLOCK_META[id] ?? { label: id, Icon: LayoutGrid }
