import { it, expect } from "vitest";
import { APPEARANCES, APPEARANCE_LABELS, DEFAULT_APPEARANCE } from "@/lib/appearance";
import { appearanceSchema } from "@/lib/validation";

it("accepts only the three appearance choices", () => {
  for (const value of APPEARANCES) expect(appearanceSchema.parse(value)).toBe(value);
  for (const value of ["Dark", "auto", "", null, 1, ["dark"]]) expect(appearanceSchema.safeParse(value).success).toBe(false);
});
it("defaults to following the device and labels every choice", () => {
  expect(DEFAULT_APPEARANCE).toBe("system");
  expect(Object.keys(APPEARANCE_LABELS).sort()).toEqual([...APPEARANCES].sort());
});
