# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Totems, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

Use one of the following methods to contact me privately:

- Contact me on [Telegram (best option!)](https://t.me/randomnobody)
- Contact me on [X (Twitter)](https://x.com/nsjames_)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity and destination mutability

### Scope

The following are in scope:
- Smart contracts in `contracts/`
- Only Proxy Mod in `contracts/mods/`
- ERC20 relay contracts in `contracts/relays/`

The following are (potentially) out of scope:
- Third-party dependencies
- Test files and scripts

## Security Considerations

### Smart Contract Security

- All contracts use Solidity 0.8.28+ with built-in overflow protection
- Custom reentrancy guards implemented where necessary
- Extensive unit tests with high coverage
- Hooks are isolated - failures do not affect core logic
- State changes occur before hook execution
- Value transfers handled by core contract, not mods

### Mod Security

When building or using mods:
- Always use `onlyTotems` modifier for hook functions
- Always use `onlyLicensed(ticker)` modifier to verify licensing
- Mods are third-party code - review before licensing
- Unlimited minters can mint arbitrary supply (flagged in UI)

### Known Limitations

- No formal security audit has been completed yet
- Mods are permissionless - anyone can publish
- Creators assume risk when selecting mods for their totems
  - Risks are: **unlimited minting, siphoning totems from allocated minters, or "bricking" either intentionally or 
    accidentally**

## Audit Status

**Status: Unaudited**

A formal security audit is planned before mainnet deployment. This section will be updated with audit reports when available.

## Bug Bounty

No current capacity for bug bounties, but this may change in the future. 