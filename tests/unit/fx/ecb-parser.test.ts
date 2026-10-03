import { describe, expect, it } from "vitest";
import {
  parseEcbCsv,
  deriveEcbCrossRate,
} from "@/lib/fx/ecb-parser";
import { convertMoney, fxRate, money, roundMoney } from "@/lib/forecast";

const VALID_ECB_CSV = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225
`.trim();

describe("ECB CSV parser", () => {
  it("parses valid USD and SGD rates with correct effective date", () => {
    const result = parseEcbCsv(VALID_ECB_CSV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effectiveDate).toBe("2026-10-02");
    expect(result.rates).toHaveLength(2);

    const usd = result.rates.find((r) => r.quoteCurrency === "USD");
    expect(usd).toBeDefined();
    expect(usd?.baseCurrency).toBe("EUR");
    expect(usd?.rate).toBe("1.1225");
    expect(usd?.effectiveDate).toBe("2026-10-02");

    const sgd = result.rates.find((r) => r.quoteCurrency === "SGD");
    expect(sgd).toBeDefined();
    expect(sgd?.baseCurrency).toBe("EUR");
    expect(sgd?.rate).toBe("1.4366");
    expect(sgd?.effectiveDate).toBe("2026-10-02");
  });

  it("handles CRLF line endings and quoted tokens cleanly", () => {
    const crlfCsv =
      '"KEY","FREQ","CURRENCY","CURRENCY_DENOM","EXR_TYPE","EXR_SUFFIX","TIME_PERIOD","OBS_VALUE"\r\n' +
      '"EXR.D.SGD.EUR.SP00.A","D","SGD","EUR","SP00","A","2026-10-02","1.4366"\r\n' +
      '"EXR.D.USD.EUR.SP00.A","D","USD","EUR","SP00","A","2026-10-02","1.1225"\r\n';

    const result = parseEcbCsv(crlfCsv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectiveDate).toBe("2026-10-02");
    expect(result.rates).toHaveLength(2);
  });

  it("performs correct EUR conversions using parsed rates", () => {
    const parsed = parseEcbCsv(VALID_ECB_CSV);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const usdRateStr = parsed.rates.find((r) => r.quoteCurrency === "USD")!.rate;
    const sgdRateStr = parsed.rates.find((r) => r.quoteCurrency === "SGD")!.rate;

    const eurUsd = fxRate("EUR", "USD", usdRateStr);
    const eurSgd = fxRate("EUR", "SGD", sgdRateStr);

    // Direct EUR -> USD
    const usdVal = convertMoney(money("100", "EUR"), "USD", eurUsd);
    expect(roundMoney(usdVal)).toEqual({ amount: "112.25", currency: "USD" });

    // Reciprocal USD -> EUR
    const eurValFromUsd = convertMoney(money("112.25", "USD"), "EUR", eurUsd);
    expect(roundMoney(eurValFromUsd)).toEqual({ amount: "100", currency: "EUR" });

    // Direct EUR -> SGD
    const sgdVal = convertMoney(money("100", "EUR"), "SGD", eurSgd);
    expect(roundMoney(sgdVal)).toEqual({ amount: "143.66", currency: "SGD" });

    // Reciprocal SGD -> EUR
    const eurValFromSgd = convertMoney(money("143.66", "SGD"), "EUR", eurSgd);
    expect(roundMoney(eurValFromSgd)).toEqual({ amount: "100", currency: "EUR" });

    // Zero amount conversion
    const zeroUsd = convertMoney(money("0", "EUR"), "USD", eurUsd);
    expect(zeroUsd).toEqual({ amount: "0", currency: "USD" });

    // Negative amount conversion
    const negUsd = convertMoney(money("-100", "EUR"), "USD", eurUsd);
    expect(roundMoney(negUsd)).toEqual({ amount: "-112.25", currency: "USD" });
  });

  it("calculates correct USD/SGD cross rate based on ECB_Y / ECB_X", () => {
    const parsed = parseEcbCsv(VALID_ECB_CSV);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // USD -> SGD = ECB_SGD / ECB_USD = 1.4366 / 1.1225
    const usdToSgd = deriveEcbCrossRate("USD", "SGD", parsed.rates);
    expect(usdToSgd).not.toBeNull();
    // 1.4366 / 1.1225 = 1.279821826280623608017817371937639198218
    expect(usdToSgd?.startsWith("1.27982182628")).toBe(true);

    // SGD -> USD = ECB_USD / ECB_SGD = 1.1225 / 1.4366
    const sgdToUsd = deriveEcbCrossRate("SGD", "USD", parsed.rates);
    expect(sgdToUsd).not.toBeNull();
    // 1.1225 / 1.4366 = 0.7813587637477377140470555478212446053181
    expect(sgdToUsd?.startsWith("0.78135876374")).toBe(true);

    // Verify cross rate converts money accurately between USD and SGD
    const rateUsdSgd = fxRate("USD", "SGD", usdToSgd!);
    const converted = convertMoney(money("112.25", "USD"), "SGD", rateUsdSgd);
    expect(roundMoney(converted)).toEqual({ amount: "143.66", currency: "SGD" });

    // EUR legs and identity
    expect(deriveEcbCrossRate("EUR", "USD", parsed.rates)).toBe("1.1225");
    expect(deriveEcbCrossRate("USD", "USD", parsed.rates)).toBe("1");
    expect(deriveEcbCrossRate("USD", "GBP", parsed.rates)).toBeNull();
  });

  describe("schema rejection and validation", () => {
    it("rejects empty response or whitespace", () => {
      const res = parseEcbCsv("   ");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("empty");
      }
    });

    it("rejects response with too few lines", () => {
      const res = parseEcbCsv("KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("too few lines");
      }
    });

    it("rejects missing required columns", () => {
      const missingObsValue = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02
      `.trim();
      const res = parseEcbCsv(missingObsValue);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('missing required column "OBS_VALUE"');
      }
    });

    it("rejects malformed currency codes", () => {
      const badCurrency = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.US.EUR.SP00.A,D,US,EUR,SP00,A,2026-10-02,1.1225
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
      `.trim();
      const res = parseEcbCsv(badCurrency);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("malformed CURRENCY");
      }
    });

    it("rejects non-EUR base currency (CURRENCY_DENOM)", () => {
      const badBase = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.USD.SP00.A,D,USD,USD,SP00,A,2026-10-02,1.1225
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
      `.trim();
      const res = parseEcbCsv(badBase);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("expected CURRENCY_DENOM=EUR");
      }
    });

    it("rejects unexpected currency quote", () => {
      const withJpy = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,2026-10-02,160.50
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
      `.trim();
      const res = parseEcbCsv(withJpy);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('unexpected CURRENCY "JPY"');
      }
    });

    it("rejects inconsistent effective dates across observations", () => {
      const mismatchedDates = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-01,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225
      `.trim();
      const res = parseEcbCsv(mismatchedDates);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("inconsistent effective dates");
      }
    });

    it("rejects invalid TIME_PERIOD format", () => {
      const badDate = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026/10/02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026/10/02,1.1225
      `.trim();
      const res = parseEcbCsv(badDate);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("invalid TIME_PERIOD");
      }
    });

    it("rejects duplicate currency rows", () => {
      const duplicateUsd = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1230
      `.trim();
      const res = parseEcbCsv(duplicateUsd);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('duplicate rate for CURRENCY "USD"');
      }
    });
  });

  describe("missing currency handling", () => {
    it("explicitly rejects response missing USD", () => {
      const missingUsd = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
      `.trim();
      const res = parseEcbCsv(missingUsd);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('missing required currency "USD"');
      }
    });

    it("explicitly rejects response missing SGD", () => {
      const missingSgd = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225
      `.trim();
      const res = parseEcbCsv(missingSgd);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain('missing required currency "SGD"');
      }
    });
  });

  describe("zero, negative, or malformed rates rejection", () => {
    it("rejects rate equal to zero", () => {
      const zeroRate = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,0
      `.trim();
      const res = parseEcbCsv(zeroRate);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("rate must be greater than zero");
      }
    });

    it("rejects negative rate", () => {
      const negativeRate = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,-1.1225
      `.trim();
      const res = parseEcbCsv(negativeRate);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("rate must be greater than zero");
      }
    });

    it("rejects non-numeric rate string", () => {
      const nonNumeric = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,N/A
      `.trim();
      const res = parseEcbCsv(nonNumeric);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("invalid rate value");
      }
    });

    it("rejects scientific exponent notation", () => {
      const expRate = `
KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE
EXR.D.SGD.EUR.SP00.A,D,SGD,EUR,SP00,A,2026-10-02,1.4366
EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-02,1.1225e0
      `.trim();
      const res = parseEcbCsv(expRate);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("invalid rate value");
      }
    });
  });
});
