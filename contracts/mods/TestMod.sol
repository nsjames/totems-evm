// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";
import "../library/ITotemTypes.sol";

contract TestMod is TotemMod, IModTransfer, IModBurn, IModCreated, IModMint, IModMinter, IModTransferOwnership {

    bool shouldRevert = false;

    constructor(
        address _totemsContract,
        address payable _seller
    ) TotemMod(_totemsContract, _seller) {}

    function toggle(bool _revert) external {
        shouldRevert = _revert;
    }

    function isSetupFor(string calldata) external pure override returns (bool) {
        return true;
    }

    /**
     * @notice Example transfer hook that tracks transfer counts
     */
    function onTransfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external override onlyTotems onlyLicensed(ticker) {
        if(shouldRevert) revert("Not supported.");
    }

    /**
     * @notice Example mint hook - not implemented
     * @dev Reverts if called since this mod doesn't support minting
     */
    function onMint(
        string calldata ticker,
        address minter,
        uint256 amount,
        uint256 payment,
        string calldata memo
    ) external override onlyTotems onlyLicensed(ticker) {
        if(shouldRevert) revert("Not supported.");
    }

    /**
     * @notice Example burn hook - no-op implementation
     */
    function onBurn(
        string calldata ticker,
        address owner,
        uint256 amount,
        string calldata memo
    ) external override onlyTotems onlyLicensed(ticker) {
        if(shouldRevert) revert("Not supported.");
    }

    /**
     * @notice Example created hook - no-op implementation
     */
    function onCreated(
        string calldata ticker,
        address creator
    ) external override onlyTotems onlyLicensed(ticker) {
        if(shouldRevert) revert("Not supported.");
    }

    function mint(
        string calldata ticker,
        address minter,
        uint256 amount,
        string calldata memo
    ) external payable override onlyTotems onlyLicensed(ticker) {
        if(shouldRevert) revert("Not supported.");
    }

    /**
     * @notice Example transfer ownership hook - no-op implementation
     */
    function onTransferOwnership(
        string calldata ticker,
        address previousOwner,
        address newOwner
    ) external override onlyTotems onlyLicensed(ticker) {
        if(shouldRevert) revert("Not supported.");
    }
}