# @totems/evm

Solidity contracts and SDK for building Totems mods.

**[Full Documentation](https://totems.fun/docs)** | **[Website](https://totems.fun)**

## Installation

```bash
npm install @totems/evm
```

Or with Foundry:

```bash
forge install <org>/totems-evm
```

## Package Structure

```
@totems/evm/
  mods/        - TotemMod base contract & TotemsLibrary
  interfaces/  - ITotems, IMarket, ITotemTypes, etc.
  contracts/   - Core contracts (Totems, ModMarket, etc.)
  constants/   - Network addresses
  test/        - Test helpers (TypeScript)
```

## Usage

### Creating a Mod

```solidity
// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "@totems/evm/mods/TotemMod.sol";
import "@totems/evm/constants/Addresses.sol";

contract MyMod is TotemMod, IModTransfer {
    constructor(address payable _seller)
        TotemMod(TotemsContracts.Totems(Network.Ethereum), _seller) {}

    function onTransfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external override onlyTotems {
        // Your transfer hook logic here
    }
}
```

### Creating a Minter Mod

```solidity
// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "@totems/evm/mods/TotemMod.sol";
import "@totems/evm/mods/TotemsLibrary.sol";

contract MyMinter is TotemMod, IModMinter {
    constructor(
        address _totemsContract,
        address payable _seller
    ) TotemMod(_totemsContract, _seller) {}

    function mint(
        string calldata ticker,
        address minter,
        uint256 amount,
        string calldata memo
    ) external payable override onlyTotems {
        // Transfer tokens from this mod's balance to the minter
        TotemsLibrary.transfer(totemsContract, ticker, minter, amount, memo);
    }
}
```

### Using TotemsLibrary

```solidity
import "@totems/evm/mods/TotemsLibrary.sol";
import "@totems/evm/interfaces/ITotemTypes.sol";

// Get balance
uint256 balance = TotemsLibrary.getBalance(totemsContract, "TICKER", address(this));

// Transfer tokens
TotemsLibrary.transfer(totemsContract, "TICKER", recipient, amount, "memo");

// Get totem info
ITotemTypes.Totem memory totem = TotemsLibrary.getTotem(totemsContract, "TICKER");

// Check license
TotemsLibrary.checkLicense(totemsContract, "TICKER");
```

### Using Network Addresses

```solidity
import "@totems/evm/constants/Addresses.sol";

// Access deployed addresses by network
address totems = TotemsContracts.Totems(Network.Ethereum);
address market = TotemsContracts.Market(Network.Base);
```

### Importing Interfaces

```solidity
import "@totems/evm/interfaces/ITotems.sol";
import "@totems/evm/interfaces/IMarket.sol";
import "@totems/evm/interfaces/IRelayFactory.sol";
```

## Mods

| Path | Description |
|------|-------------|
| `mods/TotemMod.sol` | Base contract for mods + hook interfaces |
| `mods/TotemsLibrary.sol` | Helper functions for interacting with Totems |

## Interfaces

| Path | Description |
|------|-------------|
| `interfaces/ITotems.sol` | Full Totems interface |
| `interfaces/IMarket.sol` | Mod market interface |
| `interfaces/ITotemTypes.sol` | Shared type definitions |
| `interfaces/IRelayFactory.sol` | Factory interface for creating relays |

## Contracts

| Path | Description |
|------|-------------|
| `contracts/Totems.sol` | Main Totems contract (creation, operations, views) |
| `contracts/ModMarket.sol` | Mod publishing and licensing |
| `contracts/Errors.sol` | Custom error definitions |

## Test Helpers

TypeScript helpers for testing with Hardhat/Viem:

```typescript
import {
  setupTotemsTest,
  createTotem,
  publishMod,
  transfer,
  mint,
  burn,
  getBalance,
  getTotem,
  getMod,
  getStats,
  isLicensed,
} from '@totems/evm/test/helpers';

// Setup test environment
const { totems, market, accounts } = await setupTotemsTest();

// Create a totem
await createTotem(totems, market, accounts[0], 'TEST', 18, [
  { recipient: accounts[0], amount: 1000n }
]);

// Query data
const totem = await getTotem(totems, 'TEST');
const balance = await getBalance(totems, 'TEST', accounts[0]);
```

## Hook Interfaces

Mods can implement one or more hook interfaces (all in `mods/TotemMod.sol`):

- `IModTransfer` - Called on every transfer
- `IModMint` - Called after minting
- `IModBurn` - Called after burning
- `IModCreated` - Called when totem is created
- `IModMinter` - Allows the mod to mint tokens

## License

Dual-licensed:

**MIT** - Mod development files (use any license for your mods):
- `mods/*`
- `interfaces/ITotems.sol`, `IMarket.sol`, `ITotemTypes.sol`
- `constants/*`
- `test/*`

**AGPL-3.0-only** - Core protocol implementation:
- `contracts/*`
- `interfaces/IRelayFactory.sol`

See the LICENSE file for the complete list.
