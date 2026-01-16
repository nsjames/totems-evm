// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IERC20
 * @notice Interface for the ERC20 standard with metadata and allowance management extensions
 */
interface IERC20 {

    // ==================== EVENTS ====================

    /**
     * @notice Emitted when tokens are transferred
     * @param from Address tokens are transferred from
     * @param to Address tokens are transferred to
     * @param value Amount of tokens transferred
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @notice Emitted when an allowance is set
     * @param owner Address that owns the tokens
     * @param spender Address that is approved to spend
     * @param value Amount approved
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ==================== METADATA FUNCTIONS ====================

    /**
     * @notice Returns the name of the token
     * @return The token name
     */
    function name() external view returns (string memory);

    /**
     * @notice Returns the symbol of the token
     * @return The token symbol
     */
    function symbol() external view returns (string memory);

    /**
     * @notice Returns the number of decimals the token uses
     * @return The number of decimals
     */
    function decimals() external view returns (uint8);

    // ==================== CORE ERC20 FUNCTIONS ====================

    /**
     * @notice Returns the total token supply
     * @return The total supply
     */
    function totalSupply() external view returns (uint256);

    /**
     * @notice Returns the account balance of another account
     * @param account The address to query
     * @return The balance
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @notice Transfers tokens to a specified address
     * @param to The address to transfer to
     * @param amount The amount to be transferred
     * @return Success boolean
     */
    function transfer(address to, uint256 amount) external returns (bool);

    /**
     * @notice Returns the amount which spender is still allowed to withdraw from owner
     * @param owner The address which owns the tokens
     * @param spender The address which will spend the tokens
     * @return The amount of tokens still available for the spender
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @notice Approve the passed address to spend the specified amount of tokens on behalf of msg.sender
     * @param spender The address which will spend the funds
     * @param amount The amount of tokens to be spent
     * @return Success boolean
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @notice Transfer tokens from one address to another
     * @param from The address which you want to send tokens from
     * @param to The address which you want to transfer to
     * @param amount The amount of tokens to be transferred
     * @return Success boolean
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    // ==================== ALLOWANCE MANAGEMENT ====================

    /**
     * @notice Atomically increases the allowance granted to spender by the caller
     * @param spender The address which will spend the funds
     * @param addedValue The amount of tokens to increase the allowance by
     * @return Success boolean
     */
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);

    /**
     * @notice Atomically decreases the allowance granted to spender by the caller
     * @param spender The address which will spend the funds
     * @param subtractedValue The amount of tokens to decrease the allowance by
     * @return Success boolean
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool);
}