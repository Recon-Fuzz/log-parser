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

  sequences
    .filter(
      (param): param is string =>
        typeof param === "string" && param.includes("=")
    )
    .forEach((param) => {
      const [paramName, paramValue] = param.split("=").map((s) => s.trim());
      const solidityDeclaration = formatSolidityValue(paramName, paramValue);

      // Extract variable name to check for duplicates
      const varMatch = solidityDeclaration.match(/\w+\s+(\w+)\s*=/);
      if (varMatch) {
        const varName = varMatch[1];
        if (!usedVariableNames.has(varName)) {
          parameterDeclarations.push(`    ${solidityDeclaration}`);
          usedVariableNames.add(varName);
        }
      }
    });

  const parts = [
    `function ${functionName}() public {`,
    `    // Counterexample for: ${propSeq.brokenProperty}`,
  ];

  if (parameterDeclarations.length > 0) {
    parts.push("", "    // Parameter declarations:");
    parts.push(...parameterDeclarations);
  }

  parts.push("", "    // Reproduction sequence:");
  parts.push(`    // ${propSeq.brokenProperty}(/* add parameters here */);`);
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
