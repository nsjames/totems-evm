import { parseEther, type Chain } from 'viem';
import { hardhat, sepolia, mainnet, base, baseSepolia } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

// ==================== CHAIN CONFIG ====================

export function getChain(network: string): Chain {
    switch (network) {
        case 'hardhat':
        case 'hardhatMainnet':
            return hardhat;
        case 'sepolia':
            return sepolia;
        case 'ethereum':
        case 'mainnet':
            return mainnet;
        case 'base':
            return base;
        case 'base-sepolia':
        case 'baseSepolia':
            return baseSepolia;
        default:
            throw new Error(`Unknown network: ${network}. Valid: hardhat, sepolia, ethereum, base, base-sepolia`);
    }
}

export function getRpcUrl(network: string): string {
    const config = getConfig(network);
    if (config.rpcUrl) {
        return config.rpcUrl;
    }
    if (config.rpcEnvVar) {
        const url = process.env[config.rpcEnvVar]?.trim();
        if (!url) {
            throw new Error(`${config.rpcEnvVar} not set in environment`);
        }
        return url;
    }
    throw new Error(`No rpcUrl or rpcEnvVar specified in config for ${network}`);
}

export function getPrivateKeyEnvVar(network: string): string {
    // Convention: NETWORK_PRIVATE_KEY (hyphens/spaces become underscores)
    const normalized = network === 'hardhatMainnet' ? 'hardhat'
        : network === 'mainnet' ? 'ethereum'
        : network;
    return `${normalized.toUpperCase().replace(/[-\s]/g, '_')}_PRIVATE_KEY`;
}

export function getWsRpcUrl(network: string): string | undefined {
    const config = getConfig(network);
    if (config.wsRpcUrl) {
        return config.wsRpcUrl;
    }
    if (config.wsRpcEnvVar) {
        const url = process.env[config.wsRpcEnvVar]?.trim();
        return url || undefined;
    }
    return undefined;
}

export type ModName = string;

export interface ReferrerConfig {
    address: `0x${string}`;
    fee: bigint;
}

export interface PublishEntry {
    name: string;
    price?: bigint;
}

export interface TotemEntry {
    ticker: string;
    config: string;
}

export interface SimulationConfig {
    mintAmount: number;  // Whole tokens (multiplied by totem decimals at runtime)
    minEthBalance: bigint;
    fundingAmount: bigint;
    maxSpend: bigint;    // Max total ETH to spend (0 = unlimited)
    staggerMs: number;
    randomDelayMs: number;
    weights: {
        mint: number;
        transfer: number;
        burn: number;
    };
}

export interface NetworkConfig {
    deployer: `0x${string}`;
    rpcUrl?: string;
    rpcEnvVar?: string;
    wsRpcUrl?: string;
    wsRpcEnvVar?: string;
    explorerUrl?: string;
    explorerApiKeyEnvVar?: string;
    minBaseFee: bigint;
    burnedFee: bigint;
    mods: ModName[];
    publish: PublishEntry[];
    totems: TotemEntry[];
    referrers: ReferrerConfig[];
    simulation?: SimulationConfig;
}

interface RawReferrer {
    address: string;
    fee: string;
}

interface RawPublishEntry {
    name: string;
    price?: string;
}

interface RawTotemEntry {
    ticker?: string;
    tickers?: string | string[]; // Comma-separated string from YAML or array
    config: string;
}

interface RawSimulationEntry {
    mintAmount?: number | string;  // Whole tokens (number preferred, string for backwards compat)
    minEthBalance?: string;
    fundingAmount?: string;
    maxSpend?: string;
    staggerMs?: number;
    randomDelayMs?: number;
    weightMint?: number;
    weightTransfer?: number;
    weightBurn?: number;
}

interface RawConfig {
    deployer: string;
    rpcUrl?: string;
    rpcEnvVar?: string;
    wsRpcUrl?: string;
    wsRpcEnvVar?: string;
    explorerUrl?: string;
    explorerApiKeyEnvVar?: string;
    minBaseFee: string;
    burnedFee: string;
    mods: string[];
    publish: (string | RawPublishEntry)[];
    totems: (string | RawTotemEntry)[];
    referrers: RawReferrer[];
    simulation?: RawSimulationEntry[];
}

function parseValue(value: string): bigint {
    value = value.trim();
    if (value.endsWith(' ether')) {
        return parseEther(value.replace(' ether', ''));
    }
    if (value.endsWith(' gwei')) {
        return parseEther(value.replace(' gwei', '')) / 1_000_000_000n;
    }
    // Assume wei if no unit
    return BigInt(value);
}

function parseYaml(content: string): RawConfig {
    return yaml.load(content) as RawConfig;
}

function loadConfig(network: string): NetworkConfig {
    const configPath = path.join(import.meta.dirname, `${network}.yaml`);

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const raw = parseYaml(content);

    return {
        deployer: raw.deployer as `0x${string}`,
        rpcUrl: raw.rpcUrl,
        rpcEnvVar: raw.rpcEnvVar,
        wsRpcUrl: raw.wsRpcUrl,
        wsRpcEnvVar: raw.wsRpcEnvVar,
        explorerUrl: raw.explorerUrl,
        explorerApiKeyEnvVar: raw.explorerApiKeyEnvVar,
        minBaseFee: parseValue(raw.minBaseFee),
        burnedFee: parseValue(raw.burnedFee),
        mods: raw.mods as ModName[],
        publish: (raw.publish || []).map((entry: string | RawPublishEntry): PublishEntry => {
            if (typeof entry === 'string') {
                return { name: entry };
            }
            return {
                name: entry.name,
                price: entry.price ? parseValue(entry.price) : undefined,
            };
        }),
        totems: (raw.totems || []).flatMap((entry: string | RawTotemEntry): TotemEntry[] => {
            if (typeof entry === 'string') {
                // Simple string: ticker and config name are the same
                return [{ ticker: entry, config: entry }];
            }
            // Support tickers as comma-separated string or array
            if (entry.tickers) {
                const tickerList = typeof entry.tickers === 'string'
                    ? (entry.tickers as string).split(',').map(t => t.trim()).filter(Boolean)
                    : entry.tickers;
                return tickerList.map(t => ({ ticker: t, config: entry.config }));
            }
            if (entry.ticker) {
                return [{ ticker: entry.ticker, config: entry.config }];
            }
            return [];
        }),
        referrers: (raw.referrers || []).map((r: RawReferrer) => ({
            address: r.address as `0x${string}`,
            fee: parseValue(r.fee),
        })),
        simulation: raw.simulation ? (() => {
            // Merge array entries into single object
            const merged: RawSimulationEntry = {};
            for (const entry of raw.simulation) {
                Object.assign(merged, entry);
            }
            // Parse mintAmount as whole tokens (number)
            let mintAmount = 100;
            if (merged.mintAmount !== undefined) {
                mintAmount = typeof merged.mintAmount === 'number'
                    ? merged.mintAmount
                    : parseInt(merged.mintAmount, 10);
            }
            return {
                mintAmount,
                minEthBalance: merged.minEthBalance ? parseValue(merged.minEthBalance) : parseEther('0.001'),
                fundingAmount: merged.fundingAmount ? parseValue(merged.fundingAmount) : parseEther('0.005'),
                maxSpend: merged.maxSpend ? parseValue(merged.maxSpend) : 0n,
                staggerMs: merged.staggerMs ?? 1500,
                randomDelayMs: merged.randomDelayMs ?? 2000,
                weights: {
                    mint: merged.weightMint ?? 45,
                    transfer: merged.weightTransfer ?? 45,
                    burn: merged.weightBurn ?? 10,
                },
            };
        })() : undefined,
    };
}

// Default simulation config
const DEFAULT_SIMULATION: SimulationConfig = {
    mintAmount: 100,  // Whole tokens (multiplied by totem decimals at runtime)
    minEthBalance: parseEther('0.001'),
    fundingAmount: parseEther('0.005'),
    maxSpend: 0n,     // 0 = unlimited
    staggerMs: 1500,
    randomDelayMs: 2000,
    weights: { mint: 45, transfer: 45, burn: 10 },
};

export function getSimulationConfig(network: string): SimulationConfig {
    const config = getConfig(network);
    return config.simulation ?? DEFAULT_SIMULATION;
}

export function getConfig(network: string): NetworkConfig {
    // Normalize network name
    const normalizedNetwork = network === 'hardhatMainnet' ? 'hardhat'
        : network === 'mainnet' ? 'ethereum'
        : network;

    return loadConfig(normalizedNetwork);
}

// List available configs
export function listConfigs(): string[] {
    const configDir = import.meta.dirname;
    return fs.readdirSync(configDir)
        .filter(f => f.endsWith('.yaml'))
        .map(f => f.replace('.yaml', ''));
}

// ==================== PUBLISH CONFIG ====================

export enum Hook {
    Created = 0,
    Mint = 1,
    Burn = 2,
    Transfer = 3,
    TransferOwnership = 4,
}

export enum ModActionFieldInputMode {
    DYNAMIC = 0,
    STATIC = 1,
    TOTEM = 2,
}

export interface ModActionField {
    name: string;
    mode: ModActionFieldInputMode;
    value: string;
    description: string;
    min: string; // Will be converted to bigint
    max: string; // Will be converted to bigint
    isTotems: boolean;
}

export interface ModRequiredAction {
    signature: string;
    inputFields: ModActionField[];
    cost: string; // Will be converted to bigint
    reason: string;
}

export interface ModDetails {
    name: string;
    summary: string;
    markdown: string;
    image: string;
    website: string;
    websiteTickerPath: string;
    isMinter: boolean;
    needsUnlimited: boolean;
}

export interface PublishConfig {
    hooks: Hook[];
    price: string; // Will be converted to bigint
    details: ModDetails;
    requiredActions: ModRequiredAction[];
}

export interface ParsedPublishConfig {
    hooks: Hook[];
    price: bigint;
    details: ModDetails;
    requiredActions: {
        signature: string;
        inputFields: {
            name: string;
            mode: ModActionFieldInputMode;
            value: string;
            description: string;
            min: bigint;
            max: bigint;
            isTotems: boolean;
        }[];
        cost: bigint;
        reason: string;
    }[];
}

export function getPublishConfig(modName: string): ParsedPublishConfig {
    const publishDir = path.join(import.meta.dirname, '..', 'publish');
    const configPath = path.join(publishDir, `${modName}.json`);

    if (!fs.existsSync(configPath)) {
        throw new Error(`Publish config not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const raw: PublishConfig = JSON.parse(content);

    return {
        hooks: raw.hooks,
        price: parseValue(raw.price),
        details: raw.details,
        requiredActions: (raw.requiredActions || []).map(action => ({
            signature: action.signature,
            inputFields: action.inputFields.map(field => ({
                name: field.name,
                mode: field.mode,
                value: field.value,
                description: field.description,
                min: parseValue(field.min || '0'),
                max: parseValue(field.max || '0'),
                isTotems: field.isTotems ?? false,
            })),
            cost: parseValue(action.cost || '0'),
            reason: action.reason,
        })),
    };
}

// ==================== TOTEM CONFIG ====================

export interface TotemAllocation {
    recipient: string; // Address, "deployer", or contract name like "MinterMod"
    isMinter: boolean;
    amount: string; // Will be converted to bigint
    label: string;
}

export interface TotemModsConfig {
    transfer: string[]; // Addresses or contract names
    mint: string[];
    burn: string[];
    created: string[];
    transferOwnership: string[];
}

export interface TotemConfig {
    decimals: number;
    name: string;
    description: string;
    image: string;
    website: string;
    allocations: TotemAllocation[];
    mods: TotemModsConfig;
}

export interface ParsedTotemConfig {
    decimals: number;
    name: string;
    description: string;
    image: string;
    website: string;
    allocations: {
        recipient: string;
        isMinter: boolean;
        amount: bigint;
        label: string;
    }[];
    mods: TotemModsConfig;
}

export function getTotemConfig(configName: string): ParsedTotemConfig {
    const totemsDir = path.join(import.meta.dirname, '..', 'totems');
    const configPath = path.join(totemsDir, `${configName}.json`);

    if (!fs.existsSync(configPath)) {
        throw new Error(`Totem config not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const raw: TotemConfig = JSON.parse(content);

    return {
        decimals: raw.decimals,
        name: raw.name,
        description: raw.description,
        image: raw.image,
        website: raw.website,
        allocations: (raw.allocations || []).map(alloc => ({
            recipient: alloc.recipient,
            isMinter: alloc.isMinter ?? false,
            amount: parseValue(alloc.amount),
            label: alloc.label || '',
        })),
        mods: {
            transfer: raw.mods?.transfer || [],
            mint: raw.mods?.mint || [],
            burn: raw.mods?.burn || [],
            created: raw.mods?.created || [],
            transferOwnership: raw.mods?.transferOwnership || [],
        },
    };
}
