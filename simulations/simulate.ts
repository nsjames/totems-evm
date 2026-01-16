// @ts-nocheck
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  formatEther,
  type Address,
  type PrivateKeyAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import * as fs from "fs";
import * as path from "path";
import { getChain, getRpcUrl, getWsRpcUrl, getPrivateKeyEnvVar, getSimulationConfig, type SimulationConfig } from "../deployments/configs/index.js";

// Parse args: bun simulate <network> <numAccounts> <speed>
// speed = delay in ms between operations (higher = slower)
const args = process.argv.slice(2);
const network = args[0] || "sepolia";
const numAccountsArg = args[1] || "10";
const speedDelayMs = parseInt(args[2] || "0", 10);

// Load addresses and ABI for the specified network
const addressesPath = path.join(import.meta.dirname, "..", "deployments", "addresses", `${network}.json`);
const abiPath = path.join(import.meta.dirname, "..", "abis", "totems.json");
const keysPath = path.join(import.meta.dirname, "keys.json");

if (!fs.existsSync(addressesPath)) {
  console.error(`No addresses file found for network: ${network}`);
  console.error(`Expected: ${addressesPath}`);
  process.exit(1);
}

const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
const abi = JSON.parse(fs.readFileSync(abiPath, "utf-8"));

const TOTEMS_PROXY = addresses.Totems as Address;
const UNLIMITED_MINTER = addresses.UnlimitedMinterMod as Address;
const TICKERS: string[] = addresses.totems;

if (!TICKERS || TICKERS.length === 0) {
  console.error(`No totems found in ${addressesPath}`);
  process.exit(1);
}

// Load simulation config from YAML (with defaults)
const simConfig = getSimulationConfig(network);

type SimAccount = {
  privateKey: `0x${string}`;
  address: Address;
};

type KeysFile = {
  accounts: SimAccount[];
};

// Shared state
let allAccounts: PrivateKeyAccount[] = [];
const balances: Map<Address, Map<string, bigint>> = new Map();
const totemDecimals: Map<string, number> = new Map();
const stats = { mints: 0, transfers: 0, burns: 0, errors: 0, ethSpent: 0n };

// Mutex for bank funding (prevents nonce conflicts)
let fundingLock: Promise<void> = Promise.resolve();
async function withFundingLock<T>(fn: () => Promise<T>): Promise<T> {
  const prevLock = fundingLock;
  let resolve: () => void;
  fundingLock = new Promise((r) => { resolve = r; });
  await prevLock;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}

// Get mint amount for a ticker (whole tokens * 10^decimals)
function getMintAmount(ticker: string): bigint {
  const decimals = totemDecimals.get(ticker) ?? 18;
  return BigInt(simConfig.mintAmount) * 10n ** BigInt(decimals);
}

function loadOrCreateKeys(numAccounts: number): SimAccount[] {
  let keysData: KeysFile = { accounts: [] };

  if (fs.existsSync(keysPath)) {
    keysData = JSON.parse(fs.readFileSync(keysPath, "utf-8"));
    console.log(`Loaded ${keysData.accounts.length} existing keys`);
  }

  while (keysData.accounts.length < numAccounts) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    keysData.accounts.push({
      privateKey,
      address: account.address,
    });
    console.log(`Generated new account: ${account.address}`);
  }

  fs.writeFileSync(keysPath, JSON.stringify(keysData, null, 2));
  return keysData.accounts.slice(0, numAccounts);
}

function pickWeightedAction(): "mint" | "transfer" | "burn" {
  const w = simConfig.weights;
  const total = w.mint + w.transfer + w.burn;
  const rand = Math.random() * total;
  if (rand < w.mint) return "mint";
  if (rand < w.mint + w.transfer) return "transfer";
  return "burn";
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomOther<T>(arr: T[], exclude: T): T {
  const filtered = arr.filter((x) => x !== exclude);
  return pickRandom(filtered);
}

function formatUnits(value: bigint, ticker: string): string {
  const decimals = totemDecimals.get(ticker) ?? 18;
  if (decimals === 0) return value.toString();
  const str = value.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const fraction = str.slice(-decimals).replace(/0+$/, "").slice(0, 4);
  return fraction ? `${whole}.${fraction}` : whole;
}

function log(accountIndex: number, msg: string) {
  console.log(`[${accountIndex.toString().padStart(2, "0")}] ${msg}`);
}

async function operationDelay() {
  // Apply speed delay + random delay
  const totalDelay = speedDelayMs + Math.random() * simConfig.randomDelayMs;
  if (totalDelay > 0) {
    await new Promise((r) => setTimeout(r, totalDelay));
  }
}

async function runAccountLoop(
  accountIndex: number,
  account: PrivateKeyAccount,
  publicClient: PublicClient,
  wallet: WalletClient,
  bankWallet: WalletClient
) {
  const addr = account.address;
  const shortAddr = addr.slice(0, 10) + "...";

  // Initialize balance map for this account
  if (!balances.has(addr)) {
    balances.set(addr, new Map());
  }

  // Fetch initial balances
  for (const ticker of TICKERS) {
    const balance = (await publicClient.readContract({
      address: TOTEMS_PROXY,
      abi,
      functionName: "getBalance",
      args: [ticker, addr],
    })) as bigint;
    balances.get(addr)!.set(ticker, balance);
  }

  log(accountIndex, `${shortAddr} starting loop`);

  while (true) {
    // Check if max spend reached
    if (simConfig.maxSpend > 0n && stats.ethSpent >= simConfig.maxSpend) {
      log(accountIndex, `MAX SPEND REACHED - stopping`);
      return;
    }

    // Check ETH balance and refund if needed
    const ethBalance = await publicClient.getBalance({ address: addr });
    if (ethBalance < simConfig.minEthBalance) {
      log(accountIndex, `LOW ETH (${formatEther(ethBalance)}) - requesting refund...`);
      try {
        await withFundingLock(async () => {
          const fundHash = await bankWallet.sendTransaction({
            to: addr,
            value: simConfig.fundingAmount,
          });
          await publicClient.waitForTransactionReceipt({ hash: fundHash });
          log(accountIndex, `  -> Funded with ${formatEther(simConfig.fundingAmount)} ETH`);
        });
      } catch (fundErr: any) {
        log(accountIndex, `  -> FUND ERROR: ${fundErr.message?.slice(0, 60) || fundErr}`);
        await new Promise((r) => setTimeout(r, 5000)); // Wait before retry
        continue;
      }
    }

    const action = pickWeightedAction();
    const ticker = pickRandom(TICKERS);

    try {
      const mintAmount = getMintAmount(ticker);

      if (action === "mint") {
        log(accountIndex, `MINT ${simConfig.mintAmount} ${ticker}`);
        const hash = await wallet.writeContract({
          address: TOTEMS_PROXY,
          abi,
          functionName: "mint",
          args: [UNLIMITED_MINTER, addr, ticker, mintAmount, ""],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        stats.ethSpent += receipt.gasUsed * receipt.effectiveGasPrice;
        log(accountIndex, `  -> ${hash}`);
        stats.mints++;

        const current = balances.get(addr)!.get(ticker) || 0n;
        balances.get(addr)!.set(ticker, current + mintAmount);
        await operationDelay();
      } else if (action === "transfer") {
        const balance = balances.get(addr)!.get(ticker) || 0n;

        if (balance === 0n) {
          log(accountIndex, `MINT ${simConfig.mintAmount} ${ticker} (no balance for transfer)`);
          const hash = await wallet.writeContract({
            address: TOTEMS_PROXY,
            abi,
            functionName: "mint",
            args: [UNLIMITED_MINTER, addr, ticker, mintAmount, ""],
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          stats.ethSpent += receipt.gasUsed * receipt.effectiveGasPrice;
          log(accountIndex, `  -> ${hash}`);
          stats.mints++;
          balances.get(addr)!.set(ticker, mintAmount);
          await operationDelay();
          continue;
        }

        const recipient = pickRandomOther(allAccounts, account);
        const transferAmount = balance / 2n > 0n ? balance / 2n : balance;

        log(accountIndex, `TRANSFER ${formatUnits(transferAmount, ticker)} ${ticker} -> ${recipient.address.slice(0, 10)}...`);
        const hash = await wallet.writeContract({
          address: TOTEMS_PROXY,
          abi,
          functionName: "transfer",
          args: [ticker, addr, recipient.address, transferAmount, ""],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        stats.ethSpent += receipt.gasUsed * receipt.effectiveGasPrice;
        log(accountIndex, `  -> ${hash}`);
        stats.transfers++;

        balances.get(addr)!.set(ticker, balance - transferAmount);
        const recipientBalance = balances.get(recipient.address)!.get(ticker) || 0n;
        balances.get(recipient.address)!.set(ticker, recipientBalance + transferAmount);
        await operationDelay();
      } else if (action === "burn") {
        const balance = balances.get(addr)!.get(ticker) || 0n;

        if (balance === 0n) {
          log(accountIndex, `MINT ${simConfig.mintAmount} ${ticker} (no balance for burn)`);
          const hash = await wallet.writeContract({
            address: TOTEMS_PROXY,
            abi,
            functionName: "mint",
            args: [UNLIMITED_MINTER, addr, ticker, mintAmount, ""],
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          stats.ethSpent += receipt.gasUsed * receipt.effectiveGasPrice;
          log(accountIndex, `  -> ${hash}`);
          stats.mints++;
          balances.get(addr)!.set(ticker, mintAmount);
          await operationDelay();
          continue;
        }

        const burnAmount = balance / 4n > 0n ? balance / 4n : balance;

        log(accountIndex, `BURN ${formatUnits(burnAmount, ticker)} ${ticker}`);
        const hash = await wallet.writeContract({
          address: TOTEMS_PROXY,
          abi,
          functionName: "burn",
          args: [ticker, addr, burnAmount, ""],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        stats.ethSpent += receipt.gasUsed * receipt.effectiveGasPrice;
        log(accountIndex, `  -> ${hash}`);
        stats.burns++;

        balances.get(addr)!.set(ticker, balance - burnAmount);
        await operationDelay();
      }
    } catch (err: any) {
      log(accountIndex, `ERROR [${ticker}]: ${err.message?.slice(0, 80) || err}`);
      stats.errors++;

      // On error, refresh this account's balances
      for (const t of TICKERS) {
        try {
          const bal = (await publicClient.readContract({
            address: TOTEMS_PROXY,
            abi,
            functionName: "getBalance",
            args: [t, addr],
          })) as bigint;
          balances.get(addr)!.set(t, bal);
        } catch {}
      }
    }
  }
}

async function main() {
  const numAccounts = parseInt(numAccountsArg, 10);
  console.log(`Starting simulation on ${network} with ${numAccounts} parallel accounts\n`);

  // Get chain and RPC from central config
  const chain = getChain(network);
  const rpcUrl = getRpcUrl(network);
  const wsRpcUrl = getWsRpcUrl(network);
  const privateKeyEnvVar = getPrivateKeyEnvVar(network);

  const bankPrivateKey = process.env[privateKeyEnvVar];
  if (!bankPrivateKey) {
    throw new Error(`${privateKeyEnvVar} not set`);
  }

  // Use websocket if available, otherwise fall back to HTTP
  const transport = wsRpcUrl ? webSocket(wsRpcUrl) : http(rpcUrl);
  const transportType = wsRpcUrl ? "WebSocket" : "HTTP";

  const bankAccount = privateKeyToAccount(`0x${bankPrivateKey.replace("0x", "")}`);
  console.log(`Bank account: ${bankAccount.address}`);
  console.log(`Transport: ${transportType}`);
  console.log(`RPC: ${(wsRpcUrl || rpcUrl).slice(0, 40)}...`);
  console.log(`\nSimulation config:`);
  console.log(`  Mint amount: ${simConfig.mintAmount} tokens (whole units)`);
  console.log(`  Min ETH balance: ${formatEther(simConfig.minEthBalance)} ETH`);
  console.log(`  Funding amount: ${formatEther(simConfig.fundingAmount)} ETH`);
  console.log(`  Max spend: ${simConfig.maxSpend > 0n ? formatEther(simConfig.maxSpend) + " ETH" : "unlimited"}`);
  console.log(`  Stagger: ${simConfig.staggerMs}ms, Random delay: ${simConfig.randomDelayMs}ms, Speed delay: ${speedDelayMs}ms`);
  console.log(`  Weights: mint=${simConfig.weights.mint}, transfer=${simConfig.weights.transfer}, burn=${simConfig.weights.burn}`);

  const publicClient = createPublicClient({
    chain,
    transport,
  });

  // Fetch totem decimals for all tickers
  console.log("\nFetching totem decimals...");
  for (const ticker of TICKERS) {
    try {
      const totemInfo:any = (await publicClient.readContract({
        address: TOTEMS_PROXY,
        abi,
        functionName: "getTotem",
        args: [ticker],
      })) as { config: { decimals: number } };
      totemDecimals.set(ticker, totemInfo.details.decimals);
      console.log(`  ${ticker}: ${totemInfo.details.decimals} decimals`);
    } catch (err: any) {
      console.log(`  ${ticker}: failed to fetch decimals, using default 18`);
      totemDecimals.set(ticker, 18);
    }
  }

  const bankWallet = createWalletClient({
    account: bankAccount,
    chain,
    transport,
  });

  // Load or create simulation accounts
  const simAccounts = loadOrCreateKeys(numAccounts);
  allAccounts = simAccounts.map((a) => privateKeyToAccount(a.privateKey));

  // Initialize balance maps
  for (const account of allAccounts) {
    balances.set(account.address, new Map());
  }

  // Fund accounts if needed
  console.log("\nChecking account balances...");
  for (let i = 0; i < allAccounts.length; i++) {
    const account = allAccounts[i];
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < simConfig.minEthBalance) {
      console.log(`[${i.toString().padStart(2, "0")}] Funding ${account.address} (${formatEther(balance)} ETH)`);
      const hash = await bankWallet.sendTransaction({
        to: account.address,
        value: simConfig.fundingAmount,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`     -> Funded with ${formatEther(simConfig.fundingAmount)} ETH`);
    } else {
      console.log(`[${i.toString().padStart(2, "0")}] ${account.address} has ${formatEther(balance)} ETH - OK`);
    }
  }

  // Print stats periodically
  setInterval(() => {
    const total = stats.mints + stats.transfers + stats.burns;
    console.log(
      `\n=== STATS: ${total} total | ${stats.mints} mints | ${stats.transfers} transfers | ${stats.burns} burns | ${stats.errors} errors | ${formatEther(stats.ethSpent)} ETH spent ===\n`
    );
  }, 30000);

  console.log("\nLaunching parallel account loops (Ctrl+C to stop)...\n");

  // Launch all account loops in parallel with staggered starts
  const loops: Promise<void>[] = [];
  for (let i = 0; i < allAccounts.length; i++) {
    const account = allAccounts[i];
    const wallet = createWalletClient({
      account,
      chain,
      transport,
    });
    loops.push(runAccountLoop(i, account, publicClient, wallet, bankWallet));

    // Stagger loop starts to avoid RPC burst
    if (i < allAccounts.length - 1) {
      await new Promise((r) => setTimeout(r, simConfig.staggerMs));
    }
  }

  // Wait forever (loops run indefinitely)
  await Promise.all(loops);
}

main().catch(console.error);
