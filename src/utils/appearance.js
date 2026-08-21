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
export const MAX_CARD_TRANSPARENCY = 50
