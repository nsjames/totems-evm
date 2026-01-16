import "dotenv/config";
import { createPublicClient, http } from 'viem';
import * as fs from 'fs';
import * as path from 'path';
import { getChain, getRpcUrl } from '../deployments/configs/index.js';

const HOOK_NAMES = ['Created', 'Mint', 'Burn', 'Transfer', 'TransferOwnership'];
const MODE_NAMES = ['DYNAMIC', 'STATIC', 'TOTEM'];

function loadAddresses(network: string): Record<string, string> {
    const addressesPath = path.join(import.meta.dirname, '..', 'deployments', 'addresses', `${network}.json`);
    if (!fs.existsSync(addressesPath)) {
        throw new Error(`No addresses found for network: ${network}`);
    }
    return JSON.parse(fs.readFileSync(addressesPath, 'utf-8'));
}

function loadArtifact(contractPath: string, contractName: string) {
    const artifactPath = path.join(
        import.meta.dirname,
        '..',
        'artifacts',
        'contracts',
        contractPath,
        `${contractName}.json`
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    return artifact.abi;
}

const marketAbi = loadArtifact('market/ModMarket.sol', 'ModMarket');

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error('Usage: bun inspect <mod-address> [network]');
        console.error('Example: bun inspect 0x1234...');
        process.exit(1);
    }

    const modAddress = args[0];
    const network = args[1] || 'sepolia';

    const chain = getChain(network);
    const rpcUrl = getRpcUrl(network);
    const addresses = loadAddresses(network);

    if (!rpcUrl) {
        console.error(`Missing RPC URL for ${network}. Set the appropriate env var.`);
        process.exit(1);
    }

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });

    const marketAddress = addresses.ModMarket;
    if (!marketAddress) {
        console.error(`No ModMarket address found for ${network}`);
        process.exit(1);
    }

    console.log(`\nInspecting mod ${modAddress} on ${network}...\n`);

    // Get mod info
    const mod:any = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: marketAbi,
        functionName: 'getMod',
        args: [modAddress as `0x${string}`],
    });

    if (mod.mod === '0x0000000000000000000000000000000000000000') {
        console.error('Mod not found or not published');
        process.exit(1);
    }

    // Get required actions
    const requiredActions:any = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: marketAbi,
        functionName: 'getModRequiredActions',
        args: [modAddress as `0x${string}`],
    });

    // Display mod info
    console.log('='.repeat(60));
    console.log('MOD INFO');
    console.log('='.repeat(60));
    console.log(`Address:      ${mod.mod}`);
    console.log(`Seller:       ${mod.seller}`);
    console.log(`Price:        ${mod.price} wei`);
    console.log(`Published:    ${new Date(Number(mod.publishedAt) * 1000).toISOString()}`);
    console.log(`Updated:      ${new Date(Number(mod.updatedAt) * 1000).toISOString()}`);
    console.log(`Hooks:        ${mod.hooks.map((h:any) => HOOK_NAMES[h] || h).join(', ')}`);

    console.log('\n' + '='.repeat(60));
    console.log('DETAILS');
    console.log('='.repeat(60));
    console.log(`Name:         ${mod.details.name}`);
    console.log(`Summary:      ${mod.details.summary}`);
    console.log(`Image:        ${mod.details.image}`);
    console.log(`Website:      ${mod.details.website}`);
    console.log(`Ticker Path:  ${mod.details.websiteTickerPath}`);
    console.log(`Is Minter:    ${mod.details.isMinter}`);
    console.log(`Needs Unlimited: ${mod.details.needsUnlimited}`);

    if (mod.details.markdown) {
        console.log(`\nMarkdown:\n${mod.details.markdown}`);
    }

    if (requiredActions.length > 0) {
        console.log('\n' + '='.repeat(60));
        console.log('REQUIRED ACTIONS');
        console.log('='.repeat(60));

        for (let i = 0; i < requiredActions.length; i++) {
            const action = requiredActions[i];
            console.log(`\n[${i + 1}] ${action.signature}`);
            console.log(`    Reason: ${action.reason}`);
            console.log(`    Cost:   ${action.cost} wei`);

            if (action.inputFields.length > 0) {
                console.log('    Fields:');
                for (const field of action.inputFields) {
                    console.log(`      - ${field.name}`);
                    console.log(`        Mode:        ${MODE_NAMES[field.mode] || field.mode}`);
                    if (field.value) console.log(`        Value:       ${field.value}`);
                    if (field.description) console.log(`        Description: ${field.description}`);
                    if (field.min > 0n) console.log(`        Min:         ${field.min}`);
                    if (field.max > 0n) console.log(`        Max:         ${field.max}`);
                    if (field.isTotems) console.log(`        Is Totems:   true`);
                }
            }
        }
    } else {
        console.log('\n(No required actions)');
    }

    console.log('\n');
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
