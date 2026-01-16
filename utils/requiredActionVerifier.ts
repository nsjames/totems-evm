import { parseAbiItem, encodeFunctionData, toFunctionSelector, type PublicClient, type Address, type AbiFunction } from 'viem'

/**
 * Derives the validation function signature from the main function signature.
 * Convention: setup(...) -> canSetup(...)
 * e.g., "setup(string ticker, uint256 amount)" -> "canSetup(string ticker, uint256 amount)"
 */
export function deriveValidationSignature(signature: string): string {
    const match = signature.match(/^(\w+)\((.*)$/)
    if (!match) return signature

    const [, name, rest] = match
    const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)
    return `can${capitalizedName}(${rest}`
}

/**
 * Normalizes a function signature to canonical form (types only, no parameter names)
 * e.g., "setup(string ticker, uint256 amount)" -> "setup(string,uint256)"
 */
function normalizeSignature(signature: string): string {
    const match = signature.match(/^(\w+)\((.*)\)$/)
    if (!match) return signature

    const [, name, params] = match
    if (!params.trim()) return `${name}()`

    // Parse parameters and extract just the types
    const types: string[] = []
    let current = ''
    let depth = 0

    for (const char of params) {
        if (char === '(') {
            depth++
            current += char
        } else if (char === ')') {
            depth--
            current += char
        } else if (char === ',' && depth === 0) {
            types.push(extractType(current.trim()))
            current = ''
        } else {
            current += char
        }
    }
    if (current.trim()) {
        types.push(extractType(current.trim()))
    }

    return `${name}(${types.join(',')})`
}

/**
 * Extracts the type from a parameter declaration
 * e.g., "string ticker" -> "string", "uint256[] calldata amounts" -> "uint256[]"
 */
function extractType(param: string): string {
    // Remove calldata/memory/storage modifiers
    const withoutModifiers = param
        .replace(/\s+(calldata|memory|storage)\s*/g, ' ')
        .trim()

    // Split by whitespace - type is first, name (if present) is last
    const parts = withoutModifiers.split(/\s+/)

    // Handle array types that might be split: "uint256 []" or "uint256[]"
    if (parts.length === 1) return parts[0]

    // Check if first part looks like a type (contains base type)
    // Type is everything before the parameter name
    // e.g., "string ticker" -> "string"
    // e.g., "uint256[] amounts" -> "uint256[]"
    return parts[0]
}

export async function validateFunctionExists(
    client: PublicClient,
    mod: Address,
    signature: string
): Promise<{ exists: boolean; error?: string }> {
    // Parse the full signature to get parameter info
    const abiItem = parseAbiItem(`function ${signature}`) as AbiFunction

    // Get canonical signature for correct selector computation
    const canonicalSig = normalizeSignature(signature)
    const selector = toFunctionSelector(`function ${canonicalSig}`)

    const dummyArgs = abiItem.inputs.map((input) => getZeroValue(input.type))

    const calldata = encodeFunctionData({
        abi: [abiItem],
        functionName: abiItem.name,
        args: dummyArgs,
    })

    // Replace the selector in calldata with the correct one
    const correctedCalldata = selector + calldata.slice(10)

    try {
        await client.call({
            to: mod,
            data: correctedCalldata as `0x${string}`,
        })
        return { exists: true }
    } catch (e: any) {
        // Check for revert data in various places viem might put it
        const revertData = e.data
            ?? e.cause?.data
            ?? e.cause?.cause?.data
            ?? e.walk?.((err: any) => err.data)?.data

        // If there's revert data (custom error or require message), function exists
        if (revertData && revertData !== '0x') {
            return { exists: true }
        }

        // Check error details for evidence of function execution
        const errorDetails = e.details || e.cause?.details || e.cause?.cause?.details || ''

        // These patterns indicate the function was found and executed but reverted
        if (errorDetails.includes('reverted with custom error') ||
            errorDetails.includes('reverted with reason')) {
            return { exists: true }
        }

        return { exists: false, error: 'Function not found on contract' }
    }
}

/**
 * Validates that a required action has both:
 * 1. The main function (e.g., setup)
 * 2. The validation function (e.g., canSetup)
 *
 * This should be called before publishing a mod with required actions.
 */
export async function validateRequiredAction(
    client: PublicClient,
    mod: Address,
    signature: string
): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    // Check main function exists
    const mainResult = await validateFunctionExists(client, mod, signature)
    if (!mainResult.exists) {
        errors.push(`Main function not found: ${signature}`)
    }

    // Derive and check validation function (can<FunctionName>)
    const validationSig = deriveValidationSignature(signature)
    const validationResult = await validateFunctionExists(client, mod, validationSig)
    if (!validationResult.exists) {
        errors.push(`Validation function not found: ${validationSig}`)
    }

    return {
        valid: errors.length === 0,
        errors
    }
}

function getZeroValue(type: string): any {
    if (type === 'uint' || type.startsWith('uint')) {
        return 0n
    }

    if (type === 'int' || type.startsWith('int')) {
        return 0n
    }

    if (type === 'address') {
        return '0x0000000000000000000000000000000000000000'
    }

    if (type === 'bool') {
        return false
    }

    if (type === 'string') {
        return ''
    }

    const fixedBytesMatch = type.match(/^bytes(\d+)$/)
    if (fixedBytesMatch) {
        const size = parseInt(fixedBytesMatch[1])
        return '0x' + '00'.repeat(size)
    }

    if (type === 'bytes') {
        return '0x'
    }

    const fixedArrayMatch = type.match(/^(.+)\[(\d+)\]$/)
    if (fixedArrayMatch) {
        const innerType = fixedArrayMatch[1]
        const length = parseInt(fixedArrayMatch[2])
        return Array(length)
            .fill(null)
            .map(() => getZeroValue(innerType))
    }

    const dynamicArrayMatch = type.match(/^(.+)\[\]$/)
    if (dynamicArrayMatch) {
        return []
    }

    if (type.startsWith('(') && type.endsWith(')')) {
        const innerTypes = parseTupleTypes(type.slice(1, -1))
        return innerTypes.map((t) => getZeroValue(t))
    }

    throw new Error(`Unsupported type: ${type}`)
}

function parseTupleTypes(inner: string): string[] {
    const types: string[] = []
    let current = ''
    let depth = 0

    for (const char of inner) {
        if (char === '(') {
            depth++
            current += char
        } else if (char === ')') {
            depth--
            current += char
        } else if (char === ',' && depth === 0) {
            types.push(current.trim())
            current = ''
        } else {
            current += char
        }
    }

    if (current.trim()) {
        types.push(current.trim())
    }

    return types
}