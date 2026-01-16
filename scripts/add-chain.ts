import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function promptRequired(question: string): Promise<string> {
  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`${question}: `, (answer) => {
        if (answer.trim()) {
          resolve(answer.trim());
        } else {
          console.log("  This field is required.");
          ask();
        }
      });
    };
    ask();
  });
}

// Convert network name to valid JS variable name (no hyphens/spaces)
function toVarName(name: string): string {
  return name.replace(/[-\s]/g, "_");
}

// Convert network name to env var prefix (uppercase, underscores)
function toEnvPrefix(name: string): string {
  return name.toUpperCase().replace(/[-\s]/g, "_");
}

// Convert to camelCase for viem chain lookup
function toCamelCase(name: string): string {
  return name.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}

async function main() {
  console.log("\n=== Add New EVM Chain ===\n");

  // Basic info
  const networkName = (await promptRequired("Network name (e.g., arbitrum, base-sepolia)")).toLowerCase();
  const chainId = await promptRequired("Chain ID (e.g., 42161)");
  const chainDisplayName = await prompt("Display name", networkName.charAt(0).toUpperCase() + networkName.slice(1));
  const nativeCurrency = await prompt("Native currency symbol", "ETH");

  // Generate env var names automatically from network name
  const envPrefix = toEnvPrefix(networkName);
  const rpcEnvVar = `${envPrefix}_RPC_URL`;
  const wsRpcEnvVar = `${envPrefix}_WS_URL`;
  const privateKeyEnvVar = `${envPrefix}_PRIVATE_KEY`;

  // Prompt for actual values
  console.log("\n--- RPC URLs ---");
  const rpcUrl = await promptRequired("RPC URL (https://...)");
  const wsRpcUrl = await prompt("WebSocket URL (wss://..., optional)");

  // Explorer (optional)
  console.log("\n--- Block Explorer (optional) ---");
  const explorerUrl = await prompt("Explorer API URL (e.g., https://api.arbiscan.io/api)");
  const explorerApiKeyEnvVar = explorerUrl ? await prompt("Explorer API key env var", "ETHERSCAN_API_KEY") : "";

  // Deployer
  console.log("\n--- Deployment ---");
  const deployer = await promptRequired("Deployer address (0x...)");

  // Fees
  console.log("\n--- Fees (use format: '0.001 ether' or '1 gwei') ---");
  const minBaseFee = await prompt("Min base fee", "0.0001 ether");
  const burnedFee = await prompt("Burned fee", "0.00005 ether");

  // Mods
  console.log("\n--- Mods to Deploy ---");
  const modsInput = await prompt("Mods (comma-separated)", "UnlimitedMinterMod");
  const mods = modsInput.split(",").map((m) => m.trim()).filter(Boolean);

  // Referrer (optional)
  console.log("\n--- Referrer (optional) ---");
  const referrerAddress = await prompt("Referrer address");
  const referrerFee = referrerAddress ? await prompt("Referrer fee", "0.0001 ether") : "";

  rl.close();

  // Generate YAML config
  const configDir = path.join(import.meta.dirname, "..", "deployments", "configs");
  const configPath = path.join(configDir, `${networkName}.yaml`);

  if (fs.existsSync(configPath)) {
    console.log(`\nError: Config already exists at ${configPath}`);
    process.exit(1);
  }

  let yaml = `deployer: "${deployer}"
rpcEnvVar: "${rpcEnvVar}"
wsRpcEnvVar: "${wsRpcEnvVar}"`;

  if (explorerUrl) {
    yaml += `\nexplorerUrl: "${explorerUrl}"`;
    yaml += `\nexplorerApiKeyEnvVar: "${explorerApiKeyEnvVar}"`;
  }

  yaml += `
minBaseFee: "${minBaseFee}"
burnedFee: "${burnedFee}"

mods:`;

  for (const mod of mods) {
    yaml += `\n  - ${mod}`;
  }

  yaml += `

publish:`;
  for (const mod of mods) {
    yaml += `\n  - name: ${mod}`;
  }

  if (referrerAddress) {
    yaml += `

referrers:
  - address: "${referrerAddress}"
    fee: "${referrerFee}"`;
  }

  yaml += `

totems: []
`;

  fs.writeFileSync(configPath, yaml);
  console.log(`\nCreated: ${configPath}`);

  // Update central config
  const indexPath = path.join(configDir, "index.ts");
  let indexContent = fs.readFileSync(indexPath, "utf-8");

  // Check if chain already exists
  if (indexContent.includes(`case '${networkName}':`)) {
    console.log(`Chain '${networkName}' already exists in index.ts`);
  } else {
    // Known viem chains (check if this chain exists in viem)
    const viemChains: Record<string, string> = {
      "mainnet": "mainnet",
      "sepolia": "sepolia",
      "goerli": "goerli",
      "arbitrum": "arbitrum",
      "arbitrum-one": "arbitrum",
      "arbitrum-sepolia": "arbitrumSepolia",
      "optimism": "optimism",
      "optimism-sepolia": "optimismSepolia",
      "base": "base",
      "base-sepolia": "baseSepolia",
      "polygon": "polygon",
      "polygon-mumbai": "polygonMumbai",
      "avalanche": "avalanche",
      "avalanche-fuji": "avalancheFuji",
      "bsc": "bsc",
      "bsc-testnet": "bscTestnet",
      "fantom": "fantom",
      "gnosis": "gnosis",
      "celo": "celo",
      "linea": "linea",
      "linea-testnet": "lineaTestnet",
      "scroll": "scroll",
      "scroll-sepolia": "scrollSepolia",
      "zksync": "zkSync",
      "mantle": "mantle",
      "blast": "blast",
      "blast-sepolia": "blastSepolia",
    };

    const viemChainName = viemChains[networkName] || viemChains[toCamelCase(networkName)];

    if (viemChainName) {
      // Add import if needed
      const importMatch = indexContent.match(/import \{ ([^}]+) \} from 'viem\/chains';/);
      if (importMatch && !importMatch[1].includes(viemChainName)) {
        const existingImports = importMatch[1];
        const newImports = `${existingImports}, ${viemChainName}`;
        indexContent = indexContent.replace(
          /import \{ ([^}]+) \} from 'viem\/chains';/,
          `import { ${newImports} } from 'viem/chains';`
        );
      }

      // Add case
      const newCase = `        case '${networkName}':\n            return ${viemChainName};`;
      indexContent = indexContent.replace(
        /(\s+default:\s+throw new Error)/,
        `${newCase}\n$1`
      );
    } else {
      // Custom chain - use valid variable name
      const chainVarName = `${toVarName(networkName)}Chain`;
      const customChainDef = `
const ${chainVarName} = {
    id: ${chainId},
    name: '${chainDisplayName}',
    nativeCurrency: { name: '${nativeCurrency}', symbol: '${nativeCurrency}', decimals: 18 },
    rpcUrls: {
        default: { http: ['https://rpc.example.com'] }, // Update with actual RPC
    },
} as const satisfies Chain;
`;
      // Insert after imports
      const insertPoint = indexContent.indexOf("// ==================== CHAIN CONFIG ====================");
      if (insertPoint > -1) {
        indexContent = indexContent.slice(0, insertPoint) + customChainDef + "\n" + indexContent.slice(insertPoint);
      }

      // Add case
      const newCase = `        case '${networkName}':\n            return ${chainVarName};`;
      indexContent = indexContent.replace(
        /(\s+default:\s+throw new Error)/,
        `${newCase}\n$1`
      );
    }

    // Update error message
    indexContent = indexContent.replace(
      /Valid: ([^`]+)`\)/,
      (match, chains) => {
        if (!chains.includes(networkName)) {
          return `Valid: ${chains}, ${networkName}\`)`;
        }
        return match;
      }
    );

    fs.writeFileSync(indexPath, indexContent);
    console.log(`Updated: ${indexPath}`);
  }

  // Env var names and values
  const envVars: Record<string, string> = {
    [rpcEnvVar]: rpcUrl,
    [wsRpcEnvVar]: wsRpcUrl,
    [privateKeyEnvVar]: "",
  };

  // Update .env.example (empty values)
  const envExamplePath = path.join(import.meta.dirname, "..", ".env.example");
  if (fs.existsSync(envExamplePath)) {
    let envContent = fs.readFileSync(envExamplePath, "utf-8");
    const toAdd = Object.keys(envVars).filter((v) => !envContent.includes(v));

    if (toAdd.length > 0) {
      envContent = envContent.trimEnd() + "\n" + toAdd.map((v) => `${v}=`).join("\n") + "\n";
      fs.writeFileSync(envExamplePath, envContent);
      console.log(`Updated: ${envExamplePath}`);
    }
  }

  // Update .env (with actual values)
  const envPath = path.join(import.meta.dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf-8");
    const toAdd: string[] = [];

    for (const [key, value] of Object.entries(envVars)) {
      if (!envContent.includes(key)) {
        toAdd.push(`${key}=${value}`);
      }
    }

    if (toAdd.length > 0) {
      envContent = envContent.trimEnd() + "\n" + toAdd.join("\n") + "\n";
      fs.writeFileSync(envPath, envContent);
      console.log(`Updated: ${envPath}`);
    }
  }

  console.log(`
=== Setup Complete ===

Next steps:
1. Add private key to .env:
   ${privateKeyEnvVar}=<deployer-private-key>

2. Add deployer key to PRIVATE_KEYS env var for deployment

3. Deploy:
   bun deploy ${networkName}

4. (Optional) Verify contracts:
   bun deploy ${networkName} --verify
`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  rl.close();
  process.exit(1);
});
