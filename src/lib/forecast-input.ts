import { type CashEventStatus } from "@/lib/cash-event-status";

// What the forecast engine calls a status. Pure mapping, no database; the engine itself is not called yet.
export type EngineStatus = "pending" | "completed";

// expected is still ahead (pending), received and paid have happened (completed), cancelled is left out (null).
export function toEngineStatus(status: CashEventStatus): EngineStatus | null {
  switch (status) {
    case "expected": return "pending";
    case "received":
    case "paid": return "completed";
    case "cancelled": return null;
    default: {
      // A fifth database status stops compiling here until it is mapped.
      const unmapped: never = status;
      throw new Error(`Unmapped cash event status: ${String(unmapped)}`);
    }
  }
}
