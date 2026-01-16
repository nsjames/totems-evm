// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";
import "../library/ITotemTypes.sol";
import {TotemsLibrary} from "../library/TotemsLibrary.sol";

/**
 * @title CoverageMod
 * @notice Test mod that exercises TotemsLibrary helper functions for coverage
 */
contract CoverageMod is TotemMod, IModTransfer, IModMint, IModBurn {

    // Store results for verification
    uint256 public lastBalance;
    address public lastCreator;
    uint256 public lastSupply;
    uint256 public lastHolders;

    constructor(
        address _totemsContract,
        address payable _seller
    ) TotemMod(_totemsContract, _seller) {}

    function isSetupFor(string calldata) external pure override returns (bool) {
        return true;
    }

    // Uses TotemsLibrary.getBalance
    function checkBalance(string calldata ticker) external {
        lastBalance = TotemsLibrary.getBalance(totemsContract, ticker, address(this));
    }

    // Uses TotemsLibrary.getTotem
    function checkTotem(string calldata ticker) external {
        ITotemTypes.Totem memory totem = TotemsLibrary.getTotem(totemsContract, ticker);
        lastCreator = totem.creator;
        lastSupply = totem.supply;
    }

    // Uses TotemsLibrary.getTotemStats
    function checkStats(string calldata ticker) external {
        ITotemTypes.TotemStats memory stats = TotemsLibrary.getTotemStats(totemsContract, ticker);
        lastHolders = stats.holders;
    }

    // Uses TotemsLibrary.transfer
    function doTransfer(
        string calldata ticker,
        address to,
        uint256 amount
    ) external {
        TotemsLibrary.transfer(totemsContract, ticker, to, amount, "library transfer");
    }

    // Hook implementations (required by interfaces)
    function onTransfer(
        string calldata ticker,
        address,
        address,
        uint256,
        string calldata
    ) external override onlyTotems onlyLicensed(ticker) {}

    function onMint(
        string calldata ticker,
        address,
        uint256,
        uint256,
        string calldata
    ) external override onlyTotems onlyLicensed(ticker) {}

    function onBurn(
        string calldata ticker,
        address,
        uint256,
        string calldata
    ) external override onlyTotems onlyLicensed(ticker) {}
}
