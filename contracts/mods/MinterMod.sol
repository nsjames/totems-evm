// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";
import "../library/ITotemTypes.sol";
import {ITotems} from "../interfaces/ITotems.sol";

contract MinterMod is TotemMod, IModMinter, IModMint, IModCreated, IModTransfer {

    // ticker -> balance
    mapping(string => uint256) public balances;

    constructor(
        address _totemsContract,
        address payable _seller
    ) TotemMod(_totemsContract, _seller) {}

    function isSetupFor(string calldata) external pure override returns (bool) {
        return true;
    }

    /**
     * @notice Example created hook - no-op implementation
     */
    function onCreated(
        string calldata ticker,
        address creator
    ) external override onlyTotems onlyLicensed(ticker) {
        balances[ticker] = ITotems(totemsContract).getBalance(ticker, address(this));
    }

    function onTransfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external override onlyTotems onlyLicensed(ticker) {
        if (to == address(this)) {
            balances[ticker] += amount;
        }
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
        require(balances[ticker] >= amount, "Not enough left to mint");

        ITotems(totemsContract).transfer(
            ticker,
            address(this),
            minter,
            amount,
            memo
        );

        balances[ticker] = ITotems(totemsContract).getBalance(ticker, address(this));
    }
}
