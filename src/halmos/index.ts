import { type FuzzingResults, type PropertyAndSequence } from "../types/types";

let halmosTraceLogger = false;
let currentBrokenPropertyHalmos = "";
let currentCounterexample: string[] = [];

/**
 * The function `processHalmos` parses and extracts information from a given line
 * of text to update job statistics and log results for a Halmos testing job.
 * Similar to processMedusa and processEchidna functions.
 */
export function processHalmos(line: string, jobStats: FuzzingResults): void {
  if (line.includes("Counterexample:")) {
    halmosTraceLogger = true;
    currentCounterexample = [];
  }

  if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
    const propertyMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(line);
    if (propertyMatch) {
      currentBrokenPropertyHalmos = propertyMatch[1].trim();
      jobStats.brokenProperties.push({
        brokenProperty: currentBrokenPropertyHalmos,
        sequence: currentCounterexample.join("\n"),
      });
      jobStats.failed++;
    }
    halmosTraceLogger = false;
    currentCounterexample = [];
  } else if (line.includes("[PASS]")) {
    jobStats.passed++;
  }

  if (halmosTraceLogger && line.trim() && !line.includes("Counterexample:")) {
    if (line.includes("=") && line.startsWith("    p_")) {
      currentCounterexample.push(line.trim());
    }
    jobStats.traces.push(line.trim());
  }

  // Extract test count from summary line
  if (line.includes("Running") && line.includes("tests for")) {
    const testCountMatch = line.match(/Running (\d+) tests/);
    if (testCountMatch) {
      jobStats.numberOfTests = parseInt(testCountMatch[1]);
    }
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
  let capturing = false;

  for (const element of lines) {
    const line = element.trim();

    if (line === "Counterexample:") {
      capturing = true;
      currentCounterexample = [];
      continue;
    }

    if (capturing) {
      if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
        // Extract property name
        const propertyMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(
          line
        );
        if (propertyMatch && currentCounterexample.length > 0) {
          results.push({
            brokenProperty: propertyMatch[1].trim(),
            sequence: currentCounterexample,
          });
        }
        capturing = false;
        currentCounterexample = [];
      } else if (line.includes("=") && line.startsWith("p_")) {
        currentCounterexample.push(line);
      } else if (
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

/**
 * Create array parameter from individual array elements
 */
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

/**
 * Generate array declarations from individual array elements
 */
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

  sequences
    .filter(
      (param): param is string =>
        typeof param === "string" && param.includes("=")
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

  // Generate array declarations if needed
  const arrayInfo = generateArrayDeclarations(variableMapping);
  if (arrayInfo.declarations.length > 0) {
    arrayDeclarations.push(...arrayInfo.declarations);
    // Add array variables to mapping for function call generation
    arrayInfo.arrayVariables.forEach((varName: string, arrayName: string) => {
      variableMapping.set(arrayName, varName);
    });
  }

  // Generate function call with actual parameters
  const functionCall = generateFunctionCall(
    propSeq.brokenProperty,
    variableMapping
  );

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
  parts.push(`    ${functionCall};`);
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
