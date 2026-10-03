export {
  parseEcbCsv,
  deriveEcbCrossRate,
  EcbParseError,
  type ParsedEcbRate,
  type EcbParseResult,
} from "@/lib/fx/ecb-parser";

export {
  liveEcbProvider,
  type EcbProvider,
  type EcbFetchResult,
} from "@/lib/fx/ecb-provider";

export {
  getEurRate,
  getCrossRate,
  getRate,
  getAllEcbRates,
  CACHE_TTL_MS,
  ECB_PROVIDER,
  FxRateError,
  type RateStatus,
  type RateFailure,
  type RateFailureCode,
  type RateResult,
} from "@/lib/fx/rate-service";

export {
  upsertSnapshot,
  upsertSnapshots,
  findRecentSnapshot,
  findLatestSnapshot,
  type FxSnapshot,
} from "@/lib/fx/snapshot-store";

export {
  calculateShockedRate,
  evaluateFxShock,
  convertWithShock,
  InvalidShockPercentageError,
  MissingSnapshotError,
  UnusableSnapshotError,
  type EvaluatedFxShock,
} from "@/lib/fx/fx-shock";

export {
  addScenarioFxShock,
  getScenarioFxShocks,
  evaluateScenarioFxShock,
  invalidateScenarioFxShock,
  type PersistedFxShock,
} from "@/lib/fx/shock-store";

