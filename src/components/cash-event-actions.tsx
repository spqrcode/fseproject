import { changeCashEventStatus, removeCashEvent } from "@/app/actions/cash-events";

export function CashEventActions({ eventId, amount }: { eventId: string; amount: string }) {
  const completion = amount.startsWith("-") ? "paid" : "received";
  return <div className="event-actions">
    <form action={changeCashEventStatus.bind(null, eventId, completion)}>
      <button className="text-button" type="submit">Mark {completion}</button>
    </form>
    <form action={changeCashEventStatus.bind(null, eventId, "cancelled")}>
      <button className="text-button" type="submit">Cancel</button>
    </form>
    <form action={removeCashEvent.bind(null, eventId)}>
      <button className="text-button danger-text" type="submit">Delete</button>
    </form>
  </div>;
}
