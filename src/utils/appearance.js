// Appearance constants shared between the settings screen and the app shell.
//
// These sit outside SettingsPage.jsx because App reads them while it is setting
// its state up, long before the settings screen is on the page — and the screen
// is loaded lazily (see SettingsPageLazy), so reaching into it at mount would
// pull the whole thing back into the main chunk.

// The most transparent a card may get. Past this the label on it is reading
// against the sky animation rather than against a surface, and the card has
// stopped being a card. Shared because App.jsx clamps the stored value to it
// — a value past this one would mix the fill at a negative opacity, which is
// not a color, which is a card with no background at all.
//
// 35, down from 50: at 50 the cards (and anything drawn on them, the radar map
// especially) were too far gone over the sky. A value stored under the old
// limit is clamped to this one on load.
export const MAX_CARD_TRANSPARENCY = 35

// The setting at which the iOS glass reaches full clarity. iOS reads the
// setting as a fraction of this rather than of the limit above, so lowering
// the limit really does stop the glass short of where it used to go (at 35 it
// tops out at 0.7) instead of just stretching the same range over less slider.
export const IOS_FULL_CLARITY_AT = 50
