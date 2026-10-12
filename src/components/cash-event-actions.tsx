import { changeCashEventStatus, removeCashEvent } from "@/app/actions/cash-events";

// The visible words stay short; the accessible name adds the event so that a list of events does not read as
// "Delete, Delete, Delete". The label always starts with the visible text.
export function CashEventActions({ eventId, amount, description }: { eventId: string; amount: string; description: string }) {
  const completion = amount.startsWith("-") ? "paid" : "received";
  return <div className="event-actions">
    <form action={changeCashEventStatus.bind(null, eventId, completion)}>
      <button className="text-button" type="submit" aria-label={`Mark ${completion}: ${description}`}>Mark {completion}</button>
    </form>
    <form action={changeCashEventStatus.bind(null, eventId, "cancelled")}>
      <button className="text-button" type="submit" aria-label={`Cancel event: ${description}`}>Cancel event</button>
    </form>
    {/* A native disclosure instead of client state: the second step works without JavaScript and is keyboard accessible. */}
    <details className="confirm-delete">
      <summary className="danger-text" aria-label={`Delete: ${description}`}>Delete</summary>
      <p>Delete this event permanently? It leaves every forecast and cannot be restored. To keep a record, cancel it instead.</p>
      <form action={removeCashEvent.bind(null, eventId)}>
        <button className="button secondary" type="submit" aria-label={`Delete permanently: ${description}`}>Delete permanently</button>
      </form>
    </details>
  </div>;
}
