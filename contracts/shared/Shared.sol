// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../library/ITotemTypes.sol";

/**
 * @title Shared
 * @notice Shared utilities for fee management and token handling
 * @dev Contains common functions used across Totems contracts
 */
library Shared {

    // ==================== ERRORS ====================

    /// @notice ETH transfer failed
    error TransferFailed();

    // ==================== FUNCTIONS ====================

    /**
     * @notice Safely transfer ETH to an address
     * @dev Uses low-level call instead of transfer() to support smart contract recipients.
     *      transfer() only forwards 2300 gas which fails for contracts with receive() logic.
     * @param to Recipient address
     * @param amount Amount of ETH to send in wei
     */
    function safeTransfer(address to, uint256 amount) internal {
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Dispense tokens to multiple recipients
     * @param disbursements Array of fee disbursements
     * @dev Transfers native currency to recipients, skips zero-amount disbursements
     */
    function dispenseTokens(ITotemTypes.FeeDisbursement[] memory disbursements) internal {
        for (uint256 i = 0; i < disbursements.length; i++) {
            ITotemTypes.FeeDisbursement memory disbursement = disbursements[i];
            if (disbursement.amount > 0) {
                safeTransfer(disbursement.recipient, disbursement.amount);
            }
        }
    }
}