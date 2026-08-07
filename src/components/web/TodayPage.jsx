import { ArrowRight, CloudRain, Droplets, Eye, Sun, Sunrise, Sunset, Thermometer, Wind } from 'lucide-react'
import { CurrentWeather } from '../CurrentWeather'
import { PrecipNowcast } from '../PrecipNowcast'
import { WeatherAlerts } from '../WeatherAlerts'
import { WeatherIcon } from '../WeatherIcon'
import {
  displayPrecipChance, formatHour, formatTime, getUVLabel, getWeatherInfo, getWindDirection,
  liveWeatherCode, nowcastHourlyCode, precipTier, tempStyle, toTemp,
} from '../../utils/weatherCodes'
import { currentHourIndex, METERS_PER_MILE, sliceHourly, weekdayLabel } from './webData'

function GlanceTile({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="web-glance-tile">
      <Icon size={17} className="web-glance-icon" style={color ? { color } : undefined} aria-hidden="true" />
      <div className="web-glance-label">{label}</div>
      <div className="web-glance-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="web-glance-sub">{sub}</div>}
    </div>
  )
}

// The two preview cards at the bottom of the page are deliberately read-only
// summaries: they say enough to answer "do I need to open that tab", and hand
// off to the real page rather than duplicating it.
function PreviewCard({ title, onOpen, openLabel, className, children }) {
  return (
    <div className={`card web-preview${className ? ` ${className}` : ''}`}>
      <div className="web-preview-head">
        <span className="section-label">{title}</span>
        <button className="web-link-btn" onClick={onOpen}>
          {openLabel}
          <ArrowRight size={14} />
        </button>
      </div>
      {children}
    </div>
  )
}

// The weather-overview card (insight / conditions / clothing / AQI) is off on
// the desktop layout for now. WebLayout still spreads its props through, so
// restoring it is a matter of pulling `airQuality`, `overviewParts`,
// `showOverview` and `hasActiveAlert` back out of the props and rendering
// <WeatherOverview> again.
export function TodayPage({
  weather, location, alerts, unit, radarClear, lastUpdated, loading,
  colorCoding, nowcastMode,
  saved, onSave, onRemove, isHome, hasHome, onGoHome, onSetHome, onUnsetHome, onRefresh,
  onNavigate,
}) {
  const { current, hourly, daily, timezone } = weather
  const start = currentHourIndex(hourly, timezone)
  const next = sliceHourly(hourly, start, 13)

  const uv = getUVLabel(current.uv_index ?? 0)
  const windDir = getWindDirection(current.wind_direction_10m)
  const visMi = current.visibility != null ? (current.visibility / METERS_PER_MILE).toFixed(1) : null
  const rainToday = daily.precipitation_probability_max?.[0]

  return (
    <div className="web-page">
      <WeatherAlerts alerts={alerts} />

      <div className="web-hero">
        <CurrentWeather
          current={current}
          minutely={weather.minutely_15}
          radarClear={radarClear}
          location={location}
          timezone={timezone}
          unit={unit}
          saved={saved}
          onSave={onSave}
          onRemove={onRemove}
          isHome={isHome}
          hasHome={hasHome}
          onGoHome={onGoHome}
          onSetHome={onSetHome}
          onUnsetHome={onUnsetHome}
          lastUpdated={lastUpdated}
          onRefresh={onRefresh}
          loading={loading}
          colorCoding={colorCoding.current}
          glow={colorCoding.glow}
          frost={colorCoding.frost}
        />

        <div className="card web-glance">
          <div className="section-label">AT A GLANCE</div>
          <div className="web-glance-grid">
            <GlanceTile
              icon={Thermometer}
              label="High / Low"
              value={
                <>
                  <span style={tempStyle(daily.temperature_2m_max[0], colorCoding.daily, 0.3, colorCoding.glow, colorCoding.frost)}>
                    {toTemp(daily.temperature_2m_max[0], unit)}°
                  </span>
                  <span className="web-glance-sep"> / </span>
                  <span style={tempStyle(daily.temperature_2m_min[0], colorCoding.daily, 0.3, colorCoding.glow, colorCoding.frost)}>
                    {toTemp(daily.temperature_2m_min[0], unit)}°
                  </span>
                </>
              }
              sub="Today"
            />
            <GlanceTile
              icon={CloudRain}
              label="Precipitation"
              value={rainToday != null ? `${rainToday}%` : '—'}
              sub={daily.precipitation_sum?.[0] != null ? `${daily.precipitation_sum[0].toFixed(2)} in expected` : 'Chance today'}
            />
            <GlanceTile
              icon={Wind}
              label="Wind"
              value={`${Math.round(current.wind_speed_10m)} mph`}
              sub={`${windDir}${current.wind_gusts_10m != null ? ` · gusts ${Math.round(current.wind_gusts_10m)}` : ''}`}
            />
            <GlanceTile
              icon={Droplets}
              label="Humidity"
              value={`${Math.round(current.relative_humidity_2m)}%`}
              sub={current.dew_point_2m != null ? `Dew point ${toTemp(current.dew_point_2m, unit)}°` : null}
            />
            <GlanceTile
              icon={Sunrise}
              label="Sunrise"
              value={formatTime(daily.sunrise[0], timezone)}
              sub="Local time"
            />
            <GlanceTile
              icon={Sunset}
              label="Sunset"
              value={formatTime(daily.sunset[0], timezone)}
              sub="Local time"
            />
            <GlanceTile
              icon={Eye}
              label="Visibility"
              value={visMi != null ? `${visMi} mi` : '—'}
              sub="Ground level"
            />
            <GlanceTile
              icon={Sun}
              label="UV index"
              value={Math.round(current.uv_index ?? 0)}
              sub={uv.label}
              color={colorCoding.details ? uv.color : undefined}
            />
          </div>
        </div>
      </div>

      {/* Wide viewBox: the same chart drawn into a flatter box, so it fills the
          page at a fraction of the height the phone proportions gave it. */}
      <PrecipNowcast
        minutely={weather.minutely_15}
        currentTime={current.time}
        mode={nowcastMode}
        current={current}
        radarClear={radarClear}
        wide
      />

      <PreviewCard title="NEXT 12 HOURS" onOpen={() => onNavigate('hourly')} openLabel="Hourly" className="web-strip">
        <div className="web-mini-hours">
          {next.time.map((time, i) => {
            const code = i === 0
              ? (liveWeatherCode(current, weather.minutely_15, radarClear) ?? next.code[i])
              : nowcastHourlyCode(next.code[i], weather.minutely_15, time, current)
            const info = getWeatherInfo(code, !next.isDay[i])
            const chance = displayPrecipChance(code, precipTier(code) === 0 ? 0 : next.precip[i])
            return (
              <div key={time} className={`web-mini-hour${i === 0 ? ' web-mini-hour--now' : ''}`}>
                <span className="web-mini-time">{i === 0 ? 'Now' : formatHour(time, timezone)}</span>
                <span className="web-mini-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
                <span
                  className="web-mini-temp"
                  style={tempStyle(next.temp[i], colorCoding.hourly, 0.35, colorCoding.glow, colorCoding.frost)}
                >
                  {toTemp(next.temp[i], unit)}°
                </span>
                <span className={`web-mini-precip${chance >= 30 ? ' web-mini-precip--high' : chance > 0 ? '' : ' web-mini-precip--zero'}`}>
                  {chance}%
                </span>
              </div>
            )
          })}
        </div>
      </PreviewCard>

      {/* The week runs the full page width rather than sharing the narrow
          column. Seven days squeezed into half a row left every cell too tight
          to give the type a readable size; across the whole width each day gets
          a tile wide enough for a condition line as well. */}
      <PreviewCard title="WEEK AHEAD" onOpen={() => onNavigate('daily')} openLabel="7 day" className="web-week">
        <div className="web-week-days">
          {daily.time.map((date, i) => {
            const info = getWeatherInfo(daily.weather_code[i], false)
            const chance = displayPrecipChance(
              daily.weather_code[i],
              precipTier(daily.weather_code[i]) === 0 ? 0 : daily.precipitation_probability_max?.[i],
            )
            return (
              <div key={date} className={`web-week-day${i === 0 ? ' web-week-day--today' : ''}`}>
                <span className="web-week-dayname">{i === 0 ? 'Today' : weekdayLabel(date, timezone)}</span>
                <span className="web-week-icon"><WeatherIcon id={info.icon} alt={info.label} /></span>
                <span className="web-week-cond">{info.label}</span>
                <span className="web-week-temps">
                  <span
                    className="web-week-high"
                    style={tempStyle(daily.temperature_2m_max[i], colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}
                  >
                    {toTemp(daily.temperature_2m_max[i], unit)}°
                  </span>
                  <span
                    className="web-week-low"
                    style={tempStyle(daily.temperature_2m_min[i], colorCoding.daily, 0.35, colorCoding.glow, colorCoding.frost)}
                  >
                    {toTemp(daily.temperature_2m_min[i], unit)}°
                  </span>
                </span>
                <span className={`web-week-precip${chance >= 30 ? ' web-mini-precip--high' : chance > 0 ? '' : ' web-mini-precip--zero'}`}>
                  {chance}%
                </span>
              </div>
            )
          })}
        </div>
      </PreviewCard>
    </div>
  )
}
