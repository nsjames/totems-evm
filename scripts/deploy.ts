import "dotenv/config";
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getConfig as getNetworkConfig, getPublishConfig, getTotemConfig, getChain, getRpcUrl, type NetworkConfig } from '../deployments/configs/index.js';

// Hardhat's default test account #0
// NEVER USE THIS IF YOU SEE THIS, THIS IS A WIDELY KNOWN PRIVATE KEY FOR LOCAL TESTING ONLY
const HARDHAT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function getEnvVar(name: string, defaultValue?: string): string {
    const value = process.env[name]?.trim();
    if (!value && defaultValue === undefined) throw new Error(`${name} not set in environment`);
    return value || defaultValue!;
}

function loadPrivateKeys(): Map<string, `0x${string}`> {
    const keysEnv = process.env.PRIVATE_KEYS?.trim();
    if (!keysEnv) return new Map();

    const addressToKey = new Map<string, `0x${string}`>();
    const keys = keysEnv.split(',').map(k => k.trim()).filter(Boolean);

    for (const key of keys) {
        let normalizedKey = key;
        if (!normalizedKey.startsWith('0x')) {
            normalizedKey = '0x' + normalizedKey;
        }
        if (normalizedKey.length !== 66) {
            console.warn(`Skipping invalid private key (wrong length)`);
            continue;
        }
        const account = privateKeyToAccount(normalizedKey as `0x${string}`);
        addressToKey.set(account.address.toLowerCase(), normalizedKey as `0x${string}`);
    }

    return addressToKey;
}

let hardhatNode: ChildProcess | null = null;

async function startHardhatNode(): Promise<void> {
    process.stdout.write('Starting hardhat node...');

    hardhatNode = spawn('npx', ['hardhat', 'node'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    // Wait for node to be ready
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Hardhat node startup timeout'));
        }, 30000);

        hardhatNode!.stdout?.on('data', (data: Buffer) => {
            const output = data.toString();
            if (output.includes('Started HTTP')) {
                clearTimeout(timeout);
                console.log(' ✓');
                resolve();
            }
        });

        hardhatNode!.stderr?.on('data', (data: Buffer) => {
            // Suppress stderr unless it's a real error
        });

        hardhatNode!.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        hardhatNode!.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                clearTimeout(timeout);
                reject(new Error(`Hardhat node exited with code ${code}`));
            }
        });
    });
}

function stopHardhatNode(): void {
    if (hardhatNode) {
        hardhatNode.kill();
        hardhatNode = null;
    }
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
    return {
        abi: artifact.abi,
        bytecode: artifact.bytecode as `0x${string}`,
    };
}

interface Addresses {
    chainId?: number;
    referrer?: string;
    ModMarket?: string;
    ProxyMod?: string;
    Totems?: string;
    MinterMod?: string;
    UnlimitedMinterMod?: string;
    proxyModInitialized?: boolean;
    totems?: string[];
}

function loadExistingDeployment(network: string): Addresses {
    const addressesDir = path.join(import.meta.dirname, '..', 'deployments', 'addresses');
    const outputPath = path.join(addressesDir, `${network}.json`);
    if (fs.existsSync(outputPath)) {
        return JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    }
    return {};
}

function saveDeployment(network: string, addresses: Addresses): void {
    const addressesDir = path.join(import.meta.dirname, '..', 'deployments', 'addresses');
    if (!fs.existsSync(addressesDir)) {
        fs.mkdirSync(addressesDir, { recursive: true });
    }
    const outputPath = path.join(addressesDir, `${network}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
}

interface VerifyRequest {
    contractAddress: string;
    contractPath: string;
    contractName: string;
    constructorArgs: any[];
}

// Map deploy script network names to hardhat config network names
function getHardhatNetwork(network: string): string {
    const mapping: Record<string, string> = {
        'base-sepolia': 'baseSepolia',
        'sepolia': 'sepolia',
        'base': 'base',
    };
    return mapping[network] || network;
}

async function verifyContracts(
    network: string,
    contracts: VerifyRequest[]
): Promise<void> {
    const hardhatNetwork = getHardhatNetwork(network);

    // Skip verification for local networks
    if (network === 'hardhat' || network === 'hardhatMainnet') {
        console.log('⚠ Verification skipped - local network');
        return;
    }

    console.log('\nVerifying contracts via Hardhat...');

    const { spawn } = await import('child_process');

    for (const contract of contracts) {
        console.log(`  ${contract.contractName} (${contract.contractAddress})`);

        try {
            // Build the hardhat verify command args
            const args = [
                'hardhat', 'verify',
                '--network', hardhatNetwork,
                '--build-profile', 'production',
                contract.contractAddress,
                ...contract.constructorArgs.map(arg => String(arg))
            ];

            const cmd = `npx ${args.join(' ')}`;
            console.log(`    > ${cmd}`);

            // Run npx hardhat verify
            const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
                const proc = spawn('npx', args, {
                    cwd: path.join(import.meta.dirname, '..'),
                    shell: true
                });

                let output = '';
                proc.stdout.on('data', (data) => { output += data.toString(); });
                proc.stderr.on('data', (data) => { output += data.toString(); });

                proc.on('close', (code) => {
                    resolve({ success: code === 0, output });
                });
            });

            if (result.success || result.output.includes('Already Verified') || result.output.includes('already verified')) {
                console.log('    ✓ Verified');
            } else {
                console.log('    ✗ Failed');
                console.log('    ' + result.output.trim().split('\n').join('\n    '));
            }
        } catch (e: any) {
            console.log(`    ✗ ${e.message}`);
        }
    }
}

async function deploy(network: string, verify: boolean = false, force: boolean = false) {
    console.log(`\nDeploying to ${network}...${force ? ' (force)' : ''}\n`);

    const chain = getChain(network);
    const networkConfig = getNetworkConfig(network);
    const rpcUrl = getRpcUrl(network);

    // Load all private keys
    const privateKeys = loadPrivateKeys();

    // For hardhat, add the test account private key
    const isHardhat = network === 'hardhat' || network === 'hardhatMainnet';
    if (isHardhat) {
        privateKeys.set('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'.toLowerCase(), HARDHAT_PRIVATE_KEY);
    }

    // Get deployer private key
    const deployerKey = privateKeys.get(networkConfig.deployer.toLowerCase());
    if (!deployerKey) {
        throw new Error(`No private key found for deployer ${networkConfig.deployer}. Add it to PRIVATE_KEYS env var.`);
    }

    const account = privateKeyToAccount(deployerKey);

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
    });

    // Load existing deployment (or start fresh if force)
    const addresses: any = force ? {} : loadExistingDeployment(network);
    addresses.chainId = chain.id;
    if (networkConfig.referrers.length > 0) {
        addresses.referrer = networkConfig.referrers[0].address;
    }

    // Save immediately if force to clear old addresses
    if (force) {
        saveDeployment(network, addresses);
    }

    // Load base artifacts (always deployed)
    const ModMarket = loadArtifact('market/ModMarket.sol', 'ModMarket');
    const Totems = loadArtifact('totems/Totems.sol', 'Totems');
    const ProxyMod = loadArtifact('mods/ProxyMod.sol', 'ProxyMod');

    // Helper to load mod artifact dynamically
    function loadModArtifact(modName: string) {
        return loadArtifact(`mods/${modName}.sol`, modName);
    }

    // Deploy helper - skips if already deployed (unless force)
    async function deployContract(
        name: keyof Addresses,
        artifact: { abi: any; bytecode: `0x${string}` },
        args: any[] = []
    ): Promise<`0x${string}`> {
        if (addresses[name] && !force) {
            console.log(`✓ ${name}`);
            return addresses[name] as `0x${string}`;
        }

        process.stdout.write(`  ${name}...`);
        const hash = await walletClient.deployContract({
            abi: artifact.abi,
            bytecode: artifact.bytecode,
            args,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const address = receipt.contractAddress!;
        console.log(` ✓`);

        // Save immediately after each deploy
        addresses[name] = address;
        saveDeployment(network, addresses);

        return address;
    }

    // Deploy base contracts (always)
    const marketAddress = await deployContract('ModMarket', ModMarket, [networkConfig.minBaseFee, networkConfig.burnedFee]);
    const proxyModAddress = await deployContract('ProxyMod', ProxyMod, [networkConfig.deployer]);

    const totemsAddress = await deployContract('Totems', Totems, [
        marketAddress,
        proxyModAddress,
        networkConfig.minBaseFee,
        networkConfig.burnedFee,
    ]);

    // Deploy mods (based on config)
    for (const modName of networkConfig.mods) {
        const modArtifact = loadModArtifact(modName);
        await deployContract(modName as keyof Addresses, modArtifact, [totemsAddress, networkConfig.deployer]);
    }

    // Initialize ProxyMod (only if not already done, or force)
    if (!addresses.proxyModInitialized || force) {
        process.stdout.write('  ProxyMod init...');
        try {
            const initHash = await walletClient.writeContract({
                address: proxyModAddress as `0x${string}`,
                abi: ProxyMod.abi,
                functionName: 'initialize',
                args: [totemsAddress, marketAddress],
            });
            await publicClient.waitForTransactionReceipt({ hash: initHash });
            console.log(' ✓');
        } catch (e: any) {
            if (e.message?.includes('Already initialized')) {
                console.log(' ✓ (already)');
            } else {
                throw e;
            }
        }
        addresses.proxyModInitialized = true;
        saveDeployment(network, addresses);
    } else {
        console.log('✓ ProxyMod initialized');
    }

    // Set referrer fees
    if (networkConfig.referrers.length > 0) {
        const referrerAbi = [
            {
                name: 'setReferrerFee',
                type: 'function',
                inputs: [{ name: 'fee', type: 'uint256' }],
                outputs: [],
                stateMutability: 'nonpayable',
            },
            {
                name: 'getFee',
                type: 'function',
                inputs: [{ name: 'referrer', type: 'address' }],
                outputs: [{ name: '', type: 'uint256' }],
                stateMutability: 'view',
            },
        ] as const;

        for (const referrer of networkConfig.referrers) {
            // Check current fees (may fail if contract is fresh)
            let marketFee: bigint | null = null;
            let totemsFee: bigint | null = null;

            try {
                [marketFee, totemsFee] = await Promise.all([
                    publicClient.readContract({
                        address: marketAddress as `0x${string}`,
                        abi: referrerAbi,
                        functionName: 'getFee',
                        args: [referrer.address],
                    }),
                    publicClient.readContract({
                        address: totemsAddress as `0x${string}`,
                        abi: referrerAbi,
                        functionName: 'getFee',
                        args: [referrer.address],
                    }),
                ]);
            } catch {
                // Contract may not exist yet or fee not set
            }

            if (marketFee === referrer.fee && totemsFee === referrer.fee) {
                console.log(`✓ Referrer ${referrer.address.slice(0, 10)}...`);
                continue;
            }

            const privateKey = privateKeys.get(referrer.address.toLowerCase());
            if (!privateKey) {
                console.log(`⚠ Referrer ${referrer.address} - no private key found`);
                continue;
            }

            const referrerAccount = privateKeyToAccount(privateKey);
            const referrerWallet = createWalletClient({
                account: referrerAccount,
                chain,
                transport: http(rpcUrl),
            });

            process.stdout.write(`  Referrer ${referrer.address.slice(0, 10)}...`);

            // Set on market if different
            if (marketFee !== referrer.fee) {
                const marketHash = await referrerWallet.writeContract({
                    address: marketAddress as `0x${string}`,
                    abi: referrerAbi,
                    functionName: 'setReferrerFee',
                    args: [referrer.fee],
                });
                await publicClient.waitForTransactionReceipt({ hash: marketHash });
            }

            // Set on totems if different
            if (totemsFee !== referrer.fee) {
                const totemsHash = await referrerWallet.writeContract({
                    address: totemsAddress as `0x${string}`,
                    abi: referrerAbi,
                    functionName: 'setReferrerFee',
                    args: [referrer.fee],
                });
                await publicClient.waitForTransactionReceipt({ hash: totemsHash });
            }

            console.log(' ✓');
        }
    }

    // Publish mods (based on config)
    if (networkConfig.publish.length > 0) {
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

        for (const publishEntry of networkConfig.publish) {
            const modName = publishEntry.name;
            const modAddress = addresses[modName as keyof Addresses];
            if (!modAddress) {
                console.log(`⚠ Cannot publish ${modName} - not deployed`);
                continue;
            }

            // Check if already published
            try {
                const existingMod:any = await publicClient.readContract({
                    address: marketAddress as `0x${string}`,
                    abi: ModMarket.abi,
                    functionName: 'getMod',
                    args: [modAddress as `0x${string}`],
                });

                if (existingMod.mod !== ZERO_ADDRESS) {
                    console.log(`✓ ${modName} (published)`);
                    continue;
                }
            } catch {
                // Not published yet
            }

            // Load publish config
            let publishConfig;
            try {
                publishConfig = getPublishConfig(modName);
            } catch (e: any) {
                console.log(`⚠ Cannot publish ${modName} - ${e.message}`);
                continue;
            }

            // Use price from YAML if specified, otherwise use JSON config price
            const modPrice = publishEntry.price ?? publishConfig.price;

            process.stdout.write(`  ${modName} publishing...`);

            // Get publish fee
            const fee = await publicClient.readContract({
                address: marketAddress as `0x${string}`,
                abi: ModMarket.abi,
                functionName: 'getFee',
                args: [ZERO_ADDRESS],
            });

            // Publish
            const publishHash = await walletClient.writeContract(<any>{
                address: marketAddress as `0x${string}`,
                abi: ModMarket.abi,
                functionName: 'publish',
                args: [
                    modAddress as `0x${string}`,
                    publishConfig.hooks,
                    modPrice,
                    publishConfig.details,
                    publishConfig.requiredActions,
                    ZERO_ADDRESS,
                ],
                value: fee,
            });

            await publicClient.waitForTransactionReceipt({ hash: publishHash });
            console.log(' ✓');
        }
    }

    // Create totems (based on config)
    if (networkConfig.totems.length > 0) {
        const ITotems = loadArtifact('interfaces/ITotems.sol', 'ITotems');
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

        // Helper to resolve address from name or address string
        function resolveAddress(nameOrAddress: string): `0x${string}` {
            if (nameOrAddress === 'deployer') {
                return networkConfig.deployer;
            }
            if (nameOrAddress.startsWith('0x')) {
                return nameOrAddress as `0x${string}`;
            }
            // Try to resolve from deployed addresses
            const addr = addresses[nameOrAddress];
            if (addr && typeof addr === 'string') {
                return addr as `0x${string}`;
            }
            throw new Error(`Cannot resolve address for: ${nameOrAddress}`);
        }

        for (const totemEntry of networkConfig.totems) {
            const { ticker, config: configName } = totemEntry;

            // Check if totem already exists
            try {
                const existingTotem: any = await publicClient.readContract({
                    address: totemsAddress as `0x${string}`,
                    abi: ITotems.abi,
                    functionName: 'getTotem',
                    args: [ticker],
                });

                if (existingTotem.creator !== ZERO_ADDRESS) {
                    // Track totem in addresses
                    if (!addresses.totems) addresses.totems = [];
                    if (!addresses.totems.includes(ticker)) {
                        addresses.totems.push(ticker);
                        saveDeployment(network, addresses);
                    }
                    console.log(`✓ ${ticker} (exists)`);
                    continue;
                }
            } catch {
                // Totem doesn't exist, continue to create
            }

            // Load totem config
            let totemConfig;
            try {
                totemConfig = getTotemConfig(configName);
            } catch (e: any) {
                console.log(`⚠ Cannot create ${ticker} - ${e.message}`);
                continue;
            }

            process.stdout.write(`  ${ticker} creating...`);

            // Get base creation fee
            let totalFee = await publicClient.readContract({
                address: totemsAddress as `0x${string}`,
                abi: ITotems.abi,
                functionName: 'getFee',
                args: [ZERO_ADDRESS],
            }) as bigint;

            // Add mod license fees for each unique mod
            const allMods = [
                ...totemConfig.mods.transfer,
                ...totemConfig.mods.mint,
                ...totemConfig.mods.burn,
                ...totemConfig.mods.created,
                ...totemConfig.mods.transferOwnership,
            ];
            const uniqueMods = [...new Set(allMods.map(resolveAddress))];

            for (const modAddress of uniqueMods) {
                const modFee = await publicClient.readContract({
                    address: marketAddress as `0x${string}`,
                    abi: ModMarket.abi,
                    functionName: 'getModFee',
                    args: [modAddress],
                }) as bigint;
                totalFee += modFee;
            }

            // Generate random seed
            const seed = `0x${[...Array(32)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

            // Build details
            const details = {
                seed,
                decimals: totemConfig.decimals,
                ticker,
                name: totemConfig.name,
                description: totemConfig.description,
                image: totemConfig.image,
                website: totemConfig.website,
            };

            // Build allocations with resolved addresses
            const allocations = totemConfig.allocations.map(alloc => ({
                recipient: resolveAddress(alloc.recipient),
                isMinter: alloc.isMinter,
                amount: alloc.amount,
                label: alloc.label,
            }));

            // Build mods with resolved addresses
            const mods = {
                transfer: totemConfig.mods.transfer.map(resolveAddress),
                mint: totemConfig.mods.mint.map(resolveAddress),
                burn: totemConfig.mods.burn.map(resolveAddress),
                created: totemConfig.mods.created.map(resolveAddress),
                transferOwnership: totemConfig.mods.transferOwnership.map(resolveAddress),
            };

            // Create totem
            const createHash = await walletClient.writeContract({
                address: totemsAddress as `0x${string}`,
                abi: ITotems.abi,
                functionName: 'create',
                args: [details, allocations, mods, ZERO_ADDRESS],
                value: totalFee,
            });

            await publicClient.waitForTransactionReceipt({ hash: createHash });

            // Track totem in addresses
            if (!addresses.totems) addresses.totems = [];
            if (!addresses.totems.includes(ticker)) {
                addresses.totems.push(ticker);
                saveDeployment(network, addresses);
            }

            console.log(' ✓');
        }
    }

    // Summary
    console.log('\nAddresses:');
    for (const [name, value] of Object.entries(addresses)) {
        if (typeof value === 'string') console.log(`  ${name}: ${value}`);
    }
    console.log('');

    // Verify contracts if requested
    if (verify) {
        const contractsToVerify: VerifyRequest[] = [
            {
                contractAddress: marketAddress,
                contractPath: 'market/ModMarket.sol',
                contractName: 'ModMarket',
                constructorArgs: [networkConfig.minBaseFee, networkConfig.burnedFee],
            },
            {
                contractAddress: proxyModAddress,
                contractPath: 'mods/ProxyMod.sol',
                contractName: 'ProxyMod',
                constructorArgs: [networkConfig.deployer],
            },
            {
                contractAddress: totemsAddress,
                contractPath: 'totems/Totems.sol',
                contractName: 'Totems',
                constructorArgs: [
                    marketAddress,
                    proxyModAddress,
                    networkConfig.minBaseFee,
                    networkConfig.burnedFee,
                ],
            },
        ];

        // Add mods
        for (const modName of networkConfig.mods) {
            const modAddress = addresses[modName];
            if (modAddress) {
                contractsToVerify.push({
                    contractAddress: modAddress,
                    contractPath: `mods/${modName}.sol`,
                    contractName: modName,
                    constructorArgs: [totemsAddress, networkConfig.deployer],
                });
            }
        }

        await verifyContracts(network, contractsToVerify);
    }

    return addresses;
}

// Main
async function main() {
    const args = process.argv.slice(2);
    const verify = args.includes('--verify');
    const force = args.includes('--force');
    const network = args.find(a => !a.startsWith('--'));

    if (!network) {
        console.error('Usage: bun scripts/deploy.ts <network> [--verify] [--force]');
        console.error('Networks: hardhat, sepolia, ethereum, base');
        process.exit(1);
    }

    const isHardhat = network === 'hardhat' || network === 'hardhatMainnet';

    try {
        if (isHardhat) {
            await startHardhatNode();
        }

        await deploy(network, verify, force);
    } finally {
        if (isHardhat) {
            stopHardhatNode();
        }
    }
}

main().catch((err) => {
    stopHardhatNode();
    console.error('Deployment failed:', err);
    process.exit(1);
});
