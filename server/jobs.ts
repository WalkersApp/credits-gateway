// Background work: chase deposits toward their confirmation target, retry
// withdrawals that were parked for liquidity, and confirm broadcast settlements.
// Everything it calls is idempotent, so a slow tick overlapping the next one
// cannot double-credit or double-pay.

import { config } from "./config.js";
import { deposits, withdrawals } from "./db.js";
import { validateDeposit } from "./deposits/service.js";
import { snapshotReserve } from "./reserve.js";
import { confirmSettlement, settleWithdrawal } from "./withdrawals/service.js";

const DAY = 86_400_000;
const SNAPSHOT_EVERY_MS = 10 * 60_000;

let running = false;
let lastSnapshot = 0;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const stale = { $gt: Date.now() - DAY };

    for (const d of await deposits()
      .find({ status: { $in: ["pending", "confirming"] }, verification: "onchain_automatic", createdAt: stale })
      .limit(25)
      .toArray()) {
      await validateDeposit(d._id).catch((err) => console.error(`[jobs] deposit ${d._id}:`, err.message));
    }

    for (const w of await withdrawals().find({ status: "pending" }).limit(10).toArray()) {
      await settleWithdrawal(w._id).catch((err) => console.error(`[jobs] settle ${w._id}:`, err.message));
    }

    for (const w of await withdrawals().find({ status: { $in: ["submitted", "manual_review"] } }).limit(25).toArray()) {
      await confirmSettlement(w._id).catch((err) => console.error(`[jobs] confirm ${w._id}:`, err.message));
    }

    if (Date.now() - lastSnapshot > SNAPSHOT_EVERY_MS) {
      lastSnapshot = Date.now();
      await snapshotReserve().catch((err) => console.error("[jobs] reserve snapshot:", err.message));
    }
  } finally {
    running = false;
  }
}

export function startJobs(): void {
  if (!config.jobs.enabled) {
    console.log("[jobs] disabled (BACKGROUND_JOBS=false)");
    return;
  }
  setInterval(() => void tick(), config.jobs.intervalMs).unref();
  void tick();
}
