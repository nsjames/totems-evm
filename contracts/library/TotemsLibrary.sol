// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/ITotems.sol";

/**
 * @title TotemsLibrary
 * @notice Helper library for mods to interact with the Totems contract
 * @dev Provides convenient wrappers around ITotems functions and ticker validation utilities.
 *      All functions take the totems contract address as the first parameter, allowing mods
 *      to work with any Totems deployment.
 */
library TotemsLibrary {

    /// @notice Thrown when a ticker contains an invalid character (not A-Z)
    /// @param char The invalid ASCII character code
    error InvalidTickerChar(uint8 char);

    /// @notice Thrown when a ticker is empty or exceeds 10 characters
    /// @param length The invalid ticker length
    error InvalidTickerLength(uint256 length);

    /**
     * @notice Get the creator address of a totem
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     * @return The address that created the totem
     */
    function getCreator(address totems, string memory ticker) internal view returns (address) {
        return ITotems(totems).getTotem(ticker).creator;
    }

    /**
     * @notice Require that the calling contract (mod) is licensed for a totem
     * @dev Reverts with "Totem not licensed" if the mod is not licensed
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     */
    function checkLicense(address totems, string memory ticker) internal view {
        require(hasLicense(totems, ticker, address(this)) == true, "Totem not licensed");
    }

    /**
     * @notice Check if a mod is licensed to operate on a totem
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     * @param mod The mod contract address to check
     * @return True if the mod is licensed, false otherwise
     */
    function hasLicense(
        address totems,
        string memory ticker,
        address mod
    ) internal view returns (bool) {
        return ITotems(totems).isLicensed(ticker, mod);
    }

    /**
     * @notice Transfer tokens from this contract to another address
     * @dev The calling contract must hold the tokens and be authorized to transfer
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     * @param to The recipient address
     * @param amount The amount of tokens to transfer
     * @param memo Optional memo string for the transfer
     */
    function transfer(
        address totems,
        string memory ticker,
        address to,
        uint256 amount,
        string memory memo
    ) internal {
        ITotems(totems).transfer(
            ticker,
            address(this),
            to,
            amount,
            memo
        );
    }

    /**
     * @notice Get the token balance of an account
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     * @param account The address to check
     * @return The token balance
     */
    function getBalance(
        address totems,
        string memory ticker,
        address account
    ) internal view returns (uint256) {
        return ITotems(totems).getBalance(ticker, account);
    }

    /**
     * @notice Get the full totem data structure
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     * @return The Totem struct containing all totem metadata
     */
    function getTotem(
        address totems,
        string memory ticker
    ) internal view returns (ITotemTypes.Totem memory) {
        return ITotems(totems).getTotem(ticker);
    }

    /**
     * @notice Get the statistics for a totem
     * @param totems The Totems contract address
     * @param ticker The totem ticker symbol
     * @return The TotemStats struct containing supply, holder count, etc.
     */
    function getTotemStats(
        address totems,
        string memory ticker
    ) internal view returns (ITotemTypes.TotemStats memory) {
        return ITotems(totems).getStats(ticker);
    }

    /**
     * @notice Convert a ticker string to a deterministic bytes32 hash
     * @dev Normalizes ticker to uppercase and validates characters.
     *      Only A-Z characters are allowed, max 10 characters.
     *      This ensures "btc", "BTC", and "Btc" all produce the same hash.
     * @param ticker The ticker string (case-insensitive, 1-10 chars, A-Z only)
     * @return The keccak256 hash of the normalized uppercase ticker
     */
    function tickerToBytes(string calldata ticker) internal pure returns (bytes32) {
        bytes calldata b = bytes(ticker);
        uint256 len = b.length;

        if (len == 0 || len > 10) {
            revert InvalidTickerLength(len);
        }

        bytes memory out = new bytes(len);

        for (uint256 i = 0; i < len; i++) {
            uint8 c = uint8(b[i]);

            // Convert lowercase a-z (0x61-0x7A) to uppercase A-Z (0x41-0x5A)
            if (c >= 0x61 && c <= 0x7A) {
                c -= 32;
            }

            // Reject any character outside A-Z range
            if (c < 0x41 || c > 0x5A) {
                revert InvalidTickerChar(c);
            }

            out[i] = bytes1(c);
        }

        return keccak256(out);
    }

}