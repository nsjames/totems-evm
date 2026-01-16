import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script to generate Solidity interfaces from contract ABIs with NatSpec comments
 * Run with: bun scripts/generate-interfaces.ts
 */
interface AbiInput {
    name: string;
    type: string;
    internalType?: string;
    components?: AbiInput[];
    indexed?: boolean;
}

interface AbiItem {
    type: string;
    name?: string;
    inputs?: AbiInput[];
    outputs?: AbiInput[];
    stateMutability?: string;
    anonymous?: boolean;
}

interface NatSpecDocs {
    notice?: string;
    dev?: string;
    params?: Record<string, string>;
    returns?: Record<string, string>;
}

interface ContractDocs {
    userdoc: {
        methods: Record<string, { notice?: string }>;
        notice?: string;
    };
    devdoc: {
        methods: Record<string, { params?: Record<string, string>; returns?: Record<string, string>; details?: string }>;
        title?: string;
        details?: string;
    };
}

/**
 * Build a function signature string from ABI inputs for matching against devdoc/userdoc keys
 */
function buildSignature(name: string, inputs: AbiInput[] | undefined): string {
    if (!inputs || inputs.length === 0) return `${name}()`;

    const types = inputs.map(input => buildTypeSignature(input)).join(',');
    return `${name}(${types})`;
}

/**
 * Recursively build type signature for tuple types
 */
function buildTypeSignature(input: AbiInput): string {
    if (input.type.startsWith('tuple')) {
        const components = input.components || [];
        const inner = components.map(c => buildTypeSignature(c)).join(',');
        const suffix = input.type.replace('tuple', ''); // Gets [] if array
        return `(${inner})${suffix}`;
    }
    return input.type;
}

function formatType(input: AbiInput): string {
    if (input.internalType) {
        let type = input.internalType;

        // Remove 'struct ' or 'enum ' prefix if present
        type = type.replace(/^(struct|enum)\s+/, '');

        // Preserve ITotemTypes. prefix (the compiler already identifies these)
        // For other contract prefixes (like ModMarket.SomeType), strip the contract name
        if (!type.startsWith('ITotemTypes.')) {
            if (type.includes('.')) {
                type = type.split('.').pop()!;
            }
        }

        return type;
    }
    return input.type;
}

function formatInputs(inputs: AbiInput[] | undefined, includeNames: boolean = true, skipDataLocation: boolean = false): string {
    if (!inputs || inputs.length === 0) return '';

    return inputs.map(input => {
        let type = formatType(input);

        // Add memory/calldata for complex types (skip for error parameters)
        if (!skipDataLocation && (type.includes('[]') || type.includes('struct') || type === 'string' || type === 'bytes' ||
            type.startsWith('ITotemTypes.'))) {
            type += ' calldata';
        }

        if (includeNames && input.name) {
            return `${type} ${input.name}`;
        }
        return type;
    }).join(', ');
}

function formatOutputs(outputs: AbiInput[] | undefined): string {
    if (!outputs || outputs.length === 0) return '';

    return outputs.map(output => {
        let type = formatType(output);

        // Add memory for complex return types
        if (type.includes('[]') || type.includes('struct') || type === 'string' || type === 'bytes' ||
            type.startsWith('ITotemTypes.')) {
            type += ' memory';
        }

        if (output.name) {
            return `${type} ${output.name}`;
        }
        return type;
    }).join(', ');
}

/**
 * Generate NatSpec comment block for a function
 */
function generateNatSpec(docs: NatSpecDocs, inputs: AbiInput[] | undefined, outputs: AbiInput[] | undefined): string[] {
    const lines: string[] = [];

    if (!docs.notice && !docs.dev && !docs.params && !docs.returns) {
        return lines;
    }

    lines.push('    /**');

    if (docs.notice) {
        lines.push(`     * @notice ${docs.notice}`);
    }

    if (docs.dev) {
        lines.push(`     * @dev ${docs.dev}`);
    }

    // Add @param for each input that has documentation
    if (docs.params && inputs) {
        for (const input of inputs) {
            if (docs.params[input.name]) {
                lines.push(`     * @param ${input.name} ${docs.params[input.name]}`);
            }
        }
    }

    // Add @return for outputs
    if (docs.returns && outputs) {
        for (const output of outputs) {
            const returnDoc = docs.returns[output.name] || docs.returns[`_${outputs.indexOf(output)}`] || docs.returns['_0'];
            if (returnDoc && outputs.length === 1 && !output.name) {
                lines.push(`     * @return ${returnDoc}`);
            } else if (returnDoc && output.name) {
                lines.push(`     * @return ${output.name} ${returnDoc}`);
            }
        }
    }

    lines.push('     */');
    return lines;
}

/**
 * Get documentation for a function from devdoc/userdoc
 */
function getFunctionDocs(func: AbiItem, contractDocs: ContractDocs): NatSpecDocs {
    const signature = buildSignature(func.name!, func.inputs);
    const docs: NatSpecDocs = {};

    // Get notice from userdoc
    const userMethod = contractDocs.userdoc?.methods?.[signature];
    if (userMethod?.notice) {
        docs.notice = userMethod.notice;
    }

    // Get params and returns from devdoc
    const devMethod = contractDocs.devdoc?.methods?.[signature];
    if (devMethod) {
        if (devMethod.details) {
            docs.dev = devMethod.details;
        }
        if (devMethod.params) {
            docs.params = devMethod.params;
        }
        if (devMethod.returns) {
            docs.returns = devMethod.returns;
        }
    }

    return docs;
}

interface ConstructorInfo {
    inputs: AbiInput[];
    docs?: {
        notice?: string;
        dev?: string;
        params?: Record<string, string>;
    };
}

function generateInterface(
    contractName: string,
    interfaceName: string,
    abi: AbiItem[],
    imports: string[] = [],
    contractDocs?: ContractDocs,
    constructor?: ConstructorInfo
): string {
    // Interfaces are always MIT to not impose license complexity on consumers
    const lines: string[] = [
        '// SPDX-License-Identifier: MIT',
        '// AUTO-GENERATED - DO NOT EDIT',
        `// Generated from ${contractName}`,
        'pragma solidity ^0.8.28;',
        ''
    ];

    // Add imports
    for (const imp of imports) {
        lines.push(`import "${imp}";`);
    }
    if (imports.length > 0) lines.push('');

    lines.push(`interface ${interfaceName} {`);

    // Group by type
    const functions: AbiItem[] = [];
    const events: AbiItem[] = [];
    const errors: AbiItem[] = [];

    for (const item of abi) {
        if (item.type === 'function') {
            functions.push(item);
        } else if (item.type === 'event') {
            events.push(item);
        } else if (item.type === 'error') {
            errors.push(item);
        }
    }

    // Sort functions by logical groups, then state-changing before view/pure within each group
    functions.sort((a, b) => {
        // Explicit list of storage accessor names (auto-generated getters for public state variables)
        const storageAccessors = ['totemList', 'marketContract', 'proxyMod', 'minBaseFee', 'burnedFee'];

        const getGroup = (name: string): number => {
            // Totem creation
            if (name === 'create') return 0;
            // Token operations
            if (['mint', 'burn', 'transfer', 'transferOwnership'].includes(name)) return 1;
            // Relay management
            if (['addRelay', 'createRelay', 'removeRelay', 'getRelays', 'getRelayOfStandard'].includes(name)) return 2;
            // License management
            if (['setLicenseFromProxy', 'isLicensed'].includes(name)) return 3;
            // Fee management
            if (['setReferrerFee', 'getFee'].includes(name)) return 4;
            // Totem queries
            if (['getTotem', 'getTotems', 'listTotems'].includes(name)) return 5;
            // Balance/stats queries
            if (['getBalance', 'getStats'].includes(name)) return 6;
            // Utility functions
            if (['tickerToBytes', 'getProxyMod'].includes(name)) return 7;
            // Storage accessors go last
            if (storageAccessors.includes(name)) return 10;
            // Anything else not explicitly listed
            return 9;
        };

        const mutabilityOrder = (item: AbiItem) => {
            if (item.stateMutability === 'pure') return 2;
            if (item.stateMutability === 'view') return 1;
            return 0; // payable, nonpayable (state-changing)
        };

        const groupA = getGroup(a.name || '');
        const groupB = getGroup(b.name || '');
        if (groupA !== groupB) return groupA - groupB;

        const mutA = mutabilityOrder(a);
        const mutB = mutabilityOrder(b);
        if (mutA !== mutB) return mutA - mutB;

        return (a.name || '').localeCompare(b.name || '');
    });

    // Functions
    if (functions.length > 0) {
        lines.push('    // ==================== FUNCTIONS ====================');
        lines.push('');

        for (const func of functions) {
            // Add NatSpec comments if available
            if (contractDocs) {
                const docs = getFunctionDocs(func, contractDocs);
                const natspecLines = generateNatSpec(docs, func.inputs, func.outputs);
                lines.push(...natspecLines);
            }

            const inputs = formatInputs(func.inputs);
            const outputs = formatOutputs(func.outputs);

            let signature = `    function ${func.name}(${inputs}) external`;

            if (func.stateMutability === 'view') {
                signature += ' view';
            } else if (func.stateMutability === 'pure') {
                signature += ' pure';
            } else if (func.stateMutability === 'payable') {
                signature += ' payable';
            }

            if (outputs) {
                signature += ` returns (${outputs})`;
            }

            signature += ';';
            lines.push(signature);
            lines.push('');
        }
    }

    // Events
    if (events.length > 0) {
        lines.push('    // ==================== EVENTS ====================');
        lines.push('');

        for (const event of events) {
            const inputs = event.inputs?.map(input => {
                let type = formatType(input);
                const indexed = input.indexed ? ' indexed' : '';
                return `${type}${indexed} ${input.name}`;
            }).join(', ') || '';

            lines.push(`    event ${event.name}(${inputs});`);
        }
        lines.push('');
    }

    // Errors
    if (errors.length > 0) {
        lines.push('    // ==================== ERRORS ====================');
        lines.push('');

        for (const error of errors) {
            const inputs = formatInputs(error.inputs, true, true);
            lines.push(`    error ${error.name}(${inputs});`);
        }
    }

    lines.push('}');
    lines.push('');

    return lines.join('\n');
}

/**
 * Load build-info output and extract metadata for a contract
 * Searches all build-info files and returns the one with the most documentation
 */
function loadContractDocs(buildInfoPath: string, contractPath: string, contractName: string): ContractDocs | undefined {
    const files = fs.readdirSync(buildInfoPath).filter(f => f.endsWith('.output.json'));

    let bestDocs: ContractDocs | undefined;
    let bestMethodCount = -1;

    for (const file of files) {
        const buildOutput = JSON.parse(fs.readFileSync(path.join(buildInfoPath, file), 'utf8'));
        const contractKey = `project/${contractPath}`;
        const contract = buildOutput.output?.contracts?.[contractKey]?.[contractName];

        if (contract?.metadata) {
            const metadata = typeof contract.metadata === 'string'
                ? JSON.parse(contract.metadata)
                : contract.metadata;

            const docs: ContractDocs = {
                userdoc: metadata.output?.userdoc || { methods: {} },
                devdoc: metadata.output?.devdoc || { methods: {} }
            };

            // Count documented methods to prefer files with more NatSpec
            const methodCount = Object.keys(docs.devdoc.methods).length +
                                Object.keys(docs.userdoc.methods).length;

            if (methodCount > bestMethodCount) {
                bestMethodCount = methodCount;
                bestDocs = docs;
            }
        }
    }

    return bestDocs;
}

/**
 * Merge documentation from multiple contracts
 */
function mergeContractDocs(docsArray: (ContractDocs | undefined)[]): ContractDocs {
    const merged: ContractDocs = {
        userdoc: { methods: {} },
        devdoc: { methods: {} }
    };

    for (const docs of docsArray) {
        if (!docs) continue;

        // Merge userdoc methods
        for (const [key, value] of Object.entries(docs.userdoc.methods)) {
            if (!merged.userdoc.methods[key]) {
                merged.userdoc.methods[key] = value;
            }
        }

        // Merge devdoc methods
        for (const [key, value] of Object.entries(docs.devdoc.methods)) {
            if (!merged.devdoc.methods[key]) {
                merged.devdoc.methods[key] = value;
            }
        }
    }

    return merged;
}

/**
 * Extract constructor info from an ABI
 */
function extractConstructor(abi: AbiItem[]): AbiInput[] | undefined {
    const constructor = abi.find(item => item.type === 'constructor');
    return constructor?.inputs;
}

/**
 * Load constructor documentation from build-info
 */
function loadConstructorDocs(buildInfoPath: string, contractPath: string, contractName: string): ConstructorInfo['docs'] | undefined {
    const files = fs.readdirSync(buildInfoPath).filter(f => f.endsWith('.output.json'));

    for (const file of files) {
        const buildOutput = JSON.parse(fs.readFileSync(path.join(buildInfoPath, file), 'utf8'));
        const contractKey = `project/${contractPath}`;
        const contract = buildOutput.output?.contracts?.[contractKey]?.[contractName];

        if (contract?.metadata) {
            const metadata = typeof contract.metadata === 'string'
                ? JSON.parse(contract.metadata)
                : contract.metadata;

            const devdoc = metadata.output?.devdoc || {};
            const userdoc = metadata.output?.userdoc || {};

            // Constructor docs are under 'constructor' key in methods
            const devConstructor = devdoc.methods?.['constructor'] || {};
            const userConstructor = userdoc.methods?.['constructor'] || {};

            if (devConstructor.params || userConstructor.notice || devConstructor.details) {
                return {
                    notice: userConstructor.notice,
                    dev: devConstructor.details,
                    params: devConstructor.params,
                };
            }
        }
    }

    return undefined;
}

async function main() {
    const artifactsPath = path.join(__dirname, '../artifacts/contracts');
    const buildInfoPath = path.join(__dirname, '../artifacts/build-info');
    const outputPath = path.join(__dirname, '../contracts/interfaces');

    // Load contract docs from build-info
    const totemsDocs = loadContractDocs(buildInfoPath, 'contracts/totems/Totems.sol', 'Totems');

    // Load Totems artifact
    const totemsArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, 'totems/Totems.sol/Totems.json'), 'utf8')
    );

    // Extract constructor info
    const constructorInputs = extractConstructor(totemsArtifact.abi);
    const constructorDocs = loadConstructorDocs(buildInfoPath, 'contracts/totems/Totems.sol', 'Totems');
    const constructorInfo: ConstructorInfo | undefined = constructorInputs ? {
        inputs: constructorInputs,
        docs: constructorDocs,
    } : undefined;

    // Filter ABI to only include functions, events, and errors
    const totemsAbi: AbiItem[] = totemsArtifact.abi.filter((item: AbiItem) =>
        item.type === 'function' || item.type === 'event' || item.type === 'error'
    );

    const totemsInterface = generateInterface(
        'Totems',
        'ITotems',
        totemsAbi,
        ['../library/ITotemTypes.sol'],
        totemsDocs,
        constructorInfo
    );

    fs.writeFileSync(path.join(outputPath, 'ITotems.sol'), totemsInterface);
    console.log('Generated: ITotems.sol');

    // Generate IMarket interface
    const marketDocs = loadContractDocs(buildInfoPath, 'contracts/market/ModMarket.sol', 'ModMarket');
    const marketArtifact = JSON.parse(
        fs.readFileSync(path.join(artifactsPath, 'market/ModMarket.sol/ModMarket.json'), 'utf8')
    );

    const marketInterface = generateInterface(
        'ModMarket',
        'IMarket',
        marketArtifact.abi.filter((item: AbiItem) =>
            item.type === 'function' || item.type === 'event' || item.type === 'error'
        ),
        ['../library/ITotemTypes.sol'],
        marketDocs
    );

    fs.writeFileSync(path.join(outputPath, 'IMarket.sol'), marketInterface);
    console.log('Generated: IMarket.sol');

    console.log('\nInterface generation complete!');
    console.log(`Output directory: ${outputPath}`);
}

main().catch(console.error);
