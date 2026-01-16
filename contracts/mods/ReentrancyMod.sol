// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/TotemMod.sol";
import "../interfaces/ITotems.sol";
import "../library/ITotemTypes.sol";

/**
 * @title ReentrancyMod
 * @notice Malicious mod that attempts reentrancy attacks during hooks
 * @dev Used for security testing - verifies nonReentrant protection works
 */
contract ReentrancyMod is TotemMod, IModTransfer, IModBurn, IModCreated, IModMint, IModMinter {

    // Attack configuration
    enum AttackType { None, Transfer, Mint, Burn }
    AttackType public attackType = AttackType.None;
    string public attackTicker;

    // Track if attack was attempted
    bool public attackAttempted;
    bool public attackSucceeded;
    bytes public lastError;

    event AttackResult(bool succeeded, bytes errorData);

    constructor(address _totemsContract, address payable _seller) TotemMod(_totemsContract, _seller) {}

    function isSetupFor(string calldata) external pure override returns (bool) {
        return true;
    }

    // Configure the attack
    function setAttack(AttackType _type, string calldata _ticker) external {
        attackType = _type;
        attackTicker = _ticker;
        attackAttempted = false;
        attackSucceeded = false;
    }

    function _executeAttack() internal {
        if (attackType == AttackType.None) return;

        attackAttempted = true;
        ITotems totems = ITotems(totemsContract);

        try this._doAttack(totems) {
            attackSucceeded = true;
            lastError = "";
            emit AttackResult(true, "");
        } catch (bytes memory reason) {
            attackSucceeded = false;
            lastError = reason;
            emit AttackResult(false, reason);
        }
    }

    function _doAttack(ITotems totems) external {
        require(msg.sender == address(this), "Only self");

        if (attackType == AttackType.Transfer) {
            // Try to transfer during hook
            totems.transfer(attackTicker, address(this), this.getSeller(), 1, "reentrancy");
        } else if (attackType == AttackType.Mint) {
            // Try to mint during hook - use self as both mod and minter so auth check passes
            totems.mint(address(this), address(this), attackTicker, 1, "reentrancy");
        } else if (attackType == AttackType.Burn) {
            // Try to burn during hook
            totems.burn(attackTicker, address(this), 1, "reentrancy");
        }
    }

    function onCreated(
        string calldata,
        address
    ) external override onlyTotems {
        _executeAttack();
    }

    function onMint(
        string calldata,
        address,
        uint256,
        uint256,
        string calldata
    ) external override onlyTotems {
        _executeAttack();
    }

    function onBurn(
        string calldata,
        address,
        uint256,
        string calldata
    ) external override onlyTotems {
        _executeAttack();
    }

    function onTransfer(
        string calldata,
        address,
        address,
        uint256,
        string calldata
    ) external override onlyTotems {
        _executeAttack();
    }

    // IModMinter implementation - allows this mod to be used as a minter
    function mint(
        string calldata ticker,
        address minter,
        uint256 amount,
        string calldata
    ) external payable override onlyTotems {
        // Transfer the minted amount to the minter (or seller if minter is this contract)
        address recipient = minter == address(this) ? this.getSeller() : minter;
        ITotems(totemsContract).transfer(ticker, address(this), recipient, amount, "minted");
    }
}
