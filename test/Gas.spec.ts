import "dotenv/config";
import { describe, it } from "node:test";
import {
    burn,
    createTotem,
    Hook,
    mint,
    modDetails,
    publishMod,
    setupTotemsTest,
    transfer,
    ZERO_ADDRESS
} from "./helpers.ts";

const RUN = process.env.RUN_GAS_CALCS;
const func = RUN ? describe : describe.skip;
func("Gas Estimations", async function () {


    if (!process.env.ETHERSCAN_API_KEY) {
        throw new Error("Please set your ETHERSCAN_API_KEY in a .env file");
    }

    let testMod: any;
    const {
        viem,
        publicClient,
        totems,
        market,
        accounts
    } = await setupTotemsTest();
    const [seller, buyer] = accounts;

    // Map to track gas usage by operation type
    const gasUsageMap = new Map<string, bigint>();

    // Standard ERC20 gas costs for comparison (approximate baselines)
    // These are typical values for basic ERC20 operations
    const ERC20_GAS = {
        deploy: 1_200_000n,      // Basic ERC20 deployment
        transfer: 51_000n,       // transfer() cold-to-cold
        mint: 51_000n,           // mint() with balance update
        burn: 35_000n,           // burn() with balance update
    };

    // Function to get current gas price from Etherscan
    const getGasPrice = async (): Promise<bigint> => {
        const response = await fetch(
            `https://api.etherscan.io/v2/api?chainid=1&module=gastracker&action=gasoracle&apikey=${process.env.ETHERSCAN_API_KEY}`
        );
        const data:any = await response.json();

        if (data.status !== "1") {
            throw new Error("Failed to fetch gas price from Etherscan");
        }

        // Gas price comes in Gwei, multiply by 1e9 to get Wei
        const gasPriceGwei = parseFloat(data.result.ProposeGasPrice);
        const gasPriceWei = Math.floor(gasPriceGwei * 1_000_000_000);

        return BigInt(gasPriceWei);
    };

    // Function to get ETH price in USD from CoinGecko
    const getEthPrice = async (): Promise<number> => {
        try {
            const response = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
            );
            const data:any = await response.json();
            if (data?.ethereum?.usd) {
                return data.ethereum.usd;
            }
        } catch (e) {
            // Fallback if API fails
        }
        // Fallback price if API is rate limited or fails
        console.log('Note: Using fallback ETH price ($3000) - CoinGecko API unavailable');
        return 3000;
    };

    const getGasUsed = async (hash: string, operationType: string) => {
        const receipt = await publicClient.waitForTransactionReceipt({ hash:hash as any });
        gasUsageMap.set(operationType, receipt.gasUsed);
        return receipt.gasUsed;
    };

    it('Should deploy the test mod and publish to market', async function () {
        testMod = await viem.deployContract("TestMod", [
            totems.address,
            seller,
        ]);

        const hash = await publishMod(market, seller, testMod.address, [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer], modDetails({
            isMinter: true
        }));

        await getGasUsed(hash, "Market Publish");
    });

    it('Should create a totem', async function () {
        const hash = await createTotem(totems, market, seller, "TEST", 4, [
            { recipient: seller, amount: 1000n },
            { recipient: testMod.address, amount: 1000n, isMinter: true },
        ], {
            transfer: [testMod.address],
            mint: [testMod.address],
            burn: [testMod.address],
            created: [testMod.address],
        });

        await getGasUsed(hash, "Totem Creation");
    });

    it('Should transfer tokens', async function () {
        const hash = await transfer(
            totems,
            "TEST",
            seller,
            buyer,
            100n,
            "Test transfer success",
        );

        await getGasUsed(hash, "Transfer");
    });

    it('Should mint tokens', async function () {
        const hash = await mint(
            totems,
            testMod.address,
            seller,
            "TEST",
            100n,
            "Test mint success",
        );

        await getGasUsed(hash, "Mint");
    });

    it('Should burn tokens', async function () {
        const hash = await burn(
            totems,
            "TEST",
            seller,
            50n,
            "Test burn success",
        );

        await getGasUsed(hash, "Burn");
    });

    it('Should output gas costs summary', async function () {
        const ethPriceUsd = await getEthPrice();

        // Map operation names to ERC20 equivalents
        const erc20Map: Record<string, bigint> = {
            'Totem Creation': ERC20_GAS.deploy,
            'Transfer': ERC20_GAS.transfer,
            'Mint': ERC20_GAS.mint,
            'Burn': ERC20_GAS.burn,
        };

        // Sort operations for consistent output
        const sortedOperations = Array.from(gasUsageMap.entries()).sort((a, b) =>
            a[0].localeCompare(b[0])
        );

        const toUsd = (gas: bigint, gwei: number) => {
            const costEth = (Number(gas) * gwei) / 1_000_000_000;
            return costEth * ethPriceUsd;
        };

        const totalGas = sortedOperations.reduce((sum, [_, gas]) => sum + gas, 0n);

        // Helper to print a table for a given network and gwei values
        const printTable = (network: string, gweiValues: number[], decimals: number) => {
            console.log('\n' + '='.repeat(110));
            console.log(`${network} GAS COSTS (ETH: $${ethPriceUsd.toFixed(2)})`);
            console.log('='.repeat(110));

            // Header
            let header = 'Operation'.padEnd(18) + 'Gas Used'.padEnd(12) + 'ERC20'.padEnd(12) + 'vs ERC20'.padEnd(10);
            for (const gwei of gweiValues) {
                header += `|  ${gwei} gwei`.padEnd(14);
            }
            console.log(header);
            console.log('-'.repeat(110));

            // Data rows
            for (const [operation, gasUsed] of sortedOperations) {
                const erc20Gas = erc20Map[operation];
                let vsErc20 = '';
                if (erc20Gas) {
                    const diff = Number(gasUsed) - Number(erc20Gas);
                    const pct = ((diff / Number(erc20Gas)) * 100).toFixed(0);
                    vsErc20 = diff >= 0 ? `+${pct}%` : `${pct}%`;
                }

                let row = operation.padEnd(18) +
                    gasUsed.toString().padEnd(12) +
                    (erc20Gas?.toString() || '-').padEnd(12) +
                    vsErc20.padEnd(10);

                for (const gwei of gweiValues) {
                    const cost = toUsd(gasUsed, gwei);
                    row += `|  $${cost.toFixed(decimals)}`.padEnd(14);
                }
                console.log(row);
            }

            console.log('-'.repeat(110));

            // Total row
            let totalRow = 'TOTAL'.padEnd(18) + totalGas.toString().padEnd(12) + ''.padEnd(12) + ''.padEnd(10);
            for (const gwei of gweiValues) {
                const cost = toUsd(totalGas, gwei);
                totalRow += `|  $${cost.toFixed(decimals)}`.padEnd(14);
            }
            console.log(totalRow);
            console.log('='.repeat(110));
        };

        // Ethereum table: 10/30/100 gwei
        printTable('ETHEREUM', [10, 30, 100], 2);

        // Base table: 0.01/0.1/1 gwei
        printTable('BASE L2', [0.01, 0.1, 1], 4);

        // Reference notes
        console.log('\nERC20 Reference: deploy=1.2M, transfer=51k, mint=51k, burn=35k gas');
        console.log('Note: Totems includes hooks, multi-token registry, and extensibility\n');
    });

    it('Should measure gas costs with increasing number of mods', async function () {
        // Store results for each iteration
        const results: Array<{
            modCount: number;
            publishGas: bigint;
            createGas: bigint;
            transferGas: bigint;
            mintGas: bigint;
            burnGas: bigint;
        }> = [];

        // Track deployed mods and their addresses
        const deployedMods: any[] = [];

        for (let i = 0; i < 20; i++) {
            const modCount = i + 1;

            // Deploy a new test mod
            const newMod = await viem.deployContract("TestMod", [
                totems.address,
                seller,
            ]);

            const publishHash = await publishMod(
                market,
                seller,
                newMod.address,
                [Hook.Created, Hook.Mint, Hook.Burn, Hook.Transfer],
                modDetails({
                    name: `Test Mod ${modCount}`,
                    isMinter: true,
                })
            );

            const publishReceipt = await publicClient.waitForTransactionReceipt({ hash: publishHash });
            const publishGas = publishReceipt.gasUsed;

            // Add this mod to the list
            deployedMods.push(newMod.address);

            // Create hooks array with all deployed mods
            const hooks = {
                transfer: deployedMods,
                mint: deployedMods,
                burn: deployedMods,
                created: deployedMods,
            };

            // Create a totem with all mods
            const modCountToAlphabet = String.fromCharCode(64 + modCount); // 1 -> A, 2 -> B, etc.
            const ticker = `TST${modCountToAlphabet}`;
            const createHash = await createTotem(
                totems,
                market,
                seller,
                ticker,
                4,
                [
                    { recipient: seller, amount: 1000n },
                    { recipient: deployedMods[0], amount: 1000n, isMinter: true },
                ],
                hooks,
                ZERO_ADDRESS
            );

            const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
            const createGas = createReceipt.gasUsed;

            // Transfer tokens
            const transferHash = await transfer(
                totems,
                ticker,
                seller,
                buyer,
                100n,
                "Test transfer",
            );

            const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });
            const transferGas = transferReceipt.gasUsed;

            // Mint tokens
            const mintHash = await mint(
                totems,
                deployedMods[0],
                seller,
                ticker,
                100n,
                "Test mint",
            );

            const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
            const mintGas = mintReceipt.gasUsed;

            // Burn tokens
            const burnHash = await burn(
                totems,
                ticker,
                seller,
                50n,
                "Test burn",
            )

            const burnReceipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
            const burnGas = burnReceipt.gasUsed;

            // Store results
            results.push({
                modCount,
                publishGas,
                createGas,
                transferGas,
                mintGas,
                burnGas,
            });
        }

        // Output results tables
        const ethPriceUsd = await getEthPrice();

        console.log('\n' + '='.repeat(130));
        console.log('GAS COST SCALING WITH NUMBER OF MODS');
        console.log('='.repeat(130));
        console.log(`\nETH Price: $${ethPriceUsd.toFixed(2)}`);

        // Table 1: Raw Gas Costs with ERC20 Comparison
        console.log('\n' + '-'.repeat(100));
        console.log('RAW GAS COSTS (with ERC20 baseline comparison)');
        console.log('-'.repeat(100));
        console.log(
            'Mods'.padEnd(8) +
            'Create'.padEnd(12) +
            'Transfer'.padEnd(12) +
            'Mint'.padEnd(12) +
            'Burn'.padEnd(12) +
            '| vs ERC20 Transfer'
        );
        console.log('-'.repeat(100));

        // ERC20 baseline row
        console.log(
            'ERC20'.padEnd(8) +
            ERC20_GAS.deploy.toString().padEnd(12) +
            ERC20_GAS.transfer.toString().padEnd(12) +
            ERC20_GAS.mint.toString().padEnd(12) +
            ERC20_GAS.burn.toString().padEnd(12) +
            '| (baseline)'
        );
        console.log('-'.repeat(100));

        for (const result of results) {
            const vsErc20 = ((Number(result.transferGas) - Number(ERC20_GAS.transfer)) / Number(ERC20_GAS.transfer) * 100).toFixed(0);
            console.log(
                result.modCount.toString().padEnd(8) +
                result.createGas.toString().padEnd(12) +
                result.transferGas.toString().padEnd(12) +
                result.mintGas.toString().padEnd(12) +
                result.burnGas.toString().padEnd(12) +
                `| +${vsErc20}%`
            );
        }

        const toUsd = (gas: bigint, gwei: number) => {
            const costEth = (Number(gas) * gwei) / 1_000_000_000;
            return costEth * ethPriceUsd;
        };

        // Gas price scenarios: [ethGwei, baseGwei, label]
        const scenarios: [number, number, string][] = [
            [10, 0.01, 'LOW (10 gwei ETH / 0.01 gwei Base)'],
            [30, 0.1, 'MEDIUM (30 gwei ETH / 0.1 gwei Base)'],
            [100, 1, 'HIGH (100 gwei ETH / 1 gwei Base)'],
        ];

        for (const [ethGwei, baseGwei, label] of scenarios) {
            console.log('\n' + '='.repeat(130));
            console.log(`USD COSTS: ETHEREUM vs BASE L2 - ${label}`);
            console.log('='.repeat(130));
            console.log(
                'Mods'.padEnd(6) +
                '|  CREATE'.padEnd(24) +
                '|  TRANSFER'.padEnd(24) +
                '|  MINT'.padEnd(24) +
                '|  BURN'
            );
            console.log(
                ''.padEnd(6) +
                '|  ETH'.padEnd(12) + 'BASE'.padEnd(12) +
                '|  ETH'.padEnd(12) + 'BASE'.padEnd(12) +
                '|  ETH'.padEnd(12) + 'BASE'.padEnd(12) +
                '|  ETH'.padEnd(12) + 'BASE'
            );
            console.log('-'.repeat(130));

            for (const result of results) {
                const createEth = toUsd(result.createGas, ethGwei);
                const createBase = toUsd(result.createGas, baseGwei);
                const transferEth = toUsd(result.transferGas, ethGwei);
                const transferBase = toUsd(result.transferGas, baseGwei);
                const mintEth = toUsd(result.mintGas, ethGwei);
                const mintBase = toUsd(result.mintGas, baseGwei);
                const burnEth = toUsd(result.burnGas, ethGwei);
                const burnBase = toUsd(result.burnGas, baseGwei);

                console.log(
                    result.modCount.toString().padEnd(6) +
                    `|  $${createEth.toFixed(2)}`.padEnd(12) + `$${createBase.toFixed(4)}`.padEnd(12) +
                    `|  $${transferEth.toFixed(2)}`.padEnd(12) + `$${transferBase.toFixed(4)}`.padEnd(12) +
                    `|  $${mintEth.toFixed(2)}`.padEnd(12) + `$${mintBase.toFixed(4)}`.padEnd(12) +
                    `|  $${burnEth.toFixed(2)}`.padEnd(12) + `$${burnBase.toFixed(4)}`
                );
            }

            console.log('='.repeat(130));
        }

        console.log('\n');
    });
});