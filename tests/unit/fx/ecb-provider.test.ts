import { afterEach, describe, expect, it, vi } from "vitest";
import { liveEcbProvider } from "@/lib/fx/ecb-provider";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("live ECB provider adapter", () => {
  it("records fetchedAt after the complete response body is received", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    const fetchMock = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
        vi.setSystemTime(new Date("2026-10-08T10:00:05Z"));
          controller.enqueue(new TextEncoder().encode("ECB CSV"));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/csv" } },
    ));
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
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, {
      status: 503,
      statusText: "Service Unavailable",
    })));

    const result = await liveEcbProvider.fetchRates();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ECB exchange rates are temporarily unavailable.");
  });

  it("normalizes a thrown network exception into a failed result", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection reset");
    }));

    const result = await liveEcbProvider.fetchRates();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ECB exchange rates are temporarily unavailable.");
    expect(errorLog).toHaveBeenCalledWith(
      "ECB request failed.",
      expect.objectContaining({ message: "connection reset" }),
    );
  });

  it("rejects a response larger than 64 KiB without exposing details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "x".repeat(64 * 1024 + 1),
      { status: 200, headers: { "content-type": "text/csv" } },
    )));

    const result = await liveEcbProvider.fetchRates();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ECB exchange rates are temporarily unavailable.");
    expect(errorLog).toHaveBeenCalledWith(
      "ECB request failed.",
      expect.objectContaining({ message: expect.stringContaining("65536 bytes") }),
    );
  });
});
