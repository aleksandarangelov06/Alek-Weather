// City identity: latitude alone collides for different cities on the same
// parallel, so always compare both coordinates. Coordinates for the "same"
// city vary by source — geocoding returns full precision, but GPS ("My
// Location") drifts a little on every fix — so exact float equality would let
// duplicates through. Treat coordinates within ~1 km of each other as the same
// city (0.01° ≈ 1.1 km, matching the app's city-level rounding elsewhere).
const SAME_CITY_EPS = 0.01

export function sameCity(a, b) {
  return !!a && !!b &&
    Math.abs(a.latitude - b.latitude) < SAME_CITY_EPS &&
    Math.abs(a.longitude - b.longitude) < SAME_CITY_EPS
}
