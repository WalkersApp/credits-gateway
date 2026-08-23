import "./setup.js";

import { connect, close } from "../server/db.js";
import { newId } from "../server/ids.js";
import { setDepositInspector } from "../server/deposits/service.js";
import { setSettlementRunner } from "../server/withdrawals/service.js";
import type { OnChainDeposit } from "../server/deposits/cardano.js";
import type { SubmitResult } from "../server/settlement/cardano.js";

export const VALID_PREPROD_ADDRESS = "addr_test1vz3scr56jxyl7qez7c8m8z75r73vuhhs0kjl8tjp06yqvjga9h60a";
export const MAINNET_ADDRESS = "addr1v9nxvhrjvhfnw6qsyk4x4rz2qsqk7t3z8v9nsg0xmr8qcxqp4nvvv";

export async function resetDatabase(): Promise<void> {
  const db = await connect();
  for (const name of ["users", "creditAccounts", "creditLedger", "deposits", "withdrawals", "rebalances", "adminEvents", "counters", "reserveSnapshots"]) {
    await db.collection(name).deleteMany({});
  }
}

export const disconnect = close;

export const testUser = (): string => newId();

/** Chain reader that always reports the same result. */
export function stubChain(network: string, result: OnChainDeposit): void {
  setDepositInspector(network, async () => result);
}

export interface SettlementStub {
  submissions: number;
  submit: (opts: { assetId: string; destinationAddress: string; amountUnits: number }) => Promise<SubmitResult>;
  reserveUnits: number;
  confirmations: number;
}

/** Settlement backend under test control: no keys, no network, no chain. */
export function stubSettlement(stub: Partial<SettlementStub> = {}): SettlementStub {
  const state: SettlementStub = {
    submissions: 0,
    reserveUnits: 1_000_000_000,
    confirmations: 3,
    submit: async () => ({ txHash: `deadbeef${"0".repeat(48)}${Math.floor(Math.random() * 100)}`.slice(0, 64), ambiguous: false }),
    ...stub,
  };

  setSettlementRunner({
    validateAddress: (address: string) =>
      address.startsWith("addr_test1") ? { ok: true } : { ok: false, reason: "That is a mainnet address. This gateway settles on Cardano preprod." },
    estimateSettlement: async (assetId: string, amountUnits: number) => ({
      assetId,
      amountUnits,
      reserveUnits: state.reserveUnits,
      sufficient: state.reserveUnits >= amountUnits,
      networkFeeLovelace: 200_000,
    }),
    submitSettlement: async (opts) => {
      state.submissions += 1;
      return state.submit(opts);
    },
    getTransactionStatus: async (txHash: string) => ({ txHash, onChain: state.confirmations > 0, confirmations: state.confirmations }),
  });

  return state;
}
