import solc from 'solc';
import fs from 'fs';
import path from 'path';

/**
 * @typedef {Object} SetupFunction
 * @property {string} name
 * @property {string} signature
 * @property {string|null} validator
 * @property {string|null} accessControl
 * @property {string[]} modifiesState
 */

/**
 * @typedef {Object} ValidationResult
 * @property {string} contract
 * @property {string} file
 * @property {boolean} implementsIsSetupFor
 * @property {{ alwaysTrue: boolean, dependsOn: string[] }} isSetupForAnalysis
 * @property {SetupFunction[]} setupFunctions
 * @property {string[]} warnings
 * @property {string[]} errors
 * @property {boolean} passed
 */

/**
 * Capitalize first letter
 * @param {string} str
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Find node_modules directory by walking up from basePath
 * @param {string} startPath
 */
function findNodeModules(startPath) {
  let currentPath = startPath;
  while (currentPath !== path.dirname(currentPath)) {
    const nodeModulesPath = path.join(currentPath, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      return nodeModulesPath;
    }
    currentPath = path.dirname(currentPath);
  }
  return null;
}

/**
 * Find import statements and resolve paths
 * @param {string} basePath
 */
function findImports(basePath) {
  const nodeModulesDir = findNodeModules(basePath);

  return function(importPath) {
    // Handle relative imports
    const fullPath = path.resolve(basePath, importPath);
    if (fs.existsSync(fullPath)) {
      return { contents: fs.readFileSync(fullPath, 'utf8') };
    }

    // Handle node_modules imports (including scoped packages like @totems/evm)
    if (nodeModulesDir) {
      const nodeModulesPath = path.join(nodeModulesDir, importPath);
      if (fs.existsSync(nodeModulesPath)) {
        return { contents: fs.readFileSync(nodeModulesPath, 'utf8') };
      }
    }

    return { error: `File not found: ${importPath}` };
  };
}

/**
 * Compile a Solidity file and return the AST
 * @param {string} filePath
 */
export function compileContract(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const basePath = path.dirname(filePath);
  const fileName = path.basename(filePath);

  const input = {
    language: 'Solidity',
    sources: {
      [fileName]: { content: source }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['ast'],
          '': ['ast']
        }
      }
    }
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports(basePath) })
  );

  if (output.errors) {
    const errors = output.errors.filter(e => e.severity === 'error');
    if (errors.length > 0) {
      throw new Error(`Compilation errors:\n${errors.map(e => e.message).join('\n')}`);
    }
  }

  return output.sources[fileName].ast;
}

/**
 * Find a contract definition in the AST
 * @param {Object} ast
 * @param {string} contractName
 */
function findContract(ast, contractName) {
  for (const node of ast.nodes) {
    if (node.nodeType === 'ContractDefinition' && node.name === contractName) {
      return node;
    }
  }
  return null;
}

/**
 * Find all contract definitions in the AST
 * @param {Object} ast
 */
function findAllContracts(ast) {
  return ast.nodes.filter(node =>
    node.nodeType === 'ContractDefinition' &&
    node.contractKind === 'contract'
  );
}

/**
 * Find a function in a contract
 * @param {Object} contract
 * @param {string} functionName
 */
function findFunction(contract, functionName) {
  for (const node of contract.nodes) {
    if (node.nodeType === 'FunctionDefinition' && node.name === functionName) {
      return node;
    }
  }
  return null;
}

/**
 * Get all functions in a contract
 * @param {Object} contract
 */
function getAllFunctions(contract) {
  return contract.nodes.filter(node => node.nodeType === 'FunctionDefinition');
}

/**
 * Get all state variables in a contract
 * @param {Object} contract
 */
function getStateVariables(contract) {
  return contract.nodes.filter(node => node.nodeType === 'VariableDeclaration');
}

/**
 * Extract identifiers referenced in a function body
 * @param {Object} node
 * @param {Set<string>} identifiers
 */
function extractIdentifiers(node, identifiers = new Set()) {
  if (!node) return identifiers;

  if (node.nodeType === 'Identifier') {
    identifiers.add(node.name);
  }

  if (node.nodeType === 'IndexAccess' && node.baseExpression?.nodeType === 'Identifier') {
    identifiers.add(node.baseExpression.name);
  }

  // Recurse into child nodes
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object') {
            extractIdentifiers(item, identifiers);
          }
        }
      } else {
        extractIdentifiers(child, identifiers);
      }
    }
  }

  return identifiers;
}

/**
 * Check if a function modifies a specific state variable
 * @param {Object} func
 * @param {string} varName
 */
function functionModifiesState(func, varName) {
  const body = func.body;
  if (!body) return false;

  // Look for assignments to the variable
  function checkNode(node) {
    if (!node) return false;

    // Check for direct assignment
    if (node.nodeType === 'Assignment') {
      const leftIdentifiers = extractIdentifiers(node.leftHandSide);
      if (leftIdentifiers.has(varName)) return true;
    }

    // Check for index access assignment (mapping)
    if (node.nodeType === 'ExpressionStatement' && node.expression?.nodeType === 'Assignment') {
      const leftIdentifiers = extractIdentifiers(node.expression.leftHandSide);
      if (leftIdentifiers.has(varName)) return true;
    }

    // Recurse
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && checkNode(item)) return true;
          }
        } else {
          if (checkNode(child)) return true;
        }
      }
    }

    return false;
  }

  return checkNode(body);
}

/**
 * Get access control modifiers for a function
 * @param {Object} func
 */
function getAccessControl(func) {
  const modifiers = func.modifiers || [];
  const accessModifiers = ['onlyCreator', 'onlyOwner', 'onlyAdmin', 'onlyManager', 'onlyTotems'];

  for (const mod of modifiers) {
    const name = mod.modifierName?.name;
    if (accessModifiers.includes(name)) {
      return name;
    }
  }

  return null;
}

/**
 * Check if isSetupFor always returns true
 * @param {Object} func
 */
function isSetupForAlwaysTrue(func) {
  const body = func.body;
  if (!body || !body.statements) return false;

  // Simple check: if the only statement is "return true"
  if (body.statements.length === 1) {
    const stmt = body.statements[0];
    if (stmt.nodeType === 'Return' &&
        stmt.expression?.nodeType === 'Literal' &&
        stmt.expression?.value === 'true') {
      return true;
    }
  }

  return false;
}

/**
 * Analyze isSetupFor function to find state dependencies
 * @param {Object} func
 * @param {Object[]} stateVars
 */
function analyzeIsSetupFor(func, stateVars) {
  const stateVarNames = new Set(stateVars.map(v => v.name));
  const referencedIdentifiers = extractIdentifiers(func.body);

  const dependsOn = [];
  for (const id of referencedIdentifiers) {
    if (stateVarNames.has(id)) {
      dependsOn.push(id);
    }
  }

  return {
    alwaysTrue: isSetupForAlwaysTrue(func),
    dependsOn
  };
}

/**
 * Find setup functions that modify state used by isSetupFor
 * @param {Object} contract
 * @param {string[]} stateDependencies
 */
function findSetupFunctions(contract, stateDependencies) {
  const functions = getAllFunctions(contract);
  const setupFunctions = [];

  for (const func of functions) {
    // Skip view/pure functions, constructors, and isSetupFor itself
    if (func.stateMutability === 'view' || func.stateMutability === 'pure') continue;
    if (func.kind === 'constructor') continue;
    if (func.name === 'isSetupFor') continue;
    if (func.name === '') continue; // fallback/receive

    // Check if this function modifies any of the state dependencies
    const modifiesState = [];
    for (const stateVar of stateDependencies) {
      if (functionModifiesState(func, stateVar)) {
        modifiesState.push(stateVar);
      }
    }

    if (modifiesState.length > 0) {
      // Look for corresponding validator function
      const validatorName = `can${capitalize(func.name)}`;
      const validator = findFunction(contract, validatorName);

      setupFunctions.push({
        name: func.name,
        signature: `${func.name}(${(func.parameters?.parameters || []).map(p => p.typeDescriptions?.typeString || p.typeName?.name).join(',')})`,
        validator: validator ? validatorName : null,
        accessControl: getAccessControl(func),
        modifiesState
      });
    }
  }

  return setupFunctions;
}

/**
 * Validate a single contract
 * @param {string} filePath
 * @param {string} [contractName]
 * @returns {ValidationResult[]}
 */
export function validateContract(filePath, contractName) {
  const ast = compileContract(filePath);
  const contracts = contractName
    ? [findContract(ast, contractName)].filter(Boolean)
    : findAllContracts(ast);

  const results = [];

  for (const contract of contracts) {
    const result = {
      contract: contract.name,
      file: filePath,
      implementsIsSetupFor: false,
      isSetupForAnalysis: { alwaysTrue: true, dependsOn: [] },
      setupFunctions: [],
      warnings: [],
      errors: [],
      passed: true
    };

    // Find isSetupFor function
    const isSetupFor = findFunction(contract, 'isSetupFor');
    if (!isSetupFor) {
      result.implementsIsSetupFor = false;
      result.warnings.push('Contract does not implement isSetupFor');
      results.push(result);
      continue;
    }

    result.implementsIsSetupFor = true;

    // Analyze isSetupFor
    const stateVars = getStateVariables(contract);
    result.isSetupForAnalysis = analyzeIsSetupFor(isSetupFor, stateVars);

    // If isSetupFor always returns true, no setup needed
    if (result.isSetupForAnalysis.alwaysTrue) {
      results.push(result);
      continue;
    }

    // Find setup functions
    result.setupFunctions = findSetupFunctions(contract, result.isSetupForAnalysis.dependsOn);

    // Generate warnings
    if (result.isSetupForAnalysis.dependsOn.length > 0 && result.setupFunctions.length === 0) {
      result.warnings.push(
        `isSetupFor depends on state (${result.isSetupForAnalysis.dependsOn.join(', ')}) but no setup functions found`
      );
      result.passed = false;
    }

    for (const fn of result.setupFunctions) {
      if (!fn.validator) {
        result.warnings.push(
          `Setup function ${fn.name}() has no validator. Expected: can${capitalize(fn.name)}()`
        );
        result.passed = false;
      }

      if (!fn.accessControl) {
        result.warnings.push(
          `Setup function ${fn.name}() has no access control modifier`
        );
        result.passed = false;
      }
    }

    results.push(result);
  }

  return results;
}

/**
 * Format validation results for console output
 * @param {ValidationResult[]} results
 * @param {boolean} verbose
 */
export function formatResults(results, verbose = false) {
  const lines = [];

  for (const result of results) {
    lines.push(`\n${'─'.repeat(60)}`);
    lines.push(`Contract: ${result.contract}`);
    lines.push(`File: ${result.file}`);
    lines.push('');

    if (!result.implementsIsSetupFor) {
      lines.push('  ⚠ Does not implement isSetupFor');
      continue;
    }

    // isSetupFor analysis
    if (result.isSetupForAnalysis.alwaysTrue) {
      lines.push('  isSetupFor: Always returns true (no setup required)');
    } else {
      lines.push(`  isSetupFor: Depends on state`);
      lines.push(`    └─ Variables: ${result.isSetupForAnalysis.dependsOn.join(', ')}`);
    }

    // Setup functions
    if (result.setupFunctions.length > 0) {
      lines.push('');
      lines.push('  Setup Functions:');
      lines.push('  ┌─────────────────────────┬─────────────────────────┬─────────────┐');
      lines.push('  │ Function                │ Validator               │ Access      │');
      lines.push('  ├─────────────────────────┼─────────────────────────┼─────────────┤');

      for (const fn of result.setupFunctions) {
        const fnName = fn.name.padEnd(23).slice(0, 23);
        const validator = fn.validator
          ? `${fn.validator}() ✓`.padEnd(23).slice(0, 23)
          : 'NOT FOUND ✗'.padEnd(23);
        const access = (fn.accessControl || 'NONE').padEnd(11).slice(0, 11);
        lines.push(`  │ ${fnName} │ ${validator} │ ${access} │`);
      }

      lines.push('  └─────────────────────────┴─────────────────────────┴─────────────┘');
    }

    // Warnings
    if (result.warnings.length > 0) {
      lines.push('');
      lines.push('  Warnings:');
      for (const warning of result.warnings) {
        lines.push(`    ⚠ ${warning}`);
      }
    }

    // Errors
    if (result.errors.length > 0) {
      lines.push('');
      lines.push('  Errors:');
      for (const error of result.errors) {
        lines.push(`    ✗ ${error}`);
      }
    }

    // Result
    lines.push('');
    if (result.passed) {
      lines.push('  Result: PASS ✓');
    } else {
      lines.push('  Result: WARNINGS ⚠');
    }
  }

  lines.push(`\n${'─'.repeat(60)}`);

  // Summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  lines.push(`\nSummary: ${passed}/${total} contracts passed validation`);

  return lines.join('\n');
}

/**
 * Generate suggested required actions JSON
 * @param {ValidationResult[]} results
 */
export function generateRequiredActions(results) {
  const actions = {};

  for (const result of results) {
    if (result.setupFunctions.length === 0) continue;

    actions[result.contract] = result.setupFunctions.map(fn => ({
      function: fn.signature,
      validator: fn.validator ? `${fn.validator}(...)` : null,
      modifies: fn.modifiesState
    }));
  }

  return actions;
}
