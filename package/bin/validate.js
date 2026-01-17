#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { validateContract, formatResults, generateRequiredActions } from '../validator/index.js';

function printUsage() {
  console.log(`
Totem Mod Validator - Validates mod contracts follow the setup pattern

Usage: npx @totems/evm validate <path> [options]

Arguments:
  path              Path to a .sol file or directory containing .sol files

Options:
  --strict          Treat warnings as errors (exit code 1)
  --json            Output results as JSON
  --actions         Generate required actions JSON for market publish
  --help, -h        Show this help message

Examples:
  npx @totems/evm validate ./contracts/MyMod.sol
  npx @totems/evm validate ./contracts/
  npx @totems/evm validate ./contracts/ --strict
  npx @totems/evm validate ./contracts/MyMod.sol --actions

Setup Pattern Convention:
  - Mods implement isSetupFor(ticker) to indicate if setup is complete
  - Setup functions modify state that isSetupFor depends on
  - Each setup function should have a validator: mySetup() -> canMySetup()
  - Setup functions should have access control (e.g., onlyCreator)
`);
}

function findSolFiles(dirPath) {
  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.sol')) {
        files.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return files;
}

async function main() {
  const args = process.argv.slice(2);

  // Remove 'validate' if present (when called as `npx @totems/evm validate`)
  if (args[0] === 'validate') {
    args.shift();
  }

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const strict = args.includes('--strict');
  const jsonOutput = args.includes('--json');
  const actionsOutput = args.includes('--actions');

  // Find the path argument (first non-flag argument)
  const targetPath = args.find(arg => !arg.startsWith('--'));

  if (!targetPath) {
    console.error('Error: No path specified');
    printUsage();
    process.exit(1);
  }

  const resolvedPath = path.resolve(targetPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Path does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  // Collect files to validate
  let files = [];
  const stat = fs.statSync(resolvedPath);

  if (stat.isDirectory()) {
    files = findSolFiles(resolvedPath);
  } else if (stat.isFile() && resolvedPath.endsWith('.sol')) {
    files = [resolvedPath];
  } else {
    console.error('Error: Path must be a .sol file or directory');
    process.exit(1);
  }

  if (files.length === 0) {
    console.error('Error: No .sol files found');
    process.exit(1);
  }

  // Validate each file
  const allResults = [];

  for (const file of files) {
    try {
      const results = validateContract(file);
      allResults.push(...results);
    } catch (error) {
      console.error(`Error validating ${file}: ${error.message}`);
      if (!jsonOutput) {
        console.error(error.stack);
      }
    }
  }

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(allResults, null, 2));
  } else if (actionsOutput) {
    const actions = generateRequiredActions(allResults);
    console.log(JSON.stringify(actions, null, 2));
  } else {
    console.log(formatResults(allResults));
  }

  // Exit code
  const hasFailures = allResults.some(r => !r.passed);
  if (strict && hasFailures) {
    process.exit(1);
  } else if (allResults.some(r => r.errors.length > 0)) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
