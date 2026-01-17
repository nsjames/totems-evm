import {network} from "hardhat";
import { keccak256, toBytes, decodeErrorResult, Abi, getContract } from "viem";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Detect if we're running from the package or the main project
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageArtifactsDir = join(__dirname, '..', 'artifacts');
const isPackage = existsSync(join(packageArtifactsDir, 'ProxyMod.json'));

function loadArtifact(name: string) {
    if (isPackage) {
        // Load from package artifacts
        const path = join(packageArtifactsDir, `${name}.json`);
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    // Load from main project's hardhat artifacts
    const paths: Record<string, string> = {
        'ProxyMod': 'artifacts/contracts/mods/ProxyMod.sol/ProxyMod.json',
        'ModMarket': 'artifacts/contracts/market/ModMarket.sol/ModMarket.json',
        'Totems': 'artifacts/contracts/totems/Totems.sol/Totems.json',
        'ITotems': 'artifacts/contracts/interfaces/ITotems.sol/ITotems.json',
        'IMarket': 'artifacts/contracts/interfaces/IMarket.sol/IMarket.json',
    };
    const path = join(__dirname, '..', paths[name]);
    return JSON.parse(readFileSync(path, 'utf-8'));
}

const ProxyModArtifact = loadArtifact('ProxyMod');
const ModMarketArtifact = loadArtifact('ModMarket');
const TotemsArtifact = loadArtifact('Totems');
const ITotemsArtifact = loadArtifact('ITotems');
const IMarketArtifact = loadArtifact('IMarket');

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Computes the 4-byte selector for a custom error signature
 * @param signature Error signature like "NotLicensed()" or "InsufficientBalance(uint256,uint256)"
 */
export function errorSelector(signature: string): string {
    return keccak256(toBytes(signature)).slice(0, 10); // 0x + 8 hex chars = 4 bytes
}

/**
 * Extracts the error selector from a caught error's revert data
 */
function getErrorData(error: any): string | null {
    // Try common paths where revert data might be
    const data = error?.cause?.cause?.data
        || error?.cause?.data
        || error?.data
        || error?.message?.match(/return data: (0x[a-fA-F0-9]+)/)?.[1]
        || error?.message?.match(/data: (0x[a-fA-F0-9]+)/)?.[1];
    return data || null;
}

/**
 * Asserts that a promise rejects with a specific custom error
 * @param promise The promise to test
 * @param expectedSelector The expected error selector (use errorSelector() to compute)
 * @param errorName Human-readable error name for assertion messages
 */
export async function expectCustomError(
    promise: Promise<any>,
    expectedSelector: string,
    errorName: string
): Promise<void> {
    try {
        await promise;
        throw new Error(`Expected ${errorName} but transaction succeeded`);
    } catch (e: any) {
        if (e.message?.startsWith(`Expected ${errorName}`)) throw e;

        const data = getErrorData(e);
        if (!data) {
            throw new Error(`Expected ${errorName} but got error without revert data: ${e.message}`);
        }

        const actualSelector = data.slice(0, 10).toLowerCase();
        const expected = expectedSelector.toLowerCase();

        if (actualSelector !== expected) {
            throw new Error(
                `Expected ${errorName} (${expected}) but got selector ${actualSelector}\nFull data: ${data}`
            );
        }
    }
}

/**
 * Asserts that a promise rejects with a string revert message
 * Error(string) selector is 0x08c379a0
 */
export async function expectRevertMessage(
    promise: Promise<any>,
    expectedMessage: string | RegExp
): Promise<void> {
    const ERROR_STRING_SELECTOR = "0x08c379a0";

    try {
        await promise;
        throw new Error(`Expected revert with "${expectedMessage}" but transaction succeeded`);
    } catch (e: any) {
        if (e.message?.startsWith("Expected revert")) throw e;

        const data = getErrorData(e);
        if (!data) {
            // Fallback to checking error message directly
            const matches = typeof expectedMessage === 'string'
                ? e.message?.includes(expectedMessage)
                : expectedMessage.test(e.message);
            if (!matches) {
                throw new Error(`Expected revert with "${expectedMessage}" but got: ${e.message}`);
            }
            return;
        }

        const selector = data.slice(0, 10).toLowerCase();
        if (selector !== ERROR_STRING_SELECTOR) {
            // Not a string error, check if message is in the raw error
            const matches = typeof expectedMessage === 'string'
                ? e.message?.includes(expectedMessage)
                : expectedMessage.test(e.message);
            if (!matches) {
                throw new Error(`Expected string revert but got custom error with selector ${selector}`);
            }
            return;
        }

        // Decode the string from the ABI-encoded data
        // Format: selector (4 bytes) + offset (32 bytes) + length (32 bytes) + string data
        try {
            const abi: Abi = [{
                type: 'error',
                name: 'Error',
                inputs: [{ name: 'message', type: 'string' }]
            }];
            const decoded = decodeErrorResult({ abi, data: data as `0x${string}` });
            const message = (decoded.args as string[])[0];

            const matches = typeof expectedMessage === 'string'
                ? message.includes(expectedMessage)
                : expectedMessage.test(message);

            if (!matches) {
                throw new Error(`Expected revert with "${expectedMessage}" but got "${message}"`);
            }
        } catch (decodeError) {
            // If decoding fails, fall back to checking error message
            const matches = typeof expectedMessage === 'string'
                ? e.message?.includes(expectedMessage)
                : expectedMessage.test(e.message);
            if (!matches) {
                throw new Error(`Expected revert with "${expectedMessage}" but decoding failed: ${e.message}`);
            }
        }
    }
}

// Pre-computed selectors for common errors
export const ErrorSelectors = {
    // TotemMod errors
    InvalidModEventOrigin: errorSelector("InvalidModEventOrigin()"),
    NotLicensed: errorSelector("NotLicensed()"),

    // Totems errors
    Unauthorized: errorSelector("Unauthorized()"),
    TotemNotFound: errorSelector("TotemNotFound(string)"),
    TotemNotActive: errorSelector("TotemNotActive()"),
    InsufficientBalance: errorSelector("InsufficientBalance(uint256,uint256)"),
    CantSetLicense: errorSelector("CantSetLicense()"),
};

export const MIN_BASE_FEE = 500000000000000n; // 0.0005 ether
export const BURNED_FEE = 100000000000000n; // 0.0001 ether

export const Hook = {
    Created: 0,
    Mint: 1,
    Burn: 2,
    Transfer: 3,
    TransferOwnership: 4,
} as const;

export enum ModActionFieldInputMode {
    DYNAMIC = 0,
    STATIC = 1,
    TOTEM = 2,
}

export interface ModActionField {
    name: string
    mode: ModActionFieldInputMode
    value: string
    description: string
    min: bigint
    max: bigint
    isTotems: boolean
}

export interface ModRequiredAction {
    signature: string
    inputFields: ModActionField[]
    cost: bigint
    reason: string
}

export const setupTotemsTest = async (minBaseFee: bigint = MIN_BASE_FEE, burnedFee: bigint = BURNED_FEE) => {
    const { viem } = await network.connect() as any;
    const publicClient = await viem.getPublicClient();
    const walletClient = await viem.getWalletClient();

    const addresses = await walletClient.getAddresses();
    const proxyModInitializer = addresses[0];

    // Deploy using pre-built artifacts from the package
    const proxyModHash = await walletClient.deployContract({
        abi: ProxyModArtifact.abi,
        bytecode: ProxyModArtifact.bytecode,
        args: [proxyModInitializer],
        account: proxyModInitializer,
    });
    const proxyModReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyModHash });
    const proxyMod = getContract({
        address: proxyModReceipt.contractAddress!,
        abi: ProxyModArtifact.abi,
        client: { public: publicClient, wallet: walletClient },
    }) as any;

    const marketHash = await walletClient.deployContract({
        abi: ModMarketArtifact.abi,
        bytecode: ModMarketArtifact.bytecode,
        args: [minBaseFee, burnedFee],
        account: proxyModInitializer,
    });
    const marketReceipt = await publicClient.waitForTransactionReceipt({ hash: marketHash });

    const totemsHash = await walletClient.deployContract({
        abi: TotemsArtifact.abi,
        bytecode: TotemsArtifact.bytecode,
        args: [marketReceipt.contractAddress!, proxyModReceipt.contractAddress!, minBaseFee, burnedFee],
        account: proxyModInitializer,
    });
    const totemsReceipt = await publicClient.waitForTransactionReceipt({ hash: totemsHash });

    // Use interface ABIs for the contract instances
    const totems = getContract({
        address: totemsReceipt.contractAddress!,
        abi: ITotemsArtifact.abi,
        client: { public: publicClient, wallet: walletClient },
    });

    const market = getContract({
        address: marketReceipt.contractAddress!,
        abi: IMarketArtifact.abi,
        client: { public: publicClient, wallet: walletClient },
    });

    // Initialize proxy mod
    await proxyMod.write.initialize([totemsReceipt.contractAddress!, marketReceipt.contractAddress!], { account: proxyModInitializer });

    return {
        viem,
        publicClient,
        market,
        totems,
        accounts: addresses.slice(0, addresses.length),
        proxyModSeller: addresses[0],
        proxyMod,
    }

}


export const modDetails = (details?:any) => Object.assign({
    name: "Test Mod",
    summary: "A test mod",
    markdown: "## Test Mod\nThis is a test mod.",
    image: "https://example.com/image.png",
    website: "https://example.com",
    websiteTickerPath: "/path/to/{ticker}",
    isMinter: false,
    needsUnlimited: false,
}, details || {});

export const publishMod = async (
    market:any,
    seller:string,
    contract:string,
    hooks:number[] = [],
    details = modDetails(),
    requiredActions:any[] = [],
    referrer = ZERO_ADDRESS,
    price = 1_000_000n,
    fee = undefined
) => {
    fee = fee ?? await market.read.getFee([referrer]);

    return market.write.publish([
        contract,
        hooks,
        price,
        details,
        requiredActions,
        referrer,
    ], { value: fee, account: seller });
}

export const totemDetails = (ticker:string, decimals:number) => {
    return {
        ticker: ticker,
        decimals: decimals,
        name: `${ticker} Totem`,
        description: `This is the ${ticker} totem.`,
        image: `https://example.com/${ticker.toLowerCase()}.png`,
        website: `https://example.com/${ticker.toLowerCase()}`,
        seed: '0x1110762033e7a10db4502359a19a61eb81312834769b8419047a2c9ae03ee847',
    };
}

export const createTotem = async (
    totems:any,
    market:any,
    creator:string,
    ticker:string,
    decimals:number,
    allocations:any[],
    mods?:{
        transfer?:string[],
        mint?:string[],
        burn?:string[],
        created?:string[],
        transferOwnership?:string[]
    },
    referrer:string = ZERO_ADDRESS,
    details:any = undefined,
) => {
    const baseFee = await totems.read.getFee([referrer]);

    const _mods = Object.assign({
        transfer: [],
        mint: [],
        burn: [],
        created: [],
        transferOwnership: [],
    }, mods || {});
    const uniqueMods = new Set<string>();
    Object.values(_mods).forEach((modList:any[]) => {
        modList.forEach(m => uniqueMods.add(m));
    });

    const modsFee = await market.read.getModsFee([[...uniqueMods]]);
    return await totems.write.create([
        details ? Object.assign({
            ticker,
            decimals,
        }, details) : totemDetails(ticker, decimals),
        allocations.map(a => ({
            ...a,
            label: a.label || "",
            isMinter: a.hasOwnProperty('isMinter') ? a.isMinter : false,
        })),
        _mods,
        referrer,
    ], { account: creator, value: baseFee + modsFee });
}

export const transfer = async (
    totems:any,
    ticker:string,
    from:string,
    to:string,
    amount:number|bigint,
    memo:string = "",
) => {
    return await totems.write.transfer([
        ticker,
        from,
        to,
        amount,
        memo,
    ], { account: from });
}

export const mint = async (
    totems:any,
    mod:string,
    minter:string,
    ticker:string,
    amount:number|bigint,
    memo:string = "",
    payment:number|bigint = 0n,
) => {
    return await totems.write.mint([
        mod,
        minter,
        ticker,
        amount,
        memo,
    ], { account: minter, value: payment });
}

export const burn = async (
    totems:any,
    ticker:string,
    owner:string,
    amount:number|bigint,
    memo:string = "",
) => {
    return await totems.write.burn([
        ticker,
        owner,
        amount,
        memo,
    ], { account: owner });
}

export const getBalance = async (
    totems:any,
    ticker:string,
    account:string,
) => {
    return await totems.read.getBalance([ticker, account]);
}

export const getTotem = async (
    totems:any,
    ticker:string,
) => {
    return await totems.read.getTotem([ticker]);
}

export const getTotems = async (
    totems:any,
    tickers:string[],
) => {
    return await totems.read.getTotems([tickers]);
}

export const getStats = async (
    totems:any,
    ticker:string,
) => {
    return await totems.read.getStats([ticker]);
}

export const transferOwnership = async (
    totems:any,
    ticker:string,
    currentOwner:string,
    newOwner:string,
) => {
    return await totems.write.transferOwnership([
        ticker,
        newOwner,
    ], { account: currentOwner });
}

export const getMod = async (
    market:any,
    mod:string,
) => {
    return await market.read.getMod([mod]);
}

export const getMods = async (
    market:any,
    mods:string[],
) => {
    return await market.read.getMods([mods]);
}

export const getModFee = async (
    market:any,
    mod:string,
) => {
    return await market.read.getModFee([mod]);
}

export const getModsFee = async (
    market:any,
    mods:string[],
) => {
    return await market.read.getModsFee([mods]);
}

export const isLicensed = async (
    totems:any,
    ticker:string,
    mod:string,
) => {
    return await totems.read.isLicensed([ticker, mod]);
}

export const getRelays = async (
    totems:any,
    ticker:string,
) => {
    return await totems.read.getRelays([ticker]);
}

export const getSupportedHooks = async (
    market:any,
    mod:string,
) => {
    return await market.read.getSupportedHooks([mod]);
}

export const isUnlimitedMinter = async (
    market:any,
    mod:string,
) => {
    return await market.read.isUnlimitedMinter([mod]);
}

export const addMod = async (
    proxyMod:any,
    totems:any,
    market:any,
    ticker:string,
    hooks:number[],
    mod:string,
    caller:string,
    referrer:string = ZERO_ADDRESS,
) => {
    const modFee = await market.read.getModFee([mod]);
    const referrerFee = await totems.read.getFee([referrer]);
    return await proxyMod.write.addMod([
        ticker,
        hooks,
        mod,
        referrer,
    ], { account: caller, value: modFee + referrerFee });
}

export const removeMod = async (
    proxyMod:any,
    ticker:string,
    mod:string,
    caller:string,
) => {
    return await proxyMod.write.removeMod([
        ticker,
        mod,
    ], { account: caller });
}