// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";
import "../library/ITotemTypes.sol";
import {ITotems} from "../interfaces/ITotems.sol";

contract MinerMod is TotemMod, IModMinter, IModMint, IModCreated, IModTransfer {

    // ticker -> balance
    mapping(string => uint256) public balances;
    mapping(string => uint256) public totemsPerMine;
    mapping(string => uint256) public userMaxPerDay;
    mapping(string => mapping(address => uint256)) public userMinedToday;
    mapping(string => uint256) public lastMineDay;

    constructor(
        address _totemsContract,
        address payable _seller
    ) TotemMod(_totemsContract, _seller) {}

    function _validateSetup(
        uint256 _totemsPerMine,
        uint256 _userMaxPerDay
    ) internal pure returns (bool valid, string memory reason) {
        if (_totemsPerMine == 0) {
            return (false, "totemsPerMine must be greater than zero");
        }
        if (_userMaxPerDay == 0) {
            return (false, "userMaxPerDay must be greater than zero");
        }
        if (_userMaxPerDay < _totemsPerMine) {
            return (false, "userMaxPerDay must be greater than or equal to totemsPerMine");
        }
        return (true, "");
    }

    function canSetup(
        string calldata ticker,
        uint256 _totemsPerMine,
        uint256 _userMaxPerDay
    ) public pure returns (bool valid, string memory reason) {
        return _validateSetup(_totemsPerMine, _userMaxPerDay);
    }

    function setup(
        string calldata ticker,
        uint256 _totemsPerMine,
        uint256 _userMaxPerDay
    ) external onlyCreator(ticker) onlyLicensed(ticker) {
        (bool valid, string memory reason) = _validateSetup(_totemsPerMine, _userMaxPerDay);
        require(valid, reason);

        totemsPerMine[ticker] = _totemsPerMine;
        userMaxPerDay[ticker] = _userMaxPerDay;
    }

    function isSetupFor(string calldata ticker) external view override returns (bool) {
        return totemsPerMine[ticker] > 0;
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
    ) external payable override onlyTotems onlyLicensed(ticker) onlySetup(ticker) {
        require(amount == 0, "Amount must be zero, mining mints fixed amount");

        uint256 mineAmount = totemsPerMine[ticker];
        uint256 maxPerDay = userMaxPerDay[ticker];

        uint256 today = block.timestamp / 1 days;
        if (lastMineDay[ticker] < today) {
            lastMineDay[ticker] = today;
        }

        require(userMinedToday[ticker][minter] + mineAmount <= maxPerDay, "User has reached max for today");
        userMinedToday[ticker][minter] += mineAmount;

        require(balances[ticker] >= mineAmount, "Not enough left to mine");
        balances[ticker] -= mineAmount;

        ITotems(totemsContract).transfer(ticker, address(this), minter, mineAmount, "");

        balances[ticker] = ITotems(totemsContract).getBalance(ticker, address(this));
    }
}