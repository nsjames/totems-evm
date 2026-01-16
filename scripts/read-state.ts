import "dotenv/config";
import { createPublicClient, http } from 'viem';
import * as fs from 'fs';
import * as path from 'path';
import { getChain, getRpcUrl } from '../deployments/configs/index.js';

function loadAddresses(network: string): Record<string, string> {
    const addressesPath = path.join(import.meta.dirname, '..', 'deployments', 'addresses', `${network}.json`);
    if (!fs.existsSync(addressesPath)) {
        throw new Error(`No addresses found for network: ${network}`);
    }
    return JSON.parse(fs.readFileSync(addressesPath, 'utf-8'));
}

function loadArtifact(contractName: string) {
    // Map contract names to their artifact paths
    const contractPaths: Record<string, string> = {
        'ModMarket': 'market/ModMarket.sol',
        'Totems': 'totems/Totems.sol',
        'ProxyMod': 'mods/ProxyMod.sol',
        'MinterMod': 'mods/MinterMod.sol',
        'UnlimitedMinterMod': 'mods/UnlimitedMinterMod.sol',
        'MinerMod': 'mods/MinerMod.sol',
        'TestMod': 'mods/TestMod.sol',
    };

    const contractPath = contractPaths[contractName];
    if (!contractPath) {
        throw new Error(`Unknown contract: ${contractName}. Available: ${Object.keys(contractPaths).join(', ')}`);
    }

    const artifactPath = path.join(
        import.meta.dirname,
        '..',
        'artifacts',
        'contracts',
        contractPath,
        `${contractName}.json`
    );

    if (!fs.existsSync(artifactPath)) {
        throw new Error(`Artifact not found: ${artifactPath}. Run 'bun run build' first.`);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    return artifact.abi;
}

function parseArgs(args: string[]): { contract: string; variable: string; params: any[]; network: string } {
    let network = 'sepolia';
    const filteredArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--network' || args[i] === '-n') {
            network = args[++i];
        } else {
            filteredArgs.push(args[i]);
        }
    }

    if (filteredArgs.length < 2) {
        console.error('Usage: bun read-state <contract> <variable> [params...] [--network <network>]');
        console.error('');
        console.error('Examples:');
        console.error('  bun read-state ModMarket MIN_BASE_FEE');
        console.error('  bun read-state ModMarket getMod 0x1234...');
        console.error('  bun read-state Totems getBalance TICKER 0x1234...');
        console.error('  bun read-state MinerMod totemsPerMine TICKER --network base');
        console.error('');
        console.error('Available contracts:');
        console.error('  ModMarket, Totems, ProxyMod, MinterMod, UnlimitedMinterMod, MinerMod, TestMod');
        process.exit(1);
    }

    const [contract, variable, ...paramStrings] = filteredArgs;

    // Parse params - try to detect types
    const params = paramStrings.map(p => {
        // Boolean
        if (p === 'true') return true;
        if (p === 'false') return false;
        // BigInt (numbers or hex starting with 0x that are large)
        if (/^\d+$/.test(p)) return BigInt(p);
        // Address or hex
        if (p.startsWith('0x')) return p;
        // String (including tickers)
        return p;
    });

    return { contract, variable, params, network };
}

function formatValue(value: any, indent = 0): string {
    const pad = '  '.repeat(indent);

    if (value === null || value === undefined) {
        return `${pad}null`;
    }

    if (typeof value === 'bigint') {
        return `${pad}${value.toString()}`;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return `${pad}${value}`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return `${pad}[]`;
        const items = value.map((v, i) => `${pad}  [${i}]: ${formatValue(v, 0)}`).join('\n');
        return `${pad}[\n${items}\n${pad}]`;
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([key]) => isNaN(Number(key))) // Skip numeric keys (tuple indices)
            .map(([key, val]) => `${pad}  ${key}: ${formatValue(val, 0)}`);
        if (entries.length === 0) return `${pad}{}`;
        return `${pad}{\n${entries.join('\n')}\n${pad}}`;
    }

    return `${pad}${String(value)}`;
}

async function main() {
    const args = process.argv.slice(2);
    const { contract, variable, params, network } = parseArgs(args);

    const chain = getChain(network);
    const rpcUrl = getRpcUrl(network);
    const addresses = loadAddresses(network);
    const abi = loadArtifact(contract);

    const contractAddress = addresses[contract];
    if (!contractAddress) {
        throw new Error(`Contract ${contract} not found in ${network} addresses. Available: ${Object.keys(addresses).filter(k => typeof addresses[k] === 'string' && addresses[k].startsWith('0x')).join(', ')}`);
    }

    if (!rpcUrl) {
        throw new Error(`Missing RPC URL for ${network}. Set the appropriate env var.`);
    }

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });

    console.log(`\nReading ${contract}.${variable}(${params.map(p => typeof p === 'string' ? `"${p}"` : p).join(', ')}) on ${network}...\n`);

    try {
        const result = await publicClient.readContract({
            address: contractAddress as `0x${string}`,
            abi,
            functionName: variable,
            args: params.length > 0 ? params : undefined,
        });

        console.log('Result:');
        console.log(formatValue(result));
        console.log('');
    } catch (e: any) {
        if (e.message?.includes('reverted')) {
            console.error('Call reverted:', e.shortMessage || e.message);
        } else {
            console.error('Error:', e.message);
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
