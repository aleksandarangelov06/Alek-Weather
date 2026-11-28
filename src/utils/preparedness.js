// What to have ready for the weather the Storm Center is showing: a short
// checklist picked from the hazards' levels (analyzeStorm in stormCenter.js),
// the alerts in force and the temperature, and how urgent getting ready is.
// Based on the standard ready.gov / Red Cross kit lists; the page draws each
// item with an icon (StormCenterPage.jsx, PREP_ICONS).

import { isPointAlert, isStormAlert } from './stormCenter'

// Alerts, by what they ask of you.
const RE = {
  tornado: /tornado/i,
  severe: /severe thunderstorm|extreme wind/i,
  flood: /flood|hydrologic|storm surge/i,
  tropical: /hurricane|tropical storm|typhoon/i,
  winter: /blizzard|winter storm|ice storm|lake effect|winter weather|freezing rain/i,
  cold: /extreme cold|wind chill|cold weather|freeze/i,
  heat: /heat/i,
  wind: /high wind|wind advisory|dust storm/i,
  fire: /red flag|fire weather/i,
}

// Every item there is, most important first within a storm. `why` is the one
// line under it.
const ITEMS = [
  { id: 'shelter', label: 'Pick your safe spot', why: 'An interior room on the lowest floor, away from windows.' },
  { id: 'alerts', label: 'Keep alerts on', why: 'A weather radio, or phone alerts with the sound up.' },
  { id: 'charge', label: 'Charge your phone', why: 'And any power banks, in case the power goes out.' },
  { id: 'flashlight', label: 'Flashlight and batteries', why: 'Skip candles; they are a fire risk.' },
  { id: 'firstaid', label: 'First aid kit', why: 'Bandages, pain relievers, and any personal medical supplies.' },
  { id: 'water', label: 'Drinking water', why: 'About a gallon per person, per day.' },
  { id: 'groceries', label: 'Stock up on groceries', why: 'Shop before it starts, while roads are clear and shelves are full.' },
  { id: 'food', label: 'Food that needs no cooking', why: 'Enough for a few days, and a manual can opener.' },
  { id: 'meds', label: 'Medications', why: 'A few days’ supply of anything you take daily.' },
  { id: 'outdoor', label: 'Secure outdoor items', why: 'Bring in or tie down furniture, bins and decorations.' },
  { id: 'route', label: 'Know your way to higher ground', why: 'Never drive through flooded roads.' },
  { id: 'gobag', label: 'Pack a go bag', why: 'Documents, cash, chargers and a change of clothes.' },
  { id: 'fuel', label: 'Fill up the car', why: 'Gas stations close when the power is out.' },
  { id: 'shovel', label: 'Shovel and ice melt', why: 'Clear steps and paths before they freeze over.' },
  { id: 'warm', label: 'Warm layers and blankets', why: 'For you, and a set in the car.' },
  { id: 'cool', label: 'Plan to stay cool', why: 'Water, shade, and a cooled place to go in the hottest hours.' },
]
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]))

// Urgency, by the threat level and the alerts. Warnings (and Extreme) say act.
export const PREP_LEVELS = [
  { id: 'aware', label: 'Stay aware', text: 'Nothing to do yet. Know where these are in case it picks up.' },
  { id: 'ready', label: 'Get ready', text: 'Worth getting these together now, while it is calm.' },
  { id: 'act', label: 'Act now', text: 'Have these on hand and be ready to take shelter.' },
]

// Ahead of a storm (see stormOutlook): before it starts, there is still time
// to shop, fill up and get the shovel out, so the list says so.
const AHEAD = { id: 'ready', label: 'Get ready', text: 'It is on the way. Get these sorted before it starts, while roads are clear.' }
const OUTLOOK_HAZARD = { thunder: 'thunder', rain: 'rain', wind: 'wind', snow: 'snow', ice: 'snow' }

// `outlook` is the storm in the next three days, if any (stormOutlook): its
// hazard counts at its expected level, so the list is ready before it is here.
export function preparedness(storm, currentTempF, outlook = null) {
  const events = storm.alerts.map((a) => a.properties?.event ?? '')
  const has = (key) => events.some((e) => RE[key].test(e))
  const outlookHazard = outlook ? OUTLOOK_HAZARD[outlook.kind] : null
  const lvl = (id) => Math.max(
    storm.hazards[id]?.level.index ?? 0,
    id === outlookHazard ? outlook.level.index : 0,
  )
  const threat = storm.threat.level.index
  // Act now for a warning drawn around the storm itself, or a storm alert
  // rated Extreme. A zone-wide warning (winter storm, wind) covers a county or
  // more, so this spot's own forecast (the threat level) decides instead. Not
  // for heat, cold or coastal alerts rated Extreme: "be ready to take
  // shelter" is storm advice, and their own items still come from `has` below.
  const warning = storm.alerts.some((a) =>
    isPointAlert(a.properties) || (isStormAlert(a) && a.properties?.severity === 'Extreme'))

  const want = new Set()
  const add = (...ids) => ids.forEach((id) => want.add(id))

  if (has('tornado')) add('shelter', 'alerts', 'charge', 'flashlight', 'firstaid')
  if (has('severe') || lvl('thunder') >= 3) add('alerts', 'charge', 'flashlight', 'shelter')
  if (lvl('thunder') >= 2) add('charge', 'flashlight')
  if (has('tropical')) add('groceries', 'water', 'food', 'meds', 'gobag', 'fuel', 'flashlight', 'charge', 'firstaid', 'outdoor')
  if (has('flood') || lvl('rain') >= 3) add('route', 'gobag', 'charge')
  if (has('wind') || lvl('wind') >= 2) add('outdoor', 'flashlight', 'charge')
  // By how much snow there is here for this place (the snow level is rated
  // against what it is used to), not by the zone's alert alone.
  if (lvl('snow') >= 3) add('groceries', 'shovel', 'warm', 'flashlight', 'water', 'food', 'fuel')
  else if (lvl('snow') >= 2) add('groceries', 'shovel', 'warm', 'fuel')
  else if (lvl('snow') >= 1 || has('winter')) add('shovel', 'warm')
  if (has('cold') || (Number.isFinite(currentTempF) && currentTempF <= 15)) add('warm', 'meds')
  if (has('heat')) add('cool', 'water', 'meds')
  if (has('fire')) add('gobag', 'alerts', 'charge')
  if (threat >= 3) add('groceries', 'water', 'food', 'meds', 'firstaid')
  // An ice storm brings down lines and closes roads for days, however little
  // snow comes with it.
  if (events.some((e) => /ice storm|freezing rain/i.test(e)) || outlook?.kind === 'ice') add('groceries', 'flashlight', 'warm')
  // A big storm still to come: stock up and fill up while it is easy.
  const coming = outlook && outlook.startIdx > 0
  if (coming && outlook.level.index >= 3) add('groceries', 'fuel', 'water', 'meds')
  if (threat >= 2) add('firstaid')
  // Something is going on, so always the basics.
  add('charge', 'flashlight')

  const items = ITEMS.filter((i) => want.has(i.id)).map((i) => BY_ID[i.id])
  const now = warning || threat >= 3 ? 2 : threat >= 2 ? 1 : 0
  const level = coming && now < 2 ? AHEAD : PREP_LEVELS[now]
  return { level, items }
}
