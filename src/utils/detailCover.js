// Marks a detail cover whose circle has finished growing, which is what lets an
// iOS glass card have its backdrop blur back (see .detail-cover--settled in
// App.css). Set on the element directly rather than through state: the next
// className React writes — the switch to --closing — clears it, which is
// exactly when the blur should go again. Used by WeatherDetails and
// DailyForecast, the two cards with a cover.
export function markCoverSettled(e) {
  if (e.animationName === 'detailFillIn') e.currentTarget.classList.add('detail-cover--settled')
}
