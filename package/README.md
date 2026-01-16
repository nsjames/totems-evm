# @totems/evm

Solidity contracts and SDK for building Totems mods.

**[Full Documentation](https://totems.fun/docs)** | **[Website](https://totems.fun)**

## Installation

```bash
npm install @totems/evm
```

Or with Foundry:

```bash
forge install nsjames/totems-evm
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
