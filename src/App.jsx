import { useWeather } from './hooks/useWeather'
import { SearchBar } from './components/SearchBar'
import { CurrentWeather } from './components/CurrentWeather'
import { HourlyForecast } from './components/HourlyForecast'
import { DailyForecast } from './components/DailyForecast'
import { WeatherDetails } from './components/WeatherDetails'
import './App.css'

function App() {
  const {
    location, weather, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults,
  } = useWeather()

  return (
    <div className="app">
      <SearchBar
        onSearch={searchCity}
        results={searchResults}
        onSelect={selectCity}
        onUseLocation={useMyLocation}
        onClear={() => setSearchResults([])}
      />

      {loading && (
        <div className="status-message">
          <div className="spinner" />
          <span>Fetching weather...</span>
        </div>
      )}

      {error && !loading && (
        <div className="status-message error">{error}</div>
      )}

      {!weather && !loading && !error && (
        <div className="empty-state">
          <div className="empty-icon">🌍</div>
          <p className="empty-text">Search for a city to see the weather</p>
        </div>
      )}

      {weather && !loading && (
        <div className="weather-content">
          <CurrentWeather
            current={weather.current}
            daily={weather.daily}
            location={location}
          />
          <HourlyForecast
            hourly={weather.hourly}
            timezone={weather.timezone}
          />
          <DailyForecast daily={weather.daily} />
          <WeatherDetails
            current={weather.current}
            daily={weather.daily}
            timezone={weather.timezone}
          />
        </div>
      )}
    </div>
  )
}

export default App
