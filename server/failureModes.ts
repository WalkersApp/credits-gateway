// The deposit and withdrawal outcome tables, in one place so the architecture
// page, the evidence page and the README cannot drift apart from each other.
// Each row states the outcome for the user's money, because that is the only
// thing a reviewer actually needs to check.

export interface Outcome {
  situation: string;
  result: string;
  credits: string;
}

export const DEPOSIT_OUTCOMES: Outcome[] = [
  { situation: "Unsupported or unrecognised deposit", result: "rejected", credits: "0" },
  { situation: "Transaction not on chain yet", result: "pending", credits: "0 until confirmed" },
  { situation: "Confirmations below the route target", result: "confirming", credits: "0 until the target is met" },
  { situation: "Transaction pays a different address", result: "rejected with the reason", credits: "0" },
  { situation: "Same transaction submitted again", result: "the original record is returned and a duplicate counter increments", credits: "issued once only" },
  { situation: "Amount below the route minimum", result: "rejected with the reason", credits: "0" },
  { situation: "Exchange deposit rejected by an admin", result: "rejected, and it can never then be approved", credits: "0" },
  { situation: "Confirmed at or above the target", result: "credited once, from the observed amount", credits: "issued once" },
];

export const WITHDRAWAL_OUTCOMES: Outcome[] = [
  { situation: "Invalid or wrong-network destination", result: "refused before anything is locked", credits: "untouched" },
  { situation: "More credits than the account holds", result: "refused before anything is locked", credits: "untouched" },
  { situation: "Outside the configured min/max", result: "refused before anything is locked", credits: "untouched" },
  { situation: "Reserve cannot cover the settlement", result: "refused at request time; if the reserve drops after the check, the request parks as pending", credits: "untouched, or locked and safe" },
  { situation: "Build, balance, coin selection or signing fails", result: "failed — nothing was broadcast", credits: "released back to available" },
  { situation: "Node rejects the first submit", result: "failed — provably never broadcast", credits: "released back to available" },
  { situation: "Submit outcome cannot be proven", result: "manual_review with the transaction hash", credits: "stay locked, never refunded automatically" },
  { situation: "Settlement confirmed on chain", result: "confirmed, transaction hash stored", credits: "locked credits consumed" },
  { situation: "Refund attempted twice", result: "the second call is a no-op", credits: "released once only" },
];

// The lifecycle states, as transitions rather than situations. The outcome
// tables above answer "what happens if X"; these answer "where can this record
// go next", which is the question a reviewer asks when reading a status field.

export interface LifecycleState {
  state: string;
  meaning: string;
  next: string;
}

export const DEPOSIT_LIFECYCLE: LifecycleState[] = [
  { state: "pending", meaning: "submitted to the gateway, nothing seen on chain yet (or awaiting admin review on the exchange route)", next: "confirming · rejected · failed" },
  { state: "confirming", meaning: "the transaction was found and pays the deposit address; waiting for the route's confirmation target", next: "confirmed · rejected" },
  { state: "confirmed", meaning: "validated at or above the confirmation target, from the amount observed on chain", next: "credited" },
  { state: "credited", meaning: "credits issued once, from the observed amount — terminal, happy path", next: "— (terminal)" },
  { state: "rejected", meaning: "refused by validation or by an admin, with the reason stored", next: "— (terminal, 0 credits)" },
  { state: "failed", meaning: "validation could not complete", next: "— (terminal, 0 credits)" },
];

export const WITHDRAWAL_LIFECYCLE: LifecycleState[] = [
  { state: "pending", meaning: "requested and quoted; credits locked, settlement not yet started", next: "processing · failed" },
  { state: "processing", meaning: "building, balancing and signing the Cardano settlement transaction", next: "submitted · failed" },
  { state: "submitted", meaning: "broadcast to the network, waiting for confirmations", next: "confirmed · manual_review" },
  { state: "confirmed", meaning: "seen on chain; the locked credits are consumed — terminal, happy path", next: "— (terminal)" },
  { state: "failed", meaning: "failed before broadcast, provably nothing sent", next: "refunded" },
  { state: "refunded", meaning: "the locked credits were released back to available", next: "— (terminal)" },
  { state: "manual_review", meaning: "the submit outcome could not be proven; the transaction may still confirm", next: "— (held; credits stay locked, never auto-refunded)" },
];

// What "refund" means on each side, because they are not symmetrical and a
// reviewer should not have to infer it from the absence of a code path.
export const REFUND_POLICY = {
  credits:
    "A refund releases locked credits back to the account's available balance. It happens only where the " +
    "settlement transaction was provably never broadcast, and it is idempotent — a second refund call is a no-op.",
  deposits:
    "The gateway does not refund deposits, and no code path exists to do so. A rejected deposit issues zero " +
    "credits and the funds remain at the deposit address under operator control; returning them to the sender " +
    "is an off-system treasury action, not a gateway function.",
  unproven:
    "A withdrawal whose submit outcome cannot be proven is never auto-refunded. Its credits stay locked and it " +
    "is held in manual_review, because refunding a transaction that later confirms would pay twice.",
};
