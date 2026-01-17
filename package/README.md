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
  validator/   - Mod validation tool
```

## Mod Validator

Validates that mod contracts follow the setup pattern correctly.

### CLI Usage

```bash
# Validate a single contract
npx @totems/evm validate ./contracts/MyMod.sol

# Validate all contracts in a directory
npx @totems/evm validate ./contracts/

# Strict mode - treat warnings as errors (for CI)
npx @totems/evm validate ./contracts/ --strict

# Output as JSON
npx @totems/evm validate ./contracts/ --json

# Generate required actions for market publish
npx @totems/evm validate ./contracts/MyMod.sol --actions
```

### What It Checks

1. **`isSetupFor` Analysis** - Does your mod need setup? If `isSetupFor` depends on state variables, setup is required.

2. **Setup Functions** - Finds functions that modify state used by `isSetupFor`.

3. **Validator Functions** - Each setup function should have a corresponding validator:
   - `setAcceptedToken()` → `canSetAcceptedToken()`
   - `configure()` → `canConfigure()`
   - `setup()` → `canSetup()`

4. **Access Control** - Setup functions should have access control (e.g., `onlyCreator`).

### Example Output

```
────────────────────────────────────────────────────────────
Contract: MinerMod
File: ./contracts/Miner.sol

  isSetupFor: Depends on state
    └─ Variables: totemsPerMine

  Setup Functions:
  ┌─────────────────────────┬─────────────────────────┬─────────────┐
  │ Function                │ Validator               │ Access      │
  ├─────────────────────────┼─────────────────────────┼─────────────┤
  │ setup                   │ canSetup() ✓            │ onlyCreator │
  └─────────────────────────┴─────────────────────────┴─────────────┘

  Result: PASS ✓
```

### Programmatic Usage

```javascript
import { validateContract, formatResults } from '@totems/evm/validator';

const results = validateContract('./contracts/MyMod.sol');
console.log(formatResults(results));
```
