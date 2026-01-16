// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/IRelayFactory.sol";
import "../interfaces/ITotems.sol";
import "./TotemERC20.sol";
import {Errors} from "../totems/Errors.sol";

/**
 * @title TotemERC20Factory
 * @notice Factory contract for deploying ERC20 relay contracts for totems
 * @dev Allows permissionless creation of ERC20 wrappers for any totem
 */
contract TotemERC20Factory is IRelayFactory {
    ITotems public immutable totems;

    // ==================== CONSTRUCTOR ====================

    constructor(address _totems) {
        totems = ITotems(_totems);
    }

    // ==================== EXTERNAL FUNCTIONS ====================

    /**
     * @notice Create an ERC20 relay contract for a totem
     * @param ticker The totem ticker symbol
     * @return erc20Contract The deployed ERC20 contract address
     */
    function createRelay(string calldata ticker) external returns (address erc20Contract) {
        if(msg.sender != address(totems)) {
            revert Errors.Unauthorized();
        }

        ITotemTypes.Totem memory totem = totems.getTotem(ticker);
        require(totem.creator != address(0), "Totem does not exist");
        erc20Contract = address(new TotemERC20(address(totems), ticker));

        emit RelayCreated(ticker, erc20Contract);
        return erc20Contract;
    }
}
