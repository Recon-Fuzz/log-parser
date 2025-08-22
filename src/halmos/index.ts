import { type FuzzingResults, type PropertyAndSequence } from "../types/types";

// Store all lines for batch processing
let allLines: string[] = [];

/**
 * Extract CALL statement from a line, handling nested parentheses
 */
function extractCallStatement(line: string): string | null {
  const callStart = line.indexOf("CALL ");
  if (callStart === -1) return null;

  // Find the function call pattern: CALL ContractName::functionName(
  const functionMatch = line.match(/CALL\s+(\w+::[\w]+)\(/);
  if (!functionMatch) return null;

  const functionName = functionMatch[1];
  const openParenIndex = line.indexOf("(", callStart);
  if (openParenIndex === -1) return null;

  // Find the matching closing parenthesis, handling nested parentheses
  let parenCount = 1;
  let i = openParenIndex + 1;
  while (i < line.length && parenCount > 0) {
    if (line[i] === "(") parenCount++;
    else if (line[i] === ")") parenCount--;
    i++;
  }

  if (parenCount === 0) {
    const params = line.substring(openParenIndex + 1, i - 1);
    return `CALL ${functionName}(${params})`;
  }

  return null;
}

export function processHalmos(line: string, jobStats: FuzzingResults): void {
  // Store all lines for later processing
  allLines.push(line);

  // Handle pass/fail counts and test counts immediately
  if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
    jobStats.failed++;
  } else if (line.includes("[PASS]")) {
    jobStats.passed++;
  }

  // Extract test count from summary line
  if (line.includes("Running") && line.includes("tests for")) {
    const testCountMatch = line.match(/Running (\d+) tests/);
    if (testCountMatch) {
      jobStats.numberOfTests = parseInt(testCountMatch[1]);
    }
  }

  // Process broken properties when we hit a FAIL/TIMEOUT line
  if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
    // Process all accumulated lines to extract broken properties
    const logsText = allLines.join("\n");
    const propertySequences = getHalmosPropertyAndSequence(logsText);

    // Add any new broken properties that aren't already in jobStats
    propertySequences.forEach((propSeq) => {
      const exists = jobStats.brokenProperties.some(
        (existing) => existing.brokenProperty === propSeq.brokenProperty
      );
      if (!exists) {
        const sequenceString = Array.isArray(propSeq.sequence)
          ? propSeq.sequence.join("\n")
          : propSeq.sequence;
        jobStats.brokenProperties.push({
          brokenProperty: propSeq.brokenProperty,
          sequence: sequenceString,
        });
      }
    });
  }

  // Reset for next batch when we see a new counterexample
  if (line.includes("Counterexample:")) {
    allLines = [line];
  }

  // Always add to traces
  if (line.trim()) {
    jobStats.traces.push(line.trim());
  }
}

/**
 * Simple function to extract property and sequence from Halmos logs
 * Similar to Medusa's getPropertyAndSequenceString function
 */
export function getHalmosPropertyAndSequence(
  logs: string
): PropertyAndSequence[] {
  const results: PropertyAndSequence[] = [];
  const lines = logs.split("\n");

  let currentCounterexample: string[] = [];
  let currentSequenceCalls: string[] = [];
  let capturing = false;
  let capturingSequence = false;
  let currentCall = "";
  let currentProperty = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Handle different failure formats
    // Format 1: [FAIL] property_name (paths: ...)
    const failMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(line);
    if (failMatch) {
      currentProperty = failMatch[1].trim();
    }

    // Format 2: Assertion failure detected in ContractName.property_name()
    const assertionFailMatch =
      /Assertion failure detected in \w+\.(.+?)\(\)/.exec(line);
    if (assertionFailMatch) {
      currentProperty = assertionFailMatch[1].trim();
    }

    // Start capturing when we see "Counterexample:"
    if (line === "Counterexample:" || line.includes("Counterexample:")) {
      capturing = true;
      capturingSequence = false;
      currentCounterexample = [];
      currentSequenceCalls = [];
      currentCall = "";
      continue;
    }

    // Start capturing sequence when we see "Sequence:"
    if (line === "Sequence:" || line.includes("Sequence:")) {
      capturingSequence = true;
      currentCall = "";
      continue;
    }

    if (capturing) {
      // Check for end conditions
      const isEndCondition =
        line.includes("[FAIL]") ||
        line.includes("[TIMEOUT]") ||
        line.includes("Symbolic test result:") ||
        (currentProperty && i === lines.length - 1);

      if (isEndCondition) {
        // Finalize any pending call
        if (currentCall && capturingSequence) {
          const callMatch = extractCallStatement(currentCall);
          if (callMatch) {
            currentSequenceCalls.push(callMatch);
          }
        }

        // Use the property we found earlier or try to extract from current line
        let propertyName = currentProperty;
        if (!propertyName) {
          const propertyMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(
            line
          );
          if (propertyMatch) {
            propertyName = propertyMatch[1].trim();
          }
        }

        if (propertyName && currentCounterexample.length > 0) {
          // Combine parameter declarations and sequence calls
          const combinedSequence = [
            ...currentCounterexample,
            ...currentSequenceCalls,
          ];
          results.push({
            brokenProperty: propertyName,
            sequence: combinedSequence,
          });
        }
        capturing = false;
        capturingSequence = false;
        currentCounterexample = [];
        currentSequenceCalls = [];
        currentCall = "";
        currentProperty = "";
      } else if (capturingSequence && line.startsWith("CALL ")) {
        // Finalize previous call if any
        if (currentCall) {
          const callMatch = extractCallStatement(currentCall);
          if (callMatch) {
            currentSequenceCalls.push(callMatch);
          }
        }
        // Start new call
        currentCall = line;
      } else if (
        capturingSequence &&
        currentCall &&
        !line.startsWith("    CALL ") &&
        !line.startsWith("        ") &&
        line.trim() &&
        !line.includes("[FAIL]") &&
        !line.includes("[TIMEOUT]")
      ) {
        // This might be a continuation of the current CALL statement
        // Check if it looks like part of the function parameters
        if (line.includes(")") || line.includes(",") || line.includes("p_")) {
          currentCall += " " + line.trim();
        }
      } else if (
        capturingSequence &&
        currentCall &&
        (line.includes("(value:") ||
          line.includes("(caller:") ||
          line.startsWith("halmos_msg_"))
      ) {
        // Skip value and caller information for CALL statements
        continue;
      } else if (
        capturingSequence &&
        line.startsWith("    ") &&
        (line.includes("SLOAD") ||
          line.includes("SSTORE") ||
          line.includes("STATICCALL") ||
          line.includes("CREATE") ||
          line.includes("↩ RETURN"))
      ) {
        // Skip internal EVM operations
        continue;
      } else if (
        !capturingSequence &&
        line.includes("=") &&
        (line.startsWith("p_") ||
          line.includes("_uint256") ||
          line.includes("_address") ||
          line.includes("_bool") ||
          line.includes("halmos_"))
      ) {
        // Extract parameter declarations - handle various parameter naming patterns
        // Skip halmos internal variables unless they're actual parameters
        if (!line.includes("halmos_") || line.startsWith("p_")) {
          currentCounterexample.push(line);
        }
      } else if (
        !capturingSequence &&
        line.length > 0 &&
        !line.includes("=") &&
        currentCounterexample.length > 0
      ) {
        // Handle multi-line values (like bytes data)
        const lastParam =
          currentCounterexample[currentCounterexample.length - 1];
        if (lastParam.includes("=") && !lastParam.includes("0x")) {
          // This is likely a continuation of the previous parameter
          currentCounterexample[currentCounterexample.length - 1] =
            lastParam + line;
        }
      }
    }
  }

  return results;
}

/**
 * Helper function to parse CALL statements from Halmos sequence logs
 * Extracts function name and parameters from lines like:
 * "CALL CryticToFoundry::setTheManager(p_manager_address_83d2b33_33)"
 */
const parseCallStatement = (
  callLine: string
): { functionName: string; parameters: string[] } | null => {
  // Match pattern: CALL ContractName::functionName(param1, param2, ...)
  const callMatch = callLine.match(/CALL\s+\w+::(\w+)\(([^)]*)\)/);
  if (!callMatch) {
    return null;
  }

  const functionName = callMatch[1];
  const paramString = callMatch[2].trim();

  if (!paramString) {
    return { functionName, parameters: [] };
  }

  // Handle Concat() expressions that combine multiple parameters
  if (paramString.startsWith("Concat(")) {
    // Extract parameters from Concat(param1, param2, ...)
    const concatContent = paramString.slice(7, -1); // Remove "Concat(" and ")"
    const concatParams = parseConcatParameters(concatContent);
    return { functionName, parameters: concatParams };
  }

  // Parse parameters - handle complex expressions like Concat(param1, param2)
  const parameters: string[] = [];
  let currentParam = "";
  let parenDepth = 0;
  let i = 0;

  while (i < paramString.length) {
    const char = paramString[i];

    if (char === "(") {
      parenDepth++;
      currentParam += char;
    } else if (char === ")") {
      parenDepth--;
      currentParam += char;
    } else if (char === "," && parenDepth === 0) {
      // Found a parameter separator at top level
      if (currentParam.trim()) {
        parameters.push(currentParam.trim());
      }
      currentParam = "";
    } else {
      currentParam += char;
    }
    i++;
  }

  // Add the last parameter
  if (currentParam.trim()) {
    parameters.push(currentParam.trim());
  }

  return { functionName, parameters };
};

/**
 * Parse parameters from Concat() expressions
 * Handles nested expressions and extracts individual parameter names
 */
const parseConcatParameters = (concatContent: string): string[] => {
  const parameters: string[] = [];
  let currentParam = "";
  let parenDepth = 0;
  let i = 0;

  while (i < concatContent.length) {
    const char = concatContent[i];

    if (char === "(") {
      parenDepth++;
      currentParam += char;
    } else if (char === ")") {
      parenDepth--;
      currentParam += char;
    } else if (char === "," && parenDepth === 0) {
      // Found a parameter separator at top level
      const param = currentParam.trim();
      if (param && param.startsWith("p_")) {
        parameters.push(param);
      }
      currentParam = "";
    } else {
      currentParam += char;
    }
    i++;
  }

  // Add the last parameter
  const lastParam = currentParam.trim();
  if (lastParam && lastParam.startsWith("p_")) {
    parameters.push(lastParam);
  }

  return parameters;
};

/**
 * Helper function to clean parameter names for Solidity variable names
 */
const cleanParameterName = (paramName: string): string =>
  paramName
    .replace(/^p_/, "")
    .replace(/_[a-f0-9]+_\d+$/, "") // Remove hash_number suffix
    .replace(/_[a-zA-Z0-9]+_\d+$/, "") // Remove alphanumeric_number suffix
    .replace(/\[(\d+)\]/, "$1");

/**
 * Helper function to extract type from parameter name
 * Uses only generic type patterns, not specific variable names
 */
const extractTypeFromParamName = (paramName: string): string => {
  // Check for explicit type patterns in parameter names
  if (paramName.includes("_bool")) return "bool";
  if (paramName.includes("_address")) return "address";
  if (paramName.includes("_uint256")) return "uint256";
  if (paramName.includes("_uint8")) return "uint8";
  if (paramName.includes("_uint16")) return "uint16";
  if (paramName.includes("_uint32")) return "uint32";
  if (paramName.includes("_uint64")) return "uint64";
  if (paramName.includes("_uint128")) return "uint128";
  if (paramName.includes("_bytes")) return "bytes";
  if (paramName.includes("_string")) return "string";

  // Handle dynamic uint types like _uint24_, _uint96_, etc.
  const uintMatch = paramName.match(/_uint(\d+)_/);
  if (uintMatch) return `uint${uintMatch[1]}`;

  // Handle signed integers
  const intMatch = paramName.match(/_int(\d+)_/);
  if (intMatch) return `int${intMatch[1]}`;

  // Handle fixed-size bytes
  const bytesMatch = paramName.match(/_bytes(\d+)_/);
  if (bytesMatch) return `bytes${bytesMatch[1]}`;

  return "uint256"; // default fallback
};

/**
 * Helper function to format Solidity value declarations
 */
const formatSolidityValue = (paramName: string, value: string): string => {
  const cleanName = cleanParameterName(paramName);
  const cleanValue = value.replace(/^0x/, "");
  const type = extractTypeFromParamName(paramName);

  if (type === "bool") {
    // Handle different bool value formats
    const boolValue =
      cleanValue === "01" || cleanValue === "true" || cleanValue === "1"
        ? "true"
        : "false";
    return `bool ${cleanName} = ${boolValue};`;
  }

  if (type === "address") {
    return `address ${cleanName} = 0x${cleanValue.padStart(40, "0")};`;
  }

  if (type.startsWith("uint") || type.startsWith("int")) {
    return `${type} ${cleanName} = 0x${cleanValue};`;
  }

  if (type === "bytes") {
    return `bytes ${cleanName} = 0x${cleanValue};`;
  }

  return `uint256 ${cleanName} = 0x${cleanValue};`;
};

/**
 * Generate function call with mapped parameters
 */
const generateFunctionCall = (
  brokenProperty: string,
  variableMapping: Map<string, string>
): string => {
  // Extract function name and parameter types from the property
  const functionMatch = brokenProperty.match(/^([^(]+)\(([^)]*)\)/);
  if (!functionMatch) {
    return `${brokenProperty}(/* parameters not parsed */)`;
  }

  const functionName = functionMatch[1];
  const paramTypes = functionMatch[2];

  if (!paramTypes.trim()) {
    return `${functionName}()`;
  }

  // Parse parameter types
  const types = paramTypes.split(",").map((t) => t.trim());
  const parameters: string[] = [];

  // Map parameter types to variable names
  types.forEach((type, index) => {
    // Look for variables that match this parameter position
    const matchingVar = findMatchingVariable(type, index, variableMapping);
    parameters.push(matchingVar || `/* ${type} parameter */`);
  });

  return `${functionName}(${parameters.join(", ")})`;
};

/**
 * Find matching variable for a parameter type and position
 */
const findMatchingVariable = (
  type: string,
  position: number,
  variableMapping: Map<string, string>
): string | null => {
  // Handle array types specially (both dynamic [] and fixed [N])
  if (type.includes("[") && type.includes("]")) {
    // Look for array variable in mapping (e.g., "arr" -> "arr_array")
    for (const [paramName, varName] of variableMapping) {
      if (paramName === "arr" && varName.includes("_array")) {
        return varName;
      }
    }
    return createArrayParameter(type, variableMapping);
  }

  // Generic type patterns for parameter matching
  const typePatterns = {
    address: ["_address"],
    bool: ["_bool"],
    uint256: ["_uint256"],
    uint8: ["_uint8"],
    uint16: ["_uint16"],
    uint32: ["_uint32"],
    uint64: ["_uint64"],
    uint128: ["_uint128"],
    bytes: ["_bytes"],
    string: ["_string"],
  };

  // First, try to find exact matches based on position
  const positionNames = ["a", "b", "c", "d", "e"];
  if (position < positionNames.length) {
    const expectedName = `${positionNames[position]}_${type.replace("[]", "")}`;
    for (const [paramName, varName] of variableMapping) {
      if (
        paramName.includes(expectedName.replace("uint256", "uint256")) ||
        paramName.includes(expectedName.replace("address", "address")) ||
        paramName.includes(expectedName.replace("bool", "bool"))
      ) {
        return varName;
      }
    }
  }

  // Enhanced fallback: find any variable of the matching type with pattern matching
  const patterns = typePatterns[type as keyof typeof typePatterns] || [
    `_${type}`,
  ];
  for (const pattern of patterns) {
    for (const [paramName, varName] of variableMapping) {
      // Check if the parameter name contains the type pattern
      if (paramName.includes(pattern)) {
        return varName;
      }
    }
  }

  // Last resort: try to find any variable that matches the base type
  for (const [paramName, varName] of variableMapping) {
    if (paramName.includes(`_${type}_`) || paramName.includes(`_${type}`)) {
      return varName;
    }
  }

  return null;
};

const createArrayParameter = (
  type: string,
  variableMapping: Map<string, string>
): string => {
  const arrayElements: string[] = [];
  let arrayLength = 0;

  // Find all array elements
  const elementMap = new Map<number, string>();
  const elementPattern = /arr\[(\d+)\]/;

  for (const [paramName, varName] of variableMapping) {
    const match = elementPattern.exec(paramName);
    if (match) {
      const index = parseInt(match[1], 10);
      elementMap.set(index, varName);
      arrayLength = Math.max(arrayLength, index + 1);
    }
  }

  // Build array elements in order
  for (let i = 0; i < arrayLength; i++) {
    const element = elementMap.get(i);
    if (element) {
      arrayElements.push(element);
    }
  }

  if (arrayElements.length > 0) {
    return `[${arrayElements.join(", ")}]`;
  }

  return `/* ${type} parameter */`;
};

const generateArrayDeclarations = (
  variableMapping: Map<string, string>
): { declarations: string[]; arrayVariables: Map<string, string> } => {
  const declarations: string[] = [];
  const arrayVariables = new Map<string, string>();

  // Find all array elements and group them
  const arrayGroups = new Map<string, Map<number, string>>();
  const elementPattern = /arr\[(\d+)\]/;

  for (const [paramName, varName] of variableMapping) {
    const match = elementPattern.exec(paramName);
    if (match) {
      const index = parseInt(match[1], 10);
      const arrayName = "arr"; // Could be extracted from paramName if needed

      if (!arrayGroups.has(arrayName)) {
        arrayGroups.set(arrayName, new Map());
      }
      arrayGroups.get(arrayName)!.set(index, varName);
    }
  }

  // Generate array declarations
  for (const [arrayName, elements] of arrayGroups) {
    const maxIndex = Math.max(...elements.keys());
    const arrayElements: string[] = [];

    for (let i = 0; i <= maxIndex; i++) {
      const element = elements.get(i);
      arrayElements.push(element || "0");
    }

    if (arrayElements.length > 0) {
      const arrayVarName = `${arrayName}_array`;
      declarations.push(
        `    uint256[] memory ${arrayVarName} = new uint256[](${arrayElements.length});`
      );

      // Add individual assignments
      arrayElements.forEach((element, index) => {
        declarations.push(`    ${arrayVarName}[${index}] = ${element};`);
      });

      arrayVariables.set(arrayName, arrayVarName);
    }
  }

  return { declarations, arrayVariables };
};

/**
 * Generate Foundry test function from property and sequence
 * Similar to Medusa's function generation approach
 */
const generateTestFunction = (
  propSeq: PropertyAndSequence,
  identifier: string,
  index: number
): string => {
  const functionName = `test_${propSeq.brokenProperty.replace(
    /\W/g,
    "_"
  )}_${identifier}_${index}`;
  const sequences = Array.isArray(propSeq.sequence)
    ? propSeq.sequence
    : [propSeq.sequence];

  const parameterDeclarations: string[] = [];
  const usedVariableNames = new Set<string>();
  const variableMapping = new Map<string, string>();
  const arrayDeclarations: string[] = [];
  const sequenceCalls: string[] = [];

  // Process parameter declarations
  sequences
    .filter(
      (param): param is string =>
        typeof param === "string" &&
        param.includes("=") &&
        param.startsWith("p_")
    )
    .forEach((param) => {
      const [paramName, paramValue] = param.split("=").map((s) => s.trim());
      const solidityDeclaration = formatSolidityValue(paramName, paramValue);

      // Extract variable name to check for duplicates
      const varPattern = /\w+\s+(\w+)\s*=/;
      const varMatch = varPattern.exec(solidityDeclaration);
      if (varMatch) {
        const varName = varMatch[1];
        if (!usedVariableNames.has(varName)) {
          parameterDeclarations.push(`    ${solidityDeclaration}`);
          usedVariableNames.add(varName);
          variableMapping.set(paramName, varName);
        }
      }
    });

  // Process sequence calls
  sequences
    .filter(
      (line): line is string =>
        typeof line === "string" && line.startsWith("CALL ")
    )
    .forEach((callLine) => {
      const parsedCall = parseCallStatement(callLine);
      if (parsedCall) {
        const { functionName: callFunctionName, parameters } = parsedCall;

        // Map parameters to variable names with improved matching
        const mappedParams = parameters.map((param) => {
          // Extract parameter name from complex expressions like Concat(p_param, ...)
          const paramMatch = /p_\w+_[a-f0-9]+_\d+/.exec(param);
          if (paramMatch) {
            const paramName = paramMatch[0];
            const mappedVar = variableMapping.get(paramName);
            if (mappedVar) {
              return mappedVar;
            }

            // If direct mapping fails, try to find a similar parameter by base name
            const baseName = paramName.split("_")[1]; // Extract base name like "flag", "account", etc.
            for (const [key, value] of variableMapping) {
              if (key.includes(baseName)) {
                return value;
              }
            }

            return paramName;
          }

          // Handle simple parameter names that start with p_
          if (param.startsWith("p_")) {
            const mappedVar = variableMapping.get(param);
            if (mappedVar) {
              return mappedVar;
            }

            // Try to find by base name matching
            const baseName = param.split("_")[1];
            for (const [key, value] of variableMapping) {
              if (key.includes(baseName)) {
                return value;
              }
            }
          }

          return param;
        });

        const functionCallStr = `${callFunctionName}(${mappedParams.join(
          ", "
        )})`;
        sequenceCalls.push(`    ${functionCallStr};`);
      }
    });

  // Generate array declarations if needed
  const arrayInfo = generateArrayDeclarations(variableMapping);
  if (arrayInfo.declarations.length > 0) {
    arrayDeclarations.push(...arrayInfo.declarations);
    // Add array variables to mapping for function call generation
    arrayInfo.arrayVariables.forEach((varName: string, arrayName: string) => {
      variableMapping.set(arrayName, varName);
    });
  }

  const parts = [
    `function ${functionName}() public {`,
    `    // Counterexample for: ${propSeq.brokenProperty}`,
  ];

  if (parameterDeclarations.length > 0) {
    parts.push("", "    // Parameter declarations:");
    parts.push(...parameterDeclarations);
  }

  if (arrayDeclarations.length > 0) {
    parts.push("", "    // Array declarations:");
    parts.push(...arrayDeclarations);
  }

  parts.push("", "    // Reproduction sequence:");

  // Add sequence calls if available, otherwise fall back to the original property call
  if (sequenceCalls.length > 0) {
    parts.push(...sequenceCalls);

    // For invariant tests, add the invariant call at the end
    if (propSeq.brokenProperty.includes("invariant")) {
      const invariantCall = generateFunctionCall(
        propSeq.brokenProperty,
        variableMapping
      );
      parts.push(`    ${invariantCall};`);
    }
  } else {
    // Fallback to original behavior for unit tests
    const functionCall = generateFunctionCall(
      propSeq.brokenProperty,
      variableMapping
    );
    parts.push(`    ${functionCall};`);
  }

  parts.push("}");

  return parts.join("\n");
};

/**
 * Generate a single test function from property name and sequence
 * Used by frontend for individual broken properties
 * This function works with individual sequences (similar to Medusa/Echidna approach)
 */
export function halmosSequenceToFunction(
  sequence: string,
  brokenProperty: string,
  identifier: string,
  index: number = 0
): string {
  // Parse the sequence string back to array format
  const sequenceArray = sequence
    .split("\n")
    .filter((line) => line.trim() !== "");
  const propSeq = { brokenProperty, sequence: sequenceArray };
  return generateTestFunction(propSeq, identifier, index);
}

export function halmosLogsToFunctions(
  logs: string,
  identifier: string
): string {
  const propertySequences = getHalmosPropertyAndSequence(logs);

  return propertySequences.length === 0
    ? "// No failed properties found in Halmos logs"
    : propertySequences
        .map((propSeq, index) =>
          generateTestFunction(propSeq, identifier, index)
        )
        .join("\n\n");
}
