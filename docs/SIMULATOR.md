# Totem Simulator

The simulator generates realistic on-chain activity by running multiple accounts in parallel, each performing random mint, transfer, and burn operations on totems.

## Usage

```bash
bun simulate <network> <num-accounts>
```

**Examples:**
```bash
bun simulate sepolia 10      # 10 accounts on Sepolia
bun simulate base-sepolia 5  # 5 accounts on Base Sepolia
```

## Requirements

1. **Network config** - A YAML config at `deployments/configs/<network>.yaml`
2. **Deployed contracts** - Addresses file at `deployments/addresses/<network>.json`
3. **Environment variables:**
   - `<NETWORK>_RPC_URL` - HTTP RPC endpoint
   - `<NETWORK>_WS_URL` - WebSocket endpoint (optional, faster)
   - `<NETWORK>_PRIVATE_KEY` - Bank account private key (funds simulator accounts)

## How It Works

1. **Key generation** - Creates/reuses private keys stored in `simulations/keys.json`
2. **Funding** - Checks each account's ETH balance, tops up from bank account if low
3. **Parallel loops** - Each account runs independently, performing random actions
4. **Actions:**
   - **Mint** - Mints tokens via UnlimitedMinterMod
   - **Transfer** - Transfers half balance to another random account
   - **Burn** - Burns 25% of balance

## Configuration

Add a `simulation` section to your network's YAML config:

```yaml
# deployments/configs/base-sepolia.yaml

simulation:
  - mintAmount: 100                # Whole tokens to mint (multiplied by totem decimals)
  - minEthBalance: "0.0001 ether"  # Refund threshold
  - fundingAmount: "0.001 ether"   # ETH per refund
  - maxSpend: "0.1 ether"          # Stop after spending this much ETH (0 = unlimited)
  - staggerMs: 1500                # Delay between account starts
  - randomDelayMs: 2000            # Max random delay after each tx
  - weightMint: 45                 # Mint probability weight
  - weightTransfer: 45             # Transfer probability weight
  - weightBurn: 10                 # Burn probability weight
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `mintAmount` | `100` | Whole tokens per mint (multiplied by totem's decimals at runtime) |
| `minEthBalance` | `0.001 ether` | Account is refunded when ETH drops below this |
| `fundingAmount` | `0.005 ether` | ETH sent from bank when refunding |
| `maxSpend` | `0` (unlimited) | Stop simulation after spending this much ETH total |
| `staggerMs` | `1500` | Milliseconds between starting each account loop |
| `randomDelayMs` | `2000` | Max random delay after each transaction (prevents sync) |
| `weightMint` | `45` | Relative weight for mint action |
| `weightTransfer` | `45` | Relative weight for transfer action |
| `weightBurn` | `10` | Relative weight for burn action |

### Action Weights

Weights determine action probability. With defaults (45/45/10):
- Mint: 45% chance
- Transfer: 45% chance
- Burn: 10% chance

To make burns more frequent:
```yaml
simulation:
  - weightMint: 30
  - weightTransfer: 30
  - weightBurn: 40
```

## Output

The simulator logs each action with account index:

```
[00] MINT 100 BULL
[00]   -> 0x1234...
[03] TRANSFER 50 CHAD -> 0x5678...
[03]   -> 0xabcd...
[07] BURN 25 YOLO
[07]   -> 0xef01...
```

Stats are printed every 30 seconds:

```
=== STATS: 150 total | 120 mints | 25 transfers | 5 burns | 2 errors | 0.0234 ETH spent ===
```

## WebSocket vs HTTP

The simulator automatically uses WebSocket if `<NETWORK>_WS_URL` is set:

```bash
# .env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/xxx
SEPOLIA_WS_URL=wss://eth-sepolia.g.alchemy.com/v2/xxx  # Optional but faster
```

WebSocket maintains a persistent connection, reducing latency for high-frequency operations.

## Simulator Keys

Private keys are stored in `simulations/keys.json` (gitignored):

```json
{
  "accounts": [
    {
      "privateKey": "0x...",
      "address": "0x..."
    }
  ]
}
```

Keys persist between runs. To use more accounts, just increase the count - new keys are generated as needed.

## Troubleshooting

### "TotemNotFound" errors
The ticker doesn't exist on-chain. Check `deployments/addresses/<network>.json` has the correct `totems` array.

### Accounts running out of ETH
Increase `fundingAmount` or decrease `minEthBalance` in your simulation config.

### Transactions syncing up
Increase `randomDelayMs` to spread transactions more.

### RPC rate limits
Reduce account count or increase `staggerMs` and `randomDelayMs`.

## Example: Low-cost Testnet Config

For testnets with limited faucet funds:

```yaml
simulation:
  - mintAmount: 10                 # Smaller mints
  - minEthBalance: "0.00001 ether" # Lower threshold
  - fundingAmount: "0.0001 ether"  # Smaller refunds
  - staggerMs: 3000                # More stagger
  - randomDelayMs: 5000            # More delay
  - weightMint: 60                 # More mints (cheaper than transfers)
  - weightTransfer: 30
  - weightBurn: 10
```

## Example: High-throughput Config

For stress testing with adequate funds:

```yaml
simulation:
  - mintAmount: 1000
  - minEthBalance: "0.01 ether"
  - fundingAmount: "0.05 ether"
  - staggerMs: 500
  - randomDelayMs: 500
  - weightMint: 40
  - weightTransfer: 50
  - weightBurn: 10
```
