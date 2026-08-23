// Ethereum Sepolia USDC deposits. This is a real automated check against a
// public RPC — the user sends Circle's testnet USDC to the gateway's Sepolia
// address and we read the ERC-20 Transfer log out of the receipt.

import { JsonRpcProvider, id as keccakId, getAddress } from "ethers";

import { config } from "../config.js";
import type { OnChainDeposit } from "./cardano.js";

const TRANSFER_TOPIC = keccakId("Transfer(address,address,uint256)");

let provider: JsonRpcProvider | null = null;

function rpc(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(config.sepolia.rpcUrl, undefined, { staticNetwork: true });
  return provider;
}

const topicToAddress = (topic: string): string => getAddress(`0x${topic.slice(-40)}`);

export async function inspectSepoliaUsdcDeposit(txHash: string): Promise<OnChainDeposit> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash.trim())) {
    return { found: false, amountUnits: 0, confirmations: 0, reason: "That is not a valid Ethereum transaction hash." };
  }
  const to = config.sepolia.depositAddress;
  if (!to) return { found: false, amountUnits: 0, confirmations: 0, reason: "Sepolia deposits are not configured." };

  const receipt = await rpc().getTransactionReceipt(txHash.trim());
  if (!receipt) return { found: false, amountUnits: 0, confirmations: 0, reason: "That transaction is not on Sepolia yet." };
  if (receipt.status !== 1) {
    return { found: false, amountUnits: 0, confirmations: 0, reason: "That Sepolia transaction reverted." };
  }

  const token = getAddress(config.sepolia.usdcContract);
  const recipient = getAddress(to);
  let amountUnits = 0;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== token) continue;
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    if (topicToAddress(log.topics[2]) !== recipient) continue;
    amountUnits += Number(BigInt(log.data)); // USDC is 6dp, so this stays well inside a safe integer
  }

  if (amountUnits <= 0) {
    return {
      found: false,
      amountUnits: 0,
      confirmations: 0,
      reason: "That transaction contains no USDC transfer to the gateway's Sepolia deposit address.",
    };
  }

  const head = await rpc().getBlockNumber();
  return { found: true, amountUnits, confirmations: Math.max(0, head - receipt.blockNumber + 1) };
}
