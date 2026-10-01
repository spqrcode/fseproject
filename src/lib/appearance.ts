export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export const DEFAULT_APPEARANCE: Appearance = "system";
export const APPEARANCE_LABELS: Record<Appearance, string> = { system: "Match this device", light: "Light", dark: "Dark" };
