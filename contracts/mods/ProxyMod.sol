// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";
import "../library/ITotemTypes.sol";
import {TotemsLibrary} from "../library/TotemsLibrary.sol";
import {IMarket} from "../interfaces/IMarket.sol";
import {ITotems} from "../interfaces/ITotems.sol";
import {ReentrancyGuard} from "../shared/ReentrancyGuard.sol";
import {Shared} from "../shared/Shared.sol";
import "hardhat/console.sol";


contract ProxyMod is IModTransfer, IModMint, IModMinter, IModBurn, ReentrancyGuard {

    // Can't use ModBase here because it's deployed BEFORE the totems contract,
    // so need to re-roll some of that here.
    receive() external payable {}
    fallback() external payable {}
    address payable private seller;
    address public marketContract;
    address public totemsContract;

    mapping(bytes32 => mapping(ITotemTypes.Hook => mapping(address => bool))) internal isModEnabled;
    mapping(bytes32 => ITotemTypes.TotemMods) internal totemMods;
    bytes32[] public totemsWithMods;

    function getSeller() external view returns (address payable) {
        return seller != address(0) ? payable(address(seller)) : payable(address(this));
    }

    modifier onlyTotems() {
        require(msg.sender == totemsContract, "Only Totems contract");
        _;
    }

    constructor(address payable _seller) {
        require(_seller != address(0), "Invalid seller address");
        seller = _seller;
    }

    function initialize(
        address _totemsContract,
        address _marketContract
    ) external {
        require(msg.sender == seller, "Only seller can initialize");
        require(totemsContract == address(0), "Already initialized");
        require(_totemsContract != address(0), "Invalid totems contract");
        require(_marketContract != address(0), "Invalid market contract");

        totemsContract = _totemsContract;
        marketContract = _marketContract;
    }

    // ========== Errors ==========
    error CantUseCreatedHook();
    error UnknownHook();
    error ModNotEnabledForMint();
    error InvalidAddressLength();
    error InvalidHexCharacter();
    error NoFeeRequired();

    // ========== Managerial Functions ==========

    function addMod(
        string calldata ticker,
        ITotemTypes.Hook[] calldata hooks,
        address mod,
        address payable referrer
    ) external payable nonReentrant {
        ITotems totems = ITotems(totemsContract);
        IMarket market = IMarket(marketContract);

        require(
            totems.getTotem(ticker).creator == msg.sender,
            "Only the totem creator can add mods"
        );

        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);

        if(!totems.isLicensed(ticker, mod)) {
            uint256 modFee = market.getModFee(mod);
            uint256 referrerFee = totems.getFee(referrer);
            uint256 totalFee = modFee + referrerFee;
            require(msg.value >= totalFee, "Insufficient fee");
            totems.setLicenseFromProxy(tickerBytes, mod);

            // Pay mod seller
            ITotemTypes.Mod memory totemMod = market.getMod(mod);
            if(modFee > 0) {
                Shared.safeTransfer(totemMod.seller, modFee);
            }

            // Pay referrer (or burn if no referrer)
            if(referrerFee > 0) {
                address recipient = referrer != address(0) ? referrer : address(0);
                Shared.safeTransfer(recipient, referrerFee);
            }
        } else {
            if(msg.value > 0) revert NoFeeRequired();
        }

        for (uint256 i = 0; i < hooks.length; i++) {
            ITotemTypes.Hook hook = hooks[i];

            if (isModEnabled[tickerBytes][hook][mod]) {
                continue;
            }

            isModEnabled[tickerBytes][hook][mod] = true;

            _pushModToHook(tickerBytes, hook, mod);
        }
    }

    function removeMod(
        string calldata ticker,
        address mod
    ) external {
        require(
            TotemsLibrary.getCreator(totemsContract, ticker) == msg.sender,
            "Only totem creator"
        );

        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);

        _removeFromHook(tickerBytes, ITotemTypes.Hook.Transfer, mod);
        _removeFromHook(tickerBytes, ITotemTypes.Hook.Mint, mod);
        _removeFromHook(tickerBytes, ITotemTypes.Hook.Burn, mod);
        _removeFromHook(tickerBytes, ITotemTypes.Hook.Created, mod);
    }


    // ========== Mod Hook Functions ==========

    function onTransfer(
        string calldata ticker,
        address from,
        address to,
        uint256 amount,
        string calldata memo
    ) external override onlyTotems {
        TotemsLibrary.checkLicense(totemsContract, ticker);

        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        address[] memory mods = totemMods[tickerBytes].transfer;
        uint256 length = mods.length;

        for (uint256 i = 0; i < length; i++) {
            IModTransfer(mods[i]).onTransfer(
                ticker,
                from,
                to,
                amount,
                memo
            );
        }
    }

    function onMint(
        string calldata ticker,
        address minter,
        uint256 amount,
        uint256 payment,
        string calldata memo
    ) external override onlyTotems {
        TotemsLibrary.checkLicense(totemsContract, ticker);

        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        address[] memory mods = totemMods[tickerBytes].mint;
        uint256 length = mods.length;

        for (uint256 i = 0; i < length; i++) {
            IModMint(mods[i]).onMint(
                ticker,
                minter,
                amount,
                payment,
                memo
            );
        }
    }


    function mint(
        string calldata ticker,
        address minter,
        uint256 amount,
        string calldata memo
    ) external onlyTotems payable {
        TotemsLibrary.checkLicense(totemsContract, ticker);

        // This likely eliminates some use cases, but it's necessary to avoid
        // ambiguity in which mod to use for minting when multiple are present,
        // especially when payment is involved and to align with the core mint->mod logic.
        address mod = _stringToAddress(memo);

        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        if(!isModEnabled[tickerBytes][ITotemTypes.Hook.Mint][mod]) {
            revert ModNotEnabledForMint();
        }

        IModMinter(mod).mint{value: msg.value}(
            ticker,
            minter,
            amount,
            memo
        );
    }

    function onBurn(
        string calldata ticker,
        address owner,
        uint256 amount,
        string calldata memo
    ) external override onlyTotems {
        TotemsLibrary.checkLicense(totemsContract, ticker);

        bytes32 tickerBytes = TotemsLibrary.tickerToBytes(ticker);
        address[] memory mods = totemMods[tickerBytes].burn;
        uint256 length = mods.length;

        for (uint256 i = 0; i < length; i++) {
            IModBurn(mods[i]).onBurn(
                ticker,
                owner,
                amount,
                memo
            );
        }
    }







    // ========== Internal Functions ==========

    function _stringToAddress(string memory str) internal pure returns (address) {
        bytes memory strBytes = bytes(str);
        if(strBytes.length != 42){
            revert InvalidAddressLength();
        }

        bytes memory addrBytes = new bytes(20);

        for (uint i = 0; i < 20; i++) {
            addrBytes[i] = bytes1(
                _hexCharToByte(strBytes[2 + i * 2]) * 16 +
                _hexCharToByte(strBytes[3 + i * 2])
            );
        }

        address addr;
        assembly {
            addr := mload(add(addrBytes, 20))
        }
        return addr;
    }

    function _hexCharToByte(bytes1 char) internal pure returns (uint8) {
        uint8 byteValue = uint8(char);
        if (byteValue >= uint8(bytes1('0')) && byteValue <= uint8(bytes1('9'))) {
            return byteValue - uint8(bytes1('0'));
        } else if (byteValue >= uint8(bytes1('a')) && byteValue <= uint8(bytes1('f'))) {
            return 10 + byteValue - uint8(bytes1('a'));
        } else if (byteValue >= uint8(bytes1('A')) && byteValue <= uint8(bytes1('F'))) {
            return 10 + byteValue - uint8(bytes1('A'));
        }
        revert InvalidHexCharacter();
    }

    function _pushModToHook(
        bytes32 ticker,
        ITotemTypes.Hook hook,
        address mod
    ) internal {
        ITotemTypes.TotemMods storage mods = totemMods[ticker];

        if (hook == ITotemTypes.Hook.Transfer) {
            mods.transfer.push(mod);
        } else if (hook == ITotemTypes.Hook.Mint) {
            mods.mint.push(mod);
        } else if (hook == ITotemTypes.Hook.Burn) {
            mods.burn.push(mod);
        } else if (hook == ITotemTypes.Hook.Created) {
            revert CantUseCreatedHook();
        } else {
            revert UnknownHook();
        }
    }

    function _removeFromHook(
        bytes32 ticker,
        ITotemTypes.Hook hook,
        address mod
    ) internal {
        if (!isModEnabled[ticker][hook][mod]) {
            return;
        }

        delete isModEnabled[ticker][hook][mod];
        _removeModFromHookArray(ticker, hook, mod);
    }

    function _removeModFromHookArray(
        bytes32 ticker,
        ITotemTypes.Hook hook,
        address mod
    ) internal {
        address[] storage arr;

        if (hook == ITotemTypes.Hook.Transfer) arr = totemMods[ticker].transfer;
        else if (hook == ITotemTypes.Hook.Mint) arr = totemMods[ticker].mint;
        else if (hook == ITotemTypes.Hook.Burn) arr = totemMods[ticker].burn;
        else if (hook == ITotemTypes.Hook.Created) arr = totemMods[ticker].created;
        else revert("Invalid hook");

        uint256 length = arr.length;
        for (uint256 i = 0; i < length; i++) {
            if (arr[i] == mod) {
                arr[i] = arr[length - 1];
                arr.pop();
                break;
            }
        }
    }


}