// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";

interface ITotemsPartial {
    function transfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external;
}

contract UnlimitedMinterMod is TotemMod, IModMinter, IModMint {

    constructor(
        address _totemsContract,
        address payable _seller
    ) TotemMod(_totemsContract, _seller) {}

    function isSetupFor(string calldata) external pure override returns (bool) {
        return true;
    }

    function onMint(
        string calldata ticker,
        address,
        uint256,
        uint256,
        string calldata
    ) external override onlyTotems onlyLicensed(ticker) {
        // No-op: This mod is a minter, not a mint observer
    }

    function mint(
        string calldata ticker,
        address minter,
        uint256 amount,
        string calldata memo
    ) external payable override onlyTotems onlyLicensed(ticker) {
        ITotemsPartial(totemsContract).transfer(
            ticker,
            address(this),
            minter,
            amount,
            ""
        );
    }
}