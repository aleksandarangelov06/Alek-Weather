// Wind-turbine glyph in the Lucide line-icon style (stroked, currentColor, 24x24
// viewBox) so it drops in anywhere a Lucide icon is used. Neither Lucide nor the
// Fluent emoji set ships a windmill/turbine, so this is drawn inline the same way
// the fog and strong-storm icons are. Three blades at 120° from a hub, on a tower.
export function WindTurbine({ size = 24, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      {/* blades */}
      <path d="M12 9V2.5" />
      <path d="M12 9l5.6 3.3" />
      <path d="M12 9l-5.6 3.3" />
      {/* hub */}
      <circle cx="12" cy="9" r="1.3" fill="currentColor" stroke="none" />
      {/* tower + base */}
      <path d="M12 10.3V21.5" />
      <path d="M9.5 21.5h5" />
    </svg>
  )
}
