import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import {configVariable, defineConfig} from "hardhat/config";

export default defineConfig({
    plugins: [hardhatToolboxViemPlugin, hardhatVerify],

    ignition: {
        requiredConfirmations: 1
    },

    verify: {
        etherscan: {
            apiKey: configVariable("ETHERSCAN_API_KEY"),
        },
    },
    solidity: {
        profiles: {
            default: {
                version: "0.8.28",
                settings: {
                    viaIR: true,
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
            production: {
                version: "0.8.28",
                settings: {
                    viaIR: true,
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        },
    },
    networks: {
        hardhatMainnet: {
            type: "edr-simulated",
            chainType: "l1",
        },
        hardhatOp: {
            type: "edr-simulated",
            chainType: "op",
        },
        sepolia: {
            type: "http",
            chainType: "l1",
            url: configVariable("SEPOLIA_RPC_URL"),
            accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
        },
        baseSepolia: {
            type: "http",
            chainType: "op",
            url: configVariable("BASE_SEPOLIA_RPC_URL"),
            accounts: [configVariable("BASE_SEPOLIA_PRIVATE_KEY")],
        },
        base: {
            type: "http",
            chainType: "op",
            url: configVariable("BASE_RPC_URL"),
            accounts: [configVariable("BASE_PRIVATE_KEY")],
        },
    },
    chainDescriptors: {
        84532: {
            name: "baseSepolia",
            blockExplorers: {
                etherscan: {
                    name: "BaseScan Sepolia",
                    url: "https://sepolia.basescan.org",
                    apiUrl: "https://api.etherscan.io/v2/api",
                },
            },
        },
        8453: {
            name: "base",
            blockExplorers: {
                etherscan: {
                    name: "BaseScan",
                    url: "https://basescan.org",
                    apiUrl: "https://api.etherscan.io/v2/api",
                },
            },
        },
    },
});
