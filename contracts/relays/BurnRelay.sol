// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/ITotems.sol";
import "../library/ITotemTypes.sol";

/**
 * @title BurnRelay
 * @notice Only used for testing
 */
contract BurnRelay {

    // ==================== STATE VARIABLES ====================

    ITotems public immutable totems;
    string public ticker;

    // ==================== CONSTRUCTOR ====================
    /**
     * @notice Initialize the BurnRelay for a specific totem
     * @param _totems Address of the Totems contract
     * @param _ticker The totem ticker symbol
     */
    constructor(address _totems, string memory _ticker) {
        totems = ITotems(_totems);
        ticker = _ticker;
    }

    // ==================== EXTERNAL FUNCTIONS ====================
    function burn(uint256 amount) external {
        totems.burn(ticker, msg.sender, amount, "");
    }
}