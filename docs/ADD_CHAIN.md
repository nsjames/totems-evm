# Adding a New Chain

This guide explains how to add support for a new EVM chain.

## Steps

### 1. Create the chain config

Create a new YAML file at `deployments/configs/<network>.yaml`:

```yaml
deployer: "0xYourDeployerAddress"
rpcEnvVar: "NETWORK_RPC_URL"
wsRpcEnvVar: "NETWORK_WS_URL"           # optional, for simulator
explorerUrl: "https://api.explorer.com/api"
explorerApiKeyEnvVar: "EXPLORER_API_KEY"
minBaseFee: "0.0001 ether"
burnedFee: "0.00005 ether"

mods:
  - UnlimitedMinterMod
  # - MinterMod
  # - MinerMod

publish:
  - name: UnlimitedMinterMod
  # - name: MinterMod
  #   price: "0.001 ether"

referrers:
  - address: "0xYourReferrerAddress"
    fee: "0.0001 ether"

totems:
  - tickers: BULL, PURE, CHAD
    config: SIM

# Optional: simulation settings for `bun simulate`
simulation:
  - mintAmount: 100
  - minEthBalance: "0.0001 ether"
  - fundingAmount: "0.001 ether"
  - maxSpend: "0.1 ether"
  - staggerMs: 1500
  - randomDelayMs: 2000
  - weightMint: 45
  - weightTransfer: 45
  - weightBurn: 10
```

### 2. Add the chain to the central config

Edit `deployments/configs/index.ts` and add your chain to the `getChain` function:

```typescript
import { mychain } from 'viem/chains';  // or define custom chain

export function getChain(network: string): Chain {
    switch (network) {
        case 'hardhat':
        case 'hardhatMainnet':
            return hardhat;
        case 'sepolia':
            return sepolia;
        case 'ethereum':
        case 'mainnet':
            return mainnet;
        case 'base':
            return base;
        case 'mychain':           // <-- add your chain
            return mychain;
        default:
            throw new Error(`Unknown network: ${network}. Valid: hardhat, sepolia, ethereum, base, mychain`);
    }
}
```

If your chain isn't in `viem/chains`, define it inline:

```typescript
const mychain = {
    id: 12345,
    name: 'My Chain',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://rpc.mychain.com'] },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: 'https://explorer.mychain.com' },
    },
} as const satisfies Chain;
```

### 3. Set environment variables

Add to your `.env`:

```bash
MYCHAIN_RPC_URL=https://rpc.mychain.com
MYCHAIN_WS_URL=wss://ws.mychain.com      # optional
MYCHAIN_PRIVATE_KEY=0x...                 # for simulator bank account
```

The private key env var follows the convention `<NETWORK>_PRIVATE_KEY`.

### 4. Deploy

```bash
bun deploy mychain
```

This creates `deployments/addresses/mychain.json` with deployed contract addresses.

### 5. Verify (optional)

```bash
bun deploy mychain --verify
```

Requires `explorerUrl` and `explorerApiKeyEnvVar` in the YAML config.

## File Structure

After adding a chain, you'll have:

```
deployments/
├── configs/
│   ├── index.ts          # Central config with getChain()
│   ├── sepolia.yaml
│   ├── ethereum.yaml
│   ├── base.yaml
│   └── mychain.yaml      # Your new config
├── addresses/
│   └── mychain.json      # Created after deployment
├── publish/
│   └── *.json            # Mod publish configs (shared)
└── totems/
    └── *.json            # Totem configs (shared)
```

## Using with Scripts

Once configured, all scripts work with your chain:

```bash
# Deploy
bun deploy mychain

# Read state
bun read MyContract myVariable --network mychain

# Inspect mod
bun inspect 0x... mychain

# Simulate
bun simulate mychain 10
```

## Config Reference

| Field | Required | Description |
|-------|----------|-------------|
| `deployer` | Yes | Address that deploys contracts |
| `rpcEnvVar` | Yes* | Env var containing HTTP RPC URL |
| `rpcUrl` | Yes* | Direct HTTP RPC URL (alternative to rpcEnvVar) |
| `wsRpcEnvVar` | No | Env var containing WebSocket URL |
| `wsRpcUrl` | No | Direct WebSocket URL |
| `explorerUrl` | No | Block explorer API endpoint for verification |
| `explorerApiKeyEnvVar` | No | Env var containing explorer API key |
| `minBaseFee` | Yes | Minimum fee for totem creation |
| `burnedFee` | Yes | Fee burned on totem creation |
| `mods` | Yes | List of mods to deploy |
| `publish` | No | Mods to publish on ModMarket |
| `referrers` | No | Referrer fee configurations |
| `totems` | No | Totems to create after deployment |
| `simulation` | No | Simulation settings (see below) |

*Either `rpcEnvVar` or `rpcUrl` is required.

### Simulation Config

| Field | Default | Description |
|-------|---------|-------------|
| `mintAmount` | `100` | Whole tokens to mint per transaction (multiplied by totem decimals) |
| `minEthBalance` | `0.001 ether` | Minimum ETH before re-funding |
| `fundingAmount` | `0.005 ether` | ETH to send when funding accounts |
| `maxSpend` | `0` (unlimited) | Stop simulation after spending this much ETH total |
| `staggerMs` | `1500` | Delay between starting each account loop |
| `randomDelayMs` | `2000` | Max random delay after each transaction |
| `weightMint` | `45` | Weight for mint action |
| `weightTransfer` | `45` | Weight for transfer action |
| `weightBurn` | `10` | Weight for burn action |
