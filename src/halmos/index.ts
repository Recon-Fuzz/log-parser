import { type FuzzingResults, type PropertyAndSequence } from "../types/types";
import { captureFuzzingDuration } from "../utils/utils";

let halmosCounterexampleLogger = false;
let currentCounterexampleData: string[] = [];

const isEmptyOrAnsi = (line: string): boolean =>
  !line || line.includes("\x1b[") || line.includes("3[2K");

const isTestResult = (line: string): boolean =>
  line.includes("[FAIL]") || line.includes("[TIMEOUT]");

const extractTestProperty = (line: string): string | null => {
  const match = line.match(/\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/);
  return match?.[1]?.trim() || null;
};

const extractCounts = (line: string) => {
  const passedMatch = line.match(/(\d+)\s+passed/);
  const failedMatch = line.match(/(\d+)\s+failed/);
  return {
    passed: passedMatch ? parseInt(passedMatch[1]) : 0,
    failed: failedMatch ? parseInt(failedMatch[1]) : 0,
  };
};

const extractDuration = (line: string): string => {
  const timeMatch = line.match(/time:\s*([\d.]+)s/);
  if (!timeMatch) return "";

  const durationStr = `${Math.floor(parseFloat(timeMatch[1]))}s`;
  return captureFuzzingDuration(durationStr) || durationStr;
};

const findOrCreateProperty = (
  jobStats: FuzzingResults,
  propertyName: string
) => {
  let property = jobStats.brokenProperties.find(
    (prop) => prop.brokenProperty === propertyName
  );

  if (!property) {
    property = { brokenProperty: propertyName, sequence: "" };
    jobStats.brokenProperties.push(property);
  }

  return property;
};

export const processHalmos = (line: string, jobStats: FuzzingResults): void => {
  const trimmedLine = line.trim();

  if (isEmptyOrAnsi(trimmedLine)) return;

  if (trimmedLine.includes("Symbolic test result:")) {
    const { passed, failed } = extractCounts(trimmedLine);
    jobStats.passed = passed;
    jobStats.failed = failed;
    jobStats.numberOfTests = passed + failed;
    jobStats.duration = extractDuration(trimmedLine);
    return;
  }

  // Start collecting counterexample data
  if (trimmedLine === "Counterexample:") {
    // If we were already capturing, we need to handle the previous counterexample
    // This can happen when there are multiple counterexamples without [FAIL] lines in between
    if (halmosCounterexampleLogger && currentCounterexampleData.length > 0) {
      // This shouldn't happen in normal Halmos logs, but let's handle it gracefully
      halmosCounterexampleLogger = false;
      currentCounterexampleData = [];
    }

    halmosCounterexampleLogger = true;
    currentCounterexampleData = [];
    return;
  }

  // Collect counterexample parameter lines
  if (halmosCounterexampleLogger) {
    if (isTestResult(trimmedLine)) {
      // We've hit a [FAIL] or [TIMEOUT] line - process the property
      const property = extractTestProperty(trimmedLine);
      if (property && currentCounterexampleData.length > 0) {
        jobStats.results.push(trimmedLine);

        // Create broken property with the collected counterexample data
        const brokenProperty = findOrCreateProperty(jobStats, property);
        brokenProperty.sequence = currentCounterexampleData.join("\n") + "\n";
      } else if (property) {
        // Just add to results, don't create empty broken properties
        jobStats.results.push(trimmedLine);
      }

      // Reset state
      halmosCounterexampleLogger = false;
      currentCounterexampleData = [];
    } else if (trimmedLine.includes("=")) {
      currentCounterexampleData.push(trimmedLine);
    } else if (
      trimmedLine.includes("Symbolic test result:") ||
      trimmedLine.includes("[PASS]") ||
      trimmedLine === "Counterexample:"
    ) {
      // Reset state if we hit end of logs, a pass, or another counterexample without a fail
      halmosCounterexampleLogger = false;
      currentCounterexampleData = [];

      // If it's another counterexample, start capturing again
      if (trimmedLine === "Counterexample:") {
        halmosCounterexampleLogger = true;
        currentCounterexampleData = [];
      }
    }
  }

  // Handle test results that don't have preceding counterexamples
  if (!halmosCounterexampleLogger && isTestResult(trimmedLine)) {
    const property = extractTestProperty(trimmedLine);
    if (property) {
      jobStats.results.push(trimmedLine);
      // Don't create empty broken properties for tests without counterexamples
    }
  }
};

export function getHalmosPropertyAndSequence(
  logs: string
): PropertyAndSequence[] {
  const lines = logs.split("\n");
  const results: PropertyAndSequence[] = [];
  let currentCounterexamples: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Counterexample:") {
      capturing = true;
      currentCounterexamples = [];
      continue;
    }

    if (capturing) {
      if (trimmed.includes("=")) {
        currentCounterexamples.push(trimmed);
      } else if (trimmed.includes("[FAIL]") || trimmed.includes("[TIMEOUT]")) {
        // Extract property name from the [FAIL] or [TIMEOUT] line
        const propertyMatch = trimmed.match(
          /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/
        );
        if (propertyMatch && currentCounterexamples.length > 0) {
          results.push({
            brokenProperty: propertyMatch[1].trim(),
            sequence: currentCounterexamples,
          });
        }
        capturing = false;
        currentCounterexamples = [];
      }
    }
  }

  return results;
}

const cleanParameterName = (paramName: string): string =>
  paramName
    .replace(/^p_/, "")
    .replace(/_[a-f0-9]+_\d+$/, "")
    .replace(/_(?:bool|uint\d+|address|int\d+|bytes\d*)$/, "");

const extractTypeFromParamName = (paramName: string): string | null => {
  const typeMatch = paramName.match(
    /_(?:bool|uint\d+|address|int\d+|bytes\d*)_/
  );
  return typeMatch ? typeMatch[0].slice(1, -1) : null;
};

const formatSolidityValue = (paramName: string, value: string): string => {
  const cleanName = cleanParameterName(paramName);
  const cleanValue = value.replace(/^0x/, "");
  const type = extractTypeFromParamName(paramName);

  if (paramName.includes("_bool_")) {
    return `bool ${cleanName} = ${cleanValue === "01" ? "true" : "false"};`;
  }

  if (paramName.includes("_address_")) {
    return `address ${cleanName} = 0x${cleanValue.padStart(40, "0")};`;
  }

  // Handle all uint types (uint8, uint16, uint32, uint64, uint128, uint256, etc.)
  if (type?.startsWith("uint")) {
    return `${type} ${cleanName} = 0x${cleanValue};`;
  }

  // Handle all int types (int8, int16, int32, int64, int128, int256, etc.)
  if (type?.startsWith("int")) {
    return `${type} ${cleanName} = ${type}(0x${cleanValue});`;
  }

  // Handle bytes types (bytes, bytes1, bytes2, ..., bytes32)
  if (type?.startsWith("bytes")) {
    return `${type} ${cleanName} = 0x${cleanValue};`;
  }

  // Default fallback to uint256
  return `uint256 ${cleanName} = 0x${cleanValue};`;
};

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

  const parameters = sequences
    .filter(
      (param): param is string =>
        typeof param === "string" && param.includes("=")
    )
    .map((param) => {
      const [paramName, paramValue] = param.split("=").map((s) => s.trim());
      return `    ${formatSolidityValue(paramName, paramValue)}`;
    })
    .join("\n");

  return [
    `function ${functionName}() public {`,
    `    // Counterexample for: ${propSeq.brokenProperty}`,
    parameters,
    `    `,
    `    // Call the original function with counterexample values`,
    `    // ${propSeq.brokenProperty}(/* add parameters here */);`,
    `}`,
  ].join("\n");
};

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
