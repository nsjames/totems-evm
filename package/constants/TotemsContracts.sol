// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

enum Network { Ethereum, Base, Sepolia }

/**
 * @title TotemsContracts
 * @notice Deployed contract addresses for Totems across networks
 */
library TotemsContracts {
    error UnsupportedNetwork();

    function Totems(Network network) internal pure returns (address) {
        if (network == Network.Ethereum) return address(0);
        if (network == Network.Base) return address(0);
        if (network == Network.Sepolia) return address(0xc68f1c237c32caabd7d130fff5a3ba1291185688);
        revert UnsupportedNetwork();
    }

    function Market(Network network) internal pure returns (address) {
        if (network == Network.Ethereum) return address(0);
        if (network == Network.Base) return address(0);
        if (network == Network.Sepolia) return address(0x5461700ba7ad29823007ae1e3bae4a3fa205fcc1);
        revert UnsupportedNetwork();
    }
}
