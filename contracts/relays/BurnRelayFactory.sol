// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import "../interfaces/IRelayFactory.sol";
import "../interfaces/ITotems.sol";
import "./BurnRelay.sol";
import {Errors} from "../totems/Errors.sol";

/**
 * @title BurnRelayFactory
 * @notice Only used for testing
 */
contract BurnRelayFactory is IRelayFactory {
    ITotems public immutable totems;

    constructor(address _totems) {
        totems = ITotems(_totems);
    }

    function createRelay(string calldata ticker) external returns (address burnContract) {
        if(msg.sender != address(totems)) {
            revert Errors.Unauthorized();
        }

        ITotemTypes.Totem memory totem = totems.getTotem(ticker);
        require(totem.creator != address(0), "Totem does not exist");
        burnContract = address(new BurnRelay(address(totems), ticker));

        emit RelayCreated(ticker, burnContract);
        return burnContract;
    }
}
