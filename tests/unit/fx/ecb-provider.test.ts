import { afterEach, describe, expect, it, vi } from "vitest";
import { liveEcbProvider } from "@/lib/fx/ecb-provider";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live ECB provider adapter", () => {
  it("records fetchedAt after the complete response body is received", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => {
        vi.setSystemTime(new Date("2026-10-08T10:00:05Z"));
        return "ECB CSV";
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await liveEcbProvider.fetchRates();

    expect(result).toEqual({
      ok: true,
      csv: "ECB CSV",
      fetchedAt: new Date("2026-10-08T10:00:05Z"),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("data-api.ecb.europa.eu/service/data/EXR/"),
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "text/csv" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns an explicit failure for a non-successful HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    })));

    const result = await liveEcbProvider.fetchRates();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ECB returned HTTP 503 Service Unavailable");
  });

  it("normalizes a thrown network exception into a failed result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection reset");
    }));

    const result = await liveEcbProvider.fetchRates();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("connection reset");
  });
});
