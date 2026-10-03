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
  type RateResult,
} from "@/lib/fx/rate-service";

export {
  upsertSnapshot,
  findRecentSnapshot,
  findLatestSnapshot,
  type FxSnapshot,
  type SnapshotState,
} from "@/lib/fx/snapshot-store";
