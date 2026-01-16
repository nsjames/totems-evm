// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../library/ITotemTypes.sol";
import {TotemsLibrary} from "../library/TotemsLibrary.sol";

interface ITotemsProxyModGetter {
    function getProxyMod() external view returns (address);
}

interface IMod {
    function getSeller() external view returns (address payable);
}

interface IModTransfer {
    function onTransfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external;
}

interface IModMint {
    function onMint(
        string calldata ticker,
        address minter,
        uint256 amount,
        uint256 payment,
        string calldata memo
    ) external;
}

interface IModMinter {
    function mint(
        string calldata ticker,
        address minter,
        uint256 amount,
        string calldata memo
    ) external payable;
}

interface IModBurn {
    function onBurn(
        string calldata ticker,
        address owner,
        uint256 amount,
        string calldata memo
    ) external;
}

interface IModCreated {
    function onCreated(
        string calldata ticker,
        address creator
    ) external;
}

interface IModTransferOwnership {
    function onTransferOwnership(
        string calldata ticker,
        address previousOwner,
        address newOwner
    ) external;
}

/**
 * @title TotemMod
 * @notice Base contract for building mods
 */
abstract contract TotemMod {

    address payable private seller;
    function getSeller() external view returns (address payable) {
        return seller != address(0) ? payable(address(seller)) : payable(address(this));
    }

    function isSetupFor(string calldata ticker) virtual external view returns (bool);

    error InvalidModEventOrigin();
    error NotLicensed();



    /// @notice Address of the Totems contract
    address public immutable totemsContract;

    /**
     * @notice Constructor
     * @param _totemsContract Totems contract address
     * @param _seller The seller that will publish this mod (gets paid)
     */
    constructor(address _totemsContract, address payable _seller) {
        totemsContract = _totemsContract;
        seller = _seller;
    }

    /**
     * @notice Ensure caller is the Totems contract
     */
    modifier onlyTotems() {
        // sender must be either the totems contract or the proxy mod
        if(msg.sender != totemsContract){
            if(msg.sender != ITotemsProxyModGetter(totemsContract).getProxyMod()){
                revert InvalidModEventOrigin();
            }
        }
        _;
    }

    /**
     * @notice Ensure the mod is licensed for the given ticker
     */
    modifier onlyLicensed(string calldata ticker) {
        if (!TotemsLibrary.hasLicense(totemsContract, ticker, address(this))) {
            revert NotLicensed();
        }
        _;
    }

    modifier onlyCreator(string calldata ticker) {
        address creator = TotemsLibrary.getCreator(totemsContract, ticker);
        if (msg.sender != creator) {
            revert("Only totem creator can call this");
        }
        _;
    }

    modifier onlySetup(string calldata ticker) {
        if (!this.isSetupFor(ticker)) {
            revert("Mod is not setup for this totem");
        }
        _;
    }
}