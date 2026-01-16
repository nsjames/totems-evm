// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

/**
 * @title ReentrancyGuard
 * @notice Simple reentrancy guard to prevent reentrant calls
 */
abstract contract ReentrancyGuard {
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "ReentrancyGuard: reentrant call");
        _locked = true;
        _;
        _locked = false;
    }
}
