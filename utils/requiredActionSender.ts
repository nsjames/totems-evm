import {
    type PublicClient,
    type WalletClient,
    type Address,
    type AbiFunction,
    parseAbiItem,
    encodeFunctionData,
} from 'viem'

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

export interface ExecuteModActionParams {
    publicClient: PublicClient
    walletClient: WalletClient
    modAddress: Address
    requiredAction: ModRequiredAction
    totemTicker: string
    dynamicParams?: Record<string, string>
    account: Address
}

export interface ExecuteModActionResult {
    hash: `0x${string}`
    receipt: Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>
}

export async function executeModAction({
                                           publicClient,
                                           walletClient,
                                           modAddress,
                                           requiredAction,
                                           totemTicker,
                                           dynamicParams = {},
                                           account,
                                       }: ExecuteModActionParams): Promise<ExecuteModActionResult> {
    const abiItem = parseAbiItem(`function ${requiredAction.signature}`) as AbiFunction

    const args = abiItem.inputs.map((input) => {
        const field = requiredAction.inputFields.find((f) => f.name === input.name)!

        let rawValue: string

        switch (field.mode) {
            case ModActionFieldInputMode.DYNAMIC:
                rawValue = dynamicParams[field.name]
                break
            case ModActionFieldInputMode.STATIC:
                rawValue = field.value
                break
            case ModActionFieldInputMode.TOTEM:
                rawValue = totemTicker
                break
        }

        return parseValue(rawValue, input.type)
    })

    const data = encodeFunctionData({
        abi: [abiItem],
        functionName: abiItem.name,
        args,
    })

    const hash = await walletClient.sendTransaction({
        to: modAddress,
        data,
        value: requiredAction.cost,
        account,
        chain: walletClient.chain,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    return { hash, receipt }
}

function parseValue(value: string, type: string): any {
    if (type === 'uint' || type.startsWith('uint')) {
        return BigInt(value)
    }

    if (type === 'int' || type.startsWith('int')) {
        return BigInt(value)
    }

    if (type === 'address') {
        return value as Address
    }

    if (type === 'bool') {
        return value === 'true' || value === '1'
    }

    if (type === 'string') {
        return value
    }

    if (type.match(/^bytes(\d+)$/)) {
        return value
    }

    if (type === 'bytes') {
        return value
    }

    const fixedArrayMatch = type.match(/^(.+)\[(\d+)\]$/)
    if (fixedArrayMatch) {
        const innerType = fixedArrayMatch[1]
        const parsed = JSON.parse(value) as string[]
        return parsed.map((v) => parseValue(v, innerType))
    }

    const dynamicArrayMatch = type.match(/^(.+)\[\]$/)
    if (dynamicArrayMatch) {
        const innerType = dynamicArrayMatch[1]
        const parsed = JSON.parse(value) as string[]
        return parsed.map((v) => parseValue(v, innerType))
    }

    if (type.startsWith('(') && type.endsWith(')')) {
        const innerTypes = parseTupleTypes(type.slice(1, -1))
        const parsed = JSON.parse(value) as string[]
        return innerTypes.map((t, i) => parseValue(parsed[i], t))
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