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

  for (const element of lines) {
    const line = element.trim();

    if (line === "Counterexample:") {
      capturing = true;
      capturingSequence = false;
      currentCounterexample = [];
      currentSequenceCalls = [];
      currentCall = "";
      continue;
    }

    if (line === "Sequence:") {
      capturingSequence = true;
      currentCall = "";
      continue;
    }

    if (capturing) {
      if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
        // Finalize any pending call
        if (currentCall && capturingSequence) {
          currentSequenceCalls.push(currentCall.trim());
        }

        // Extract property name
        const propertyMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(
          line
        );
        if (propertyMatch && currentCounterexample.length > 0) {
          // Combine parameter declarations and sequence calls
          const combinedSequence = [
            ...currentCounterexample,
            ...currentSequenceCalls,
          ];
          results.push({
            brokenProperty: propertyMatch[1].trim(),
            sequence: combinedSequence,
          });
        }
        capturing = false;
        capturingSequence = false;
        currentCounterexample = [];
        currentSequenceCalls = [];
        currentCall = "";
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
        line.startsWith("p_")
      ) {
        // Extract parameter declarations
        currentCounterexample.push(line);
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
 * Helper function to clean parameter names for Solidity variable names
 */
const cleanParameterName = (paramName: string): string =>
  paramName
    .replace(/^p_/, "")
    .replace(/_[a-f0-9]+_\d+$/, "")
    .replace(/\[(\d+)\]/, "$1");

/**
 * Helper function to extract type from parameter name
 */
const extractTypeFromParamName = (paramName: string): string => {
  if (paramName.includes("_bool_")) return "bool";
  if (paramName.includes("_address_")) return "address";
  if (paramName.includes("_uint256_")) return "uint256";
  if (paramName.includes("_uint8_")) return "uint8";
  if (paramName.includes("_bytes_")) return "bytes";
  if (paramName.includes("_length_")) return "uint256";

  const uintMatch = paramName.match(/_uint(\d+)_/);
  if (uintMatch) return `uint${uintMatch[1]}`;

  const intMatch = paramName.match(/_int(\d+)_/);
  if (intMatch) return `int${intMatch[1]}`;

  return "uint256"; // default
};

/**
 * Helper function to format Solidity value declarations
 */
const formatSolidityValue = (paramName: string, value: string): string => {
  const cleanName = cleanParameterName(paramName);
  const cleanValue = value.replace(/^0x/, "");
  const type = extractTypeFromParamName(paramName);

  if (type === "bool") {
    return `bool ${cleanName} = ${cleanValue === "01" ? "true" : "false"};`;
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

  // Common patterns for parameter names
  const typePatterns = {
    address: ["a_address", "b_address", "address"],
    bool: ["a_bool", "b_bool", "flag", "bool"],
    uint256: ["x_uint256", "value_uint256", "amount", "uint256"],
    uint8: ["small_uint8", "uint8"],
    bytes: ["data_bytes", "bytes"],
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

  // Fallback: find any variable of the matching type
  const patterns = typePatterns[type as keyof typeof typePatterns] || [type];
  for (const pattern of patterns) {
    for (const [paramName, varName] of variableMapping) {
      if (paramName.includes(pattern)) {
        return varName;
      }
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

        // Map parameters to variable names
        const mappedParams = parameters.map((param) => {
          // Extract parameter name from complex expressions like Concat(p_param, ...)
          const paramMatch = /p_\w+_[a-f0-9]+_\d+/.exec(param);
          if (paramMatch) {
            const paramName = paramMatch[0];
            return variableMapping.get(paramName) || paramName;
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
