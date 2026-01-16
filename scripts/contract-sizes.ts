import * as fs from 'fs';
import * as path from 'path';

const ARTIFACTS_DIR = path.join(import.meta.dirname, '..', 'artifacts', 'contracts');

// Gas costs
const DEPLOYMENT_BASE_GAS = 21000n;
const GAS_PER_ZERO_BYTE = 4n;
const GAS_PER_NON_ZERO_BYTE = 16n;

// Current approximate gas prices (in gwei)
const ETH_GAS_PRICE_GWEI = 30n;
const BASE_GAS_PRICE_GWEI = 0.01; // Base L2 is much cheaper

// ETH price in USD
const ETH_PRICE_USD = 3500;

// Contract size limit
const MAX_CONTRACT_SIZE = 24576; // 24KB

interface ContractInfo {
    name: string;
    bytecodeSize: number;
    deploymentGas: bigint;
    ethCostWei: bigint;
    baseCostWei: bigint;
}

function calculateDeploymentGas(bytecode: string): bigint {
    // Remove 0x prefix
    const bytes = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;

    let gas = DEPLOYMENT_BASE_GAS;

    // Count zero and non-zero bytes
    for (let i = 0; i < bytes.length; i += 2) {
        const byte = bytes.slice(i, i + 2);
        if (byte === '00') {
            gas += GAS_PER_ZERO_BYTE;
        } else {
            gas += GAS_PER_NON_ZERO_BYTE;
        }
    }

    // Add intrinsic contract creation gas (~32000) + code deposit cost
    const codeSize = BigInt(bytes.length / 2);
    gas += 32000n + (codeSize * 200n); // 200 gas per byte for code deposit

    return gas;
}

function findArtifacts(dir: string, contracts: ContractInfo[] = []): ContractInfo[] {
    if (!fs.existsSync(dir)) {
        return contracts;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            // Skip build-info and other non-contract directories
            if (!entry.name.endsWith('.sol')) {
                findArtifacts(fullPath, contracts);
            } else {
                findArtifacts(fullPath, contracts);
            }
        } else if (entry.name.endsWith('.json') && !entry.name.endsWith('.dbg.json')) {
            try {
                const artifact = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

                if (artifact.bytecode && artifact.bytecode !== '0x') {
                    const bytecode = artifact.bytecode;
                    const bytecodeSize = (bytecode.length - 2) / 2; // Remove 0x, divide by 2 for bytes
                    const deploymentGas = calculateDeploymentGas(bytecode);

                    const ethCostWei = deploymentGas * ETH_GAS_PRICE_GWEI * 1000000000n;
                    const baseCostWei = BigInt(Math.floor(Number(deploymentGas) * BASE_GAS_PRICE_GWEI * 1000000000));

                    contracts.push({
                        name: artifact.contractName || entry.name.replace('.json', ''),
                        bytecodeSize,
                        deploymentGas,
                        ethCostWei,
                        baseCostWei,
                    });
                }
            } catch (e) {
                // Skip invalid JSON files
            }
        }
    }

    return contracts;
}

function formatEth(wei: bigint): string {
    const eth = Number(wei) / 1e18;
    return eth.toFixed(6);
}

function formatUsd(wei: bigint): string {
    const eth = Number(wei) / 1e18;
    const usd = eth * ETH_PRICE_USD;
    return usd.toFixed(2);
}

function formatSize(bytes: number): string {
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${bytes} B`;
}

function main() {
    console.log('Contract Sizes and Deployment Costs');
    console.log('====================================\n');
    console.log(`Assumptions:`);
    console.log(`  ETH Price: $${ETH_PRICE_USD}`);
    console.log(`  Ethereum Gas Price: ${ETH_GAS_PRICE_GWEI} gwei`);
    console.log(`  Base Gas Price: ${BASE_GAS_PRICE_GWEI} gwei`);
    console.log(`  Max Contract Size: ${formatSize(MAX_CONTRACT_SIZE)}\n`);

    const contracts = findArtifacts(ARTIFACTS_DIR);

    if (contracts.length === 0) {
        console.error('No contracts found. Run "npx hardhat compile" first.');
        process.exit(1);
    }

    // Sort by size descending
    contracts.sort((a, b) => b.bytecodeSize - a.bytecodeSize);

    // Core deployment contracts (for totals)
    const CORE_CONTRACTS = new Set([
        'Totems',
        'ModMarket',
        'ProxyMod'
    ]);

    // Filter to main contracts (exclude interfaces, libraries, test contracts)
    const mainContracts = contracts.filter(c =>
        !c.name.startsWith('I') &&
        !c.name.includes('Test') &&
        !c.name.includes('Mock') &&
        c.bytecodeSize > 100
    );

    console.log('All Contracts:');
    console.log('-'.repeat(100));
    console.log(
        'Contract'.padEnd(25) +
        'Size'.padStart(12) +
        'Gas'.padStart(12) +
        'ETH Cost'.padStart(14) +
        'Base Cost'.padStart(14) +
        'ETH ($)'.padStart(12) +
        'Base ($)'.padStart(12)
    );
    console.log('-'.repeat(100));

    let totalEthCost = 0n;
    let totalBaseCost = 0n;

    for (const contract of mainContracts) {
        const sizeWarning = contract.bytecodeSize > MAX_CONTRACT_SIZE ? ' ⚠️' : '';
        const sizePercent = ((contract.bytecodeSize / MAX_CONTRACT_SIZE) * 100).toFixed(0);
        const isCore = CORE_CONTRACTS.has(contract.name);

        if (isCore) {
            console.log(
                '* ' +
                contract.name.padEnd(23) +
                `${formatSize(contract.bytecodeSize)} (${sizePercent}%)`.padStart(12) +
                contract.deploymentGas.toString().padStart(12) +
                `${formatEth(contract.ethCostWei)} ETH`.padStart(14) +
                `${formatEth(contract.baseCostWei)} ETH`.padStart(14) +
                `$${formatUsd(contract.ethCostWei)}`.padStart(12) +
                `$${formatUsd(contract.baseCostWei)}`.padStart(12) +
                sizeWarning
            );
            totalEthCost += contract.ethCostWei;
            totalBaseCost += contract.baseCostWei;
        } else {
            console.log(
                '  ' +
                contract.name.padEnd(23) +
                `${formatSize(contract.bytecodeSize)} (${sizePercent}%)`.padStart(12) +
                sizeWarning
            );
        }
    }

    console.log('-'.repeat(100));
    console.log(
        '* CORE TOTAL'.padEnd(25) +
        ''.padStart(12) +
        ''.padStart(12) +
        `${formatEth(totalEthCost)} ETH`.padStart(14) +
        `${formatEth(totalBaseCost)} ETH`.padStart(14) +
        `$${formatUsd(totalEthCost)}`.padStart(12) +
        `$${formatUsd(totalBaseCost)}`.padStart(12)
    );
    console.log('\n(* = core contracts included in total)');

    console.log('\n');

    // Show contracts near size limit
    const nearLimit = mainContracts.filter(c => c.bytecodeSize > MAX_CONTRACT_SIZE * 0.8);
    if (nearLimit.length > 0) {
        console.log('Contracts near size limit (>80%):');
        for (const c of nearLimit) {
            const percent = ((c.bytecodeSize / MAX_CONTRACT_SIZE) * 100).toFixed(1);
            const remaining = MAX_CONTRACT_SIZE - c.bytecodeSize;
            console.log(`  ${c.name}: ${percent}% (${formatSize(remaining)} remaining)`);
        }
    }
}

main();
