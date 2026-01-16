# Totems EVM

Smart contracts for the Totems modular token protocol.

Totems is a modular token standard that separates core token functionality from extensible features 
through a plugin architecture called **Mods** allowing any developer to create and publish new Mods that can be adopted 
by token creators instantly, expanding the capabilities of their tokens without needing to write any custom smart contract code.

**[Documentation](https://totems.fun/docs)** | **[Website](https://totems.fun)** | **[Telegram](https://t.me/totemize)** | **[Twitter](https://x.com/totemsfun)**

You should also check out the [PHILOSOPHY](./docs/PHILOSOPHY.md) document to understand the design principles behind Totems, 
and how I'm working towards building a truly open protocol for programmable tokens.

## Examples of Mods you can build

This is by no means an exhaustive list, just some ideas to get you started:
- Minter Mods: Bonding curves, ICOs, Miners, Airdrops.
- Transfer Mods: Transfer fees, Transfer restrictions, Scam detection, Time locks.
- Burner Mods: Deflationary burns, Conditional burns.
- Governance Mods: On-chain voting, Proposal systems.
- Reward Mods: Staking rewards, Yield farming, Dividend distribution.
- Utility Mods: Memberships, Access control, Subscription services.
- Analytics Mods: On-chain analytics, User behavior tracking.
- Social Mods: Social tokens, Reputation systems.
- Integration Mods: Integration with DeFi protocols, Oracles, External data sources.


## Running locally

### Prerequisites

- Node.js 22+ (used primarily for hardhat)
- [Bun](https://bun.sh) (used for pretty much everything else)

### Setup

```bash
bun install
```

### Scripts

```bash
bun run build           # Compile contracts
bun run test            # Run tests
bun run coverage        # Run tests with coverage
bun run deploy <network> # Deploy to network (e.g., sepolia, hardhat)
```

See [docs/SCRIPTS.md](./docs/SCRIPTS.md) for the full list of available scripts.

## Project Structure

```
contracts/
  totems/       - Core protocol (Totems.sol)
  market/       - ModMarket contract
  mods/         - Testing mods (don't use as examples of good mods!)
  relays/       - ERC20 relay adapters
  interfaces/   - All interfaces
  library/      - Shared libraries and types
deployments/
  addresses/    - Deployed contract addresses per network
  configs/      - Network deployment configs (YAML)
  publish/      - Mod publish configs (JSON)
package/        - npm package (@totems/evm)
scripts/        - Build and deploy scripts
test/           - Test files
```

## Networks

| Network      | Status   |
|--------------|----------|
| Base Sepolia | Deployed |
| Sepolia      | Deployed |
| Ethereum     | Planned  |
| Base         | Planned  |
| BSC          | Planned  |

Contract addresses are available in `deployments/addresses/`.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

### Audit Status

No formal audit has been completed yet. Use at your own risk.

## License

See [LICENSE](LICENSE).

> The general gist of it is that all core Totems and ModMarket code are licensed as AGPL-3.0 to ensure that improvements 
> to the core protocol remain open source, and everything else is MIT licensed so that developers can build freely on top of it.

## Links

- [Documentation](https://totems.fun/docs)
- [Website](https://totems.fun)
- [npm Package](https://www.npmjs.com/package/@totems/evm)
