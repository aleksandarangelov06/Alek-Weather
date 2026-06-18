import { useState } from 'react'
import { useWeather } from './hooks/useWeather'
import { useSavedCities } from './hooks/useSavedCities'
import { SearchBar } from './components/SearchBar'
import { SavedCities } from './components/SavedCities'
import { CurrentWeather } from './components/CurrentWeather'
import { HourlyForecast } from './components/HourlyForecast'
import { DailyForecast } from './components/DailyForecast'
import { WeatherDetails } from './components/WeatherDetails'
import './App.css'

function App() {
  const [unit, setUnit] = useState(() => localStorage.getItem('alek-weather-unit') ?? 'F')

  const {
    location, weather, searchResults, loading, error,
    searchCity, selectCity, useMyLocation, setSearchResults,
  } = useWeather()

  const { cities, save, remove, isSaved } = useSavedCities()

  const toggleUnit = () => {
    const next = unit === 'F' ? 'C' : 'F'
    setUnit(next)
    localStorage.setItem('alek-weather-unit', next)
  }

  const handleSelectSaved = (city) => selectCity(city)

  const weatherPanel = weather && !loading && (
    <>
      <CurrentWeather
        current={weather.current}
        daily={weather.daily}
        location={location}
        unit={unit}
        saved={isSaved(location)}
        onSave={() => save(location)}
        onRemove={() => remove(location)}
      />
      <HourlyForecast hourly={weather.hourly} timezone={weather.timezone} unit={unit} />
      <DailyForecast daily={weather.daily} unit={unit} />
      <WeatherDetails current={weather.current} daily={weather.daily} timezone={weather.timezone} unit={unit} />
    </>
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">⛅ Alek Weather</div>
        <button className="unit-toggle" onClick={toggleUnit}>
          °{unit === 'F' ? 'C' : 'F'}
        </button>
      </header>

      <div className="app-grid">
        {/* Left sidebar: search + saved cities */}
        <aside className="sidebar">
          <SearchBar
            onSearch={searchCity}
            results={searchResults}
            onSelect={selectCity}
            onUseLocation={useMyLocation}
            onClear={() => setSearchResults([])}
          />
          <SavedCities
            cities={cities}
            onSelect={handleSelectSaved}
            onRemove={remove}
            currentLatitude={location?.latitude}
          />
        </aside>

        {/* Main content */}
        <main className="main-content">
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
          <div className="weather-content">
            {weatherPanel}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
