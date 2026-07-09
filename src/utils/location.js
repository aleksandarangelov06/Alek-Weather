// City identity: latitude alone collides for different cities on the same
// parallel, so always compare both coordinates. Coordinates for the "same"
// city vary by source — geocoding returns full precision, but GPS ("My
// Location") drifts a little on every fix — so exact float equality would let
// duplicates through. Treat coordinates within ~1 km of each other as the same
// city (0.01° ≈ 1.1 km, matching the app's city-level rounding elsewhere).
const SAME_CITY_EPS = 0.01

function norm(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : ''
}

// Two cities are the same when they share a place identity (name + region +
// country) OR when their coordinates are within ~1 km. The name check is what
// unifies a "My Location" GPS fix with the same city saved from search: the GPS
// coordinates fall wherever the user physically is and can sit several km from
// the geocoded city centre, well outside SAME_CITY_EPS. Requiring admin1 and
// country to match too avoids merging distinct like-named cities (e.g. the many
// Springfields). The coordinate check remains as a fallback for when reverse
// geocoding failed and the name is the generic "My Location".
export function sameCity(a, b) {
  if (!a || !b) return false

  const an = norm(a.name)
  if (an && an !== 'my location' && an === norm(b.name) &&
      norm(a.admin1) === norm(b.admin1) &&
      norm(a.country_code) === norm(b.country_code)) {
    return true
  }

  return Math.abs(a.latitude - b.latitude) < SAME_CITY_EPS &&
    Math.abs(a.longitude - b.longitude) < SAME_CITY_EPS
}
