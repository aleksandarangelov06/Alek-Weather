// City identity: latitude alone collides for different cities on the same
// parallel, so always compare both coordinates.
export function sameCity(a, b) {
  return !!a && !!b && a.latitude === b.latitude && a.longitude === b.longitude
}
