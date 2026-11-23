import { liveWeatherSource } from '../utils/weatherCodes'

// Where the forecast on screen came from, under the last card on the phone:
// the forecast's providers, and the one source that decided the current
// condition (see liveWeatherSource for how that is worked out).

function stationName(current) {
  const { station_name: name, station_id: id } = current
  if (name && id) return `${name} (${id})`
  return name ?? (id ? `station ${id}` : 'a nearby station')
}

function conditionLine(source, current) {
  switch (source) {
    case 'station':  return `Conditions observed at ${stationName(current)}`
    case 'warning':  return 'Conditions from an active NWS warning'
    case 'forecast': return 'Conditions from the NWS hourly forecast'
    case 'radar':    return 'Conditions from live radar'
    case 'nowcast':  return 'Conditions from the Open-Meteo nowcast'
    default:         return 'Conditions from the Open-Meteo model'
  }
}

export function SourceNote({ current, minutely, radarClear }) {
  if (!current) return null
  // nws_hourly alone is enough for readings saved before nws_forecast existed.
  const nws = current.nws_forecast || current.nws_hourly
  const source = liveWeatherSource(current, minutely, radarClear)
  return (
    <div className="source-note">
      <p>{nws ? 'Forecast from the National Weather Service and Open-Meteo' : 'Forecast from Open-Meteo'}</p>
      {source && <p>{conditionLine(source, current)}</p>}
    </div>
  )
}
