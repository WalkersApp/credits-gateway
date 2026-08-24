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
