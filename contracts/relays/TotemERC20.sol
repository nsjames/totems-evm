// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/ITotems.sol";
import "../library/ITotemTypes.sol";

/**
 * @title TotemERC20
 * @notice ERC20 wrapper for individual Totems in the multi-token registry
 * @dev Each totem gets its own ERC20 contract instance that relays to Totems
 */
contract TotemERC20 {

    // ==================== STATE VARIABLES ====================

    ITotems public immutable totems;
    string public ticker;

    // ERC20-specific state (not in main totem storage)
    mapping(address => mapping(address => uint256)) private _allowances;

    // ==================== EVENTS ====================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ==================== CONSTRUCTOR ====================

    /**
     * @notice Initialize the ERC20 wrapper for a specific totem
     * @param _totems Address of the Totems contract
     * @param _ticker The totem ticker symbol
     */
    constructor(address _totems, string memory _ticker) {
        totems = ITotems(_totems);
        ticker = _ticker;

        // Verify totem exists
        ITotemTypes.Totem memory totem = totems.getTotem(_ticker);
        require(totem.creator != address(0), "Totem does not exist");
    }

    // ==================== ERC20 METADATA ====================

    /**
     * @notice Returns the name of the token
     */
    function name() external view returns (string memory) {
        ITotemTypes.Totem memory totem = totems.getTotem(ticker);
        return totem.details.name;
    }

    /**
     * @notice Returns the symbol of the token
     */
    function symbol() external view returns (string memory) {
        return ticker;
    }

    /**
     * @notice Returns the number of decimals
     */
    function decimals() external view returns (uint8) {
        ITotemTypes.Totem memory totem = totems.getTotem(ticker);
        return totem.details.decimals;
    }

    /**
     * @notice Returns the total supply
     */
    function totalSupply() external view returns (uint256) {
        ITotemTypes.Totem memory totem = totems.getTotem(ticker);
        return totem.supply;
    }

    // ==================== ERC20 CORE FUNCTIONS ====================

    /**
     * @notice Returns the balance of an account
     * @param account The account to query
     */
    function balanceOf(address account) external view returns (uint256) {
        return totems.getBalance(ticker, account);
    }

    /**
     * @notice Transfer tokens to another address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        totems.transfer(ticker, msg.sender, to, amount, "");
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @notice Returns the allowance granted by owner to spender
     * @param owner Token owner
     * @param spender Approved spender
     */
    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @notice Approve spender to transfer tokens on behalf of caller
     * @param spender Address to approve
     * @param amount Amount to approve
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Transfer tokens from one address to another using allowance
     * @param from Token owner
     * @param to Recipient
     * @param amount Amount to transfer
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);

        // Call Totems as the original owner
        // Note: This requires Totems to accept transfers on behalf of others
        totems.transfer(ticker, from, to, amount, "");

        emit Transfer(from, to, amount);
        return true;
    }

    /**
     * @notice Atomically increases the allowance granted to spender
     * @param spender Address to increase allowance for
     * @param addedValue Amount to add to current allowance
     */
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        _approve(msg.sender, spender, _allowances[msg.sender][spender] + addedValue);
        return true;
    }

    /**
     * @notice Atomically decreases the allowance granted to spender
     * @param spender Address to decrease allowance for
     * @param subtractedValue Amount to subtract from current allowance
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 currentAllowance = _allowances[msg.sender][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(msg.sender, spender, currentAllowance - subtractedValue);
        }
        return true;
    }

    // ==================== INTERNAL FUNCTIONS ====================

    /**
     * @notice Internal approval function
     */
    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "ERC20: approve from zero address");
        require(spender != address(0), "ERC20: approve to zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /**
     * @notice Internal function to update allowance on transfers
     */
    function _spendAllowance(address owner, address spender, uint256 amount) internal {
        uint256 currentAllowance = _allowances[owner][spender];
        if (currentAllowance != type(uint256).max) {
            require(currentAllowance >= amount, "ERC20: insufficient allowance");
            unchecked {
                _approve(owner, spender, currentAllowance - amount);
            }
        }
    }
}