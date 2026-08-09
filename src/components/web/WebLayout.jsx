import { TodayPage } from './TodayPage'
import { HourlyPage } from './HourlyPage'
import { DailyPage } from './DailyPage'
import { DetailsPage } from './DetailsPage'
import { RadarPage } from './RadarPage'
import { AirQualityPage } from './AirQualityPage'

// The page area of the web app. The tab bar itself lives in the header (see
// App.jsx), so the selection is passed in rather than owned here.
export function WebLayout(props) {
  const {
    weather, location, airQuality, radarMode, unit, units, radarClear, colorCoding,
    weatherAnimations, tab, onNavigate,
  } = props

  return (
    <div className="web-shell">
      <div className="web-panel" id={`web-panel-${tab}`} role="tabpanel" aria-labelledby={`web-tab-${tab}`} key={tab}>
        {tab === 'today' && <TodayPage {...props} />}
        {tab === 'hourly' && (
          <HourlyPage
            weather={weather}
            unit={unit}
            units={units}
            radarClear={radarClear}
            colorCoding={colorCoding}
            weatherAnimations={weatherAnimations}
          />
        )}
        {tab === 'daily' && <DailyPage weather={weather} unit={unit} units={units} colorCoding={colorCoding} />}
        {tab === 'details' && (
          <DetailsPage
            weather={weather}
            unit={unit}
            units={units}
            airQuality={airQuality}
            colorCoding={colorCoding}
            onNavigate={onNavigate}
          />
        )}
        {tab === 'radar' && (
          <RadarPage location={location} timezone={weather.timezone} radarMode={radarMode} />
        )}
        {tab === 'air' && <AirQualityPage airQuality={airQuality} timezone={weather.timezone} />}
      </div>
    </div>
  )
}
