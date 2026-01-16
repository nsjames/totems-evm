// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRelayFactory {
    event RelayCreated(
        string indexed ticker,
        address indexed relayContract
    );

    function createRelay(
        string calldata ticker
    ) external returns (address);
}