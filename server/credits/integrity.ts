// Conservation check. Two questions only:
//   1. do the account balances still equal what the ledger says was issued?
//   2. does every issued credit trace back to a credited deposit, and every
//      settled withdrawal to a matching debit?
// If (1) fails the gateway stops paying out — a drifting supply is either a bug
// or tampering, and neither should be settleable on chain.

import { accounts, deposits, ledger, withdrawals } from "../db.js";

export interface IntegrityReport {
  ok: boolean;
  balancesTotalUnits: number;
  ledgerSupplyUnits: number;
  driftUnits: number;
  lockedTotalUnits: number;
  creditedDepositsUnits: number;
  depositCreditsUnits: number;
  settledWithdrawalsUnits: number;
  withdrawalSpendUnits: number;
  problems: string[];
  checkedAt: number;
}

async function sumLedger(direction: string): Promise<number> {
  const [row] = await ledger()
    .aggregate<{ total: number }>([{ $match: { direction } }, { $group: { _id: null, total: { $sum: "$amountUnits" } } }])
    .toArray();
  return row?.total ?? 0;
}

export async function checkIntegrity(): Promise<IntegrityReport> {
  const [balances] = await accounts()
    .aggregate<{ available: number; locked: number }>([
      { $group: { _id: null, available: { $sum: "$availableUnits" }, locked: { $sum: "$lockedUnits" } } },
    ])
    .toArray();

  const [credited, spent, debited] = await Promise.all([
    sumLedger("credit"),
    sumLedger("spend"),
    sumLedger("debit"),
  ]);

  const balancesTotal = (balances?.available ?? 0) + (balances?.locked ?? 0);
  const supply = credited - spent - debited;
  const problems: string[] = [];
  if (balancesTotal !== supply) {
    problems.push(`balances ${balancesTotal} != ledger supply ${supply}`);
  }

  // Every credit issued for a deposit must match that deposit's recorded amount.
  const [depAgg] = await deposits()
    .aggregate<{ total: number }>([
      { $match: { status: "credited" } },
      { $group: { _id: null, total: { $sum: "$creditsUnits" } } },
    ])
    .toArray();
  const [depLedger] = await ledger()
    .aggregate<{ total: number }>([
      { $match: { kind: "deposit", direction: "credit" } },
      { $group: { _id: null, total: { $sum: "$amountUnits" } } },
    ])
    .toArray();
  const creditedDeposits = depAgg?.total ?? 0;
  const depositCredits = depLedger?.total ?? 0;
  if (creditedDeposits !== depositCredits) {
    problems.push(`credited deposits ${creditedDeposits} != deposit ledger credits ${depositCredits}`);
  }

  // Every confirmed withdrawal must have consumed exactly its locked credits.
  const [wAgg] = await withdrawals()
    .aggregate<{ total: number }>([
      { $match: { status: "confirmed" } },
      { $group: { _id: null, total: { $sum: "$creditsUnits" } } },
    ])
    .toArray();
  const [wLedger] = await ledger()
    .aggregate<{ total: number }>([
      { $match: { kind: "withdrawal", direction: "spend" } },
      { $group: { _id: null, total: { $sum: "$amountUnits" } } },
    ])
    .toArray();
  const settledWithdrawals = wAgg?.total ?? 0;
  const withdrawalSpend = wLedger?.total ?? 0;
  if (settledWithdrawals !== withdrawalSpend) {
    problems.push(`confirmed withdrawals ${settledWithdrawals} != withdrawal ledger spend ${withdrawalSpend}`);
  }

  return {
    ok: problems.length === 0,
    balancesTotalUnits: balancesTotal,
    ledgerSupplyUnits: supply,
    driftUnits: balancesTotal - supply,
    lockedTotalUnits: balances?.locked ?? 0,
    creditedDepositsUnits: creditedDeposits,
    depositCreditsUnits: depositCredits,
    settledWithdrawalsUnits: settledWithdrawals,
    withdrawalSpendUnits: withdrawalSpend,
    problems,
    checkedAt: Date.now(),
  };
}

/** Called before anything that would move value out of the gateway. */
export async function assertSettleable(): Promise<void> {
  const report = await checkIntegrity();
  if (report.driftUnits !== 0) {
    throw new Error(`credit supply drift of ${report.driftUnits} units — settlement halted`);
  }
}
