// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../library/ITotemTypes.sol";

library Errors {
    error Unauthorized();
    error TotemAlreadyExists(string ticker);
    error TotemNotFound(string ticker);
    error NameTooLong(uint256 length);
    error NameTooShort(uint256 length);
    error DescriptionTooLong(uint256 length);
    error EmptyImage();
    error InvalidSeed();
    error ZeroSupply();
    error CantSetLicense();
    error InsufficientFee(uint256 required, uint256 provided);
    error ModNotMinter(address mod);
    error InsufficientBalance(uint256 required, uint256 available);
    error ModMustSupportUnlimitedMinting(address mod);
    error InvalidAllocation(string message);
    error TooManyAllocations();
    error TooManyMods();
    error ModDoesntSupportHook(address mod, ITotemTypes.Hook hook);
    error TotemNotActive();
    error ReferrerFeeTooLow(uint256 minFee);
    error InvalidCursor();
    error CannotTransferToUnlimitedMinter();
}