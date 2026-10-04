// Theme selection shared by the full player and the mini-player.
//
// The palette itself lives in styles.css: `:root` holds the default dark
// theme and `:root[data-theme="..."]` blocks override the tokens. Applying a
// theme is therefore just setting the attribute on <html>.

export type ThemeId = "dark" | "translucent" | "nostalgia";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  hint: string;
}

export const THEMES: ThemeOption[] = [
  { id: "dark", label: "Dark", hint: "The original night palette" },
  {
    id: "translucent",
    label: "Translucent",
    hint: "Frosted glass over your desktop",
  },
  {
    id: "nostalgia",
    label: "Nostalgia",
    hint: "2000s grain yellow",
  },
];

/** Event broadcast to the mini-player when the theme changes. */
export const THEME_EVENT = "theme-changed";

export function normalizeTheme(theme: string | null | undefined): ThemeId {
  return THEMES.some((option) => option.id === theme)
    ? (theme as ThemeId)
    : "dark";
}

/** Set the theme attribute on <html> and return the id that was applied. */
export function applyTheme(theme: string | null | undefined): ThemeId {
  const id = normalizeTheme(theme);
  document.documentElement.setAttribute("data-theme", id);
  return id;
}
