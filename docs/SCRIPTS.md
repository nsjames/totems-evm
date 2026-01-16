# Scripts Reference

This document describes all of the scripts available in the project.

> All scripts are run using `bun run <script-name>`. 
> There is not support for `npm` or `yarn` in this project (they might work, but are not tested).

## Build Scripts

### `build`
```bash
bun run build
```
Compiles all Solidity contracts using Hardhat.

### `build:prod`
```bash
bun run build:prod
```
Production build with optimizations enabled and tests excluded. Uses the `production` Hardhat build profile for smaller bytecode.

### `prepare`
```bash
bun run prepare
```
Full release preparation pipeline:
1. Runs production build
2. Generates Solidity interfaces from ABIs
3. Extracts standalone ABI JSON files
4. Prepares the npm package

## Code Generation

### `generate:interfaces`
```bash
bun run generate:interfaces
```
Generates Solidity interface files (`ITotems.sol`, `IMarket.sol`) from contract ABIs, preserving NatSpec documentation from the source contracts.

### `abis`
```bash
bun run abis
```
Extracts ABI JSON from Hardhat artifacts and writes standalone files to the `abis/` directory. Currently extracts `totems.json` and `market.json`.

### `package:build`
```bash
bun run package:build
```
Builds the `@totems/evm` npm package structure in the `package/` directory. Copies contracts, interfaces, and test helpers with the correct import paths for external consumption.

## Testing

### `test`
```bash
bun run test
```
Runs the Hardhat test suite.

### `gas`
```bash
bun run gas
```
Runs gas calculation tests. Sets `RUN_GAS_CALCS=1` to enable gas measurement in `test/Gas.spec.ts`.

### `coverage`
```bash
bun run coverage
```
Runs tests with code coverage reporting.

## Deployment

### `deploy`
```bash
bun run deploy <network>
```
Deploys all contracts to the specified network. Reads configuration from `deployments/configs/<network>.yaml`.

Examples:
```bash
bun run deploy sepolia
bun run deploy base-sepolia
```

For local development:
```bash
bun run deploy hardhat
```
This automatically starts a local Hardhat node before deploying.

### `deploy:hardhat`
```bash
bun run deploy:hardhat
```
Shortcut for `bun prepare && bun scripts/deploy.ts hardhat`. Runs the full prepare step before deploying to a local Hardhat node.

### `deploy:sepolia`
```bash
bun run deploy:sepolia
```
Shortcut for `bun prepare && bun scripts/deploy.ts sepolia`. Runs the full prepare step before deploying to Sepolia testnet.

## Inspection & Debugging

### `inspect`
```bash
bun run inspect <mod-address> [network]
```
Inspects a published mod on the ModMarket. Displays the mod's details, supported hooks, price, and seller information.

Example:
```bash
bun run inspect 0x1234... sepolia
```

### `read`
```bash
bun run read <contract> <function> [args...] [network]
```
Reads state from deployed contracts. Useful for debugging and verification.

Example:
```bash
bun run read Totems getTotem TICKER sepolia
```

### `sizes`
```bash
bun run sizes
```
Displays contract bytecode sizes and estimated deployment costs. Warns if any contract exceeds the 24KB limit. Shows costs for both Ethereum mainnet and Base L2.

## Simulation

### `simulate`
```bash
bun run simulate <network> [numAccounts]
```
Runs a simulation with multiple accounts performing random operations (mints, burns, transfers) against deployed contracts. Useful for stress testing and generating realistic on-chain activity.

Configuration is loaded from `deployments/configs/<network>.yaml` under the `simulation` key:
- `mintAmount`: Base amount to mint per operation
- `txIntervalMin/txIntervalMax`: Delay range between transactions (ms)
- `minEthBalance`: Minimum ETH balance before auto-refunding
- `fundingAmount`: ETH to send when refunding accounts
- `maxSpend`: Maximum total ETH to spend during simulation

Example:
```bash
bun run simulate sepolia 20
```

## Publishing

### `publish:npm`
```bash
bun run publish:npm
```
Builds and publishes the `@totems/evm` package to npm with public access.

### `publish:foundry`
```bash
bun run publish:foundry
```
Interactive script for creating a new git tag and pushing for Foundry package distribution. Prompts for version bump type (major/minor/patch).

## Utilities

### `add:chain`
```bash
bun run add:chain
```
Interactive wizard for adding a new chain configuration. Creates the YAML config file, updates the config index, and provides instructions for setting up environment variables.
