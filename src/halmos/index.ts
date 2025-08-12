import { type FuzzingResults, type PropertyAndSequence } from "../types/types";
import { captureFuzzingDuration } from "../utils/utils";

let halmosTraceLogger = false;
let currentBrokenPropertyHalmos = "";

const isEmptyOrAnsi = (line: string): boolean =>
  !line || line.includes("\x1b[") || line.includes("3[2K");

const isTestResult = (line: string): boolean =>
  line.includes("[FAIL]") || line.includes("[TIMEOUT]");

const isEndOfTrace = (line: string): boolean =>
  isTestResult(line) || line.includes("Symbolic test result:");

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

  if (isTestResult(trimmedLine)) {
    const property = extractTestProperty(trimmedLine);
    if (property) {
      currentBrokenPropertyHalmos = property;
      jobStats.results.push(trimmedLine);

      if (trimmedLine.includes("[TIMEOUT]")) {
        findOrCreateProperty(jobStats, property);
      }
    }
    return;
  }

  if (trimmedLine === "Counterexample:") {
    halmosTraceLogger = true;
    return;
  }

  if (halmosTraceLogger) {
    if (trimmedLine.includes("=")) {
      jobStats.traces.push(trimmedLine);
      const property = findOrCreateProperty(
        jobStats,
        currentBrokenPropertyHalmos
      );
      property.sequence += `${trimmedLine}\n`;
    } else if (isEndOfTrace(trimmedLine)) {
      halmosTraceLogger = false;
      jobStats.traces.push("---End Trace---");

      const property = jobStats.brokenProperties.find(
        (prop) => prop.brokenProperty === currentBrokenPropertyHalmos
      );

      if (property && !property.sequence.includes("---End Trace---")) {
        property.sequence += "---End Trace---\n";
      }

      currentBrokenPropertyHalmos = "";
    }
  }
};

const parseLogEntries = (logs: string) =>
  logs.split(/\[(?:FAIL|TIMEOUT)\]/).filter((entry) => entry.trim() !== "");

const extractPropertyName = (entry: string, index: number): string => {
  const match = `[FAIL]${entry}`.match(
    /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/
  );
  return match?.[1] || `temp_${index}`;
};

const extractCounterexamples = (logs: string): string[] => {
  const lines = logs.split("\n");
  let capturing = false;

  return lines.reduce<string[]>((acc, line) => {
    const trimmed = line.trim();

    if (trimmed === "Counterexample:") {
      capturing = true;
      return acc;
    }

    if (capturing) {
      if (trimmed.includes("=")) {
        acc.push(trimmed);
      } else if (
        trimmed.includes("Symbolic test result:") ||
        trimmed.includes("[FAIL]")
      ) {
        capturing = false;
      }
    }

    return acc;
  }, []);
};

export function getHalmosPropertyAndSequence(
  logs: string
): PropertyAndSequence[] {
  return parseLogEntries(logs)
    .map((entry, index) => ({
      property: extractPropertyName(entry, index),
      counterexamples: extractCounterexamples(entry),
      index,
    }))
    .filter(
      ({ property, counterexamples, index }) =>
        property !== `temp_${index}` && counterexamples.length > 0
    )
    .map(({ property, counterexamples }) => ({
      brokenProperty: property,
      sequence: counterexamples,
    }));
}

const cleanParameterName = (paramName: string): string =>
  paramName
    .replace(/^p_/, "")
    .replace(/_[a-f0-9]+_\d+$/, "")
    .replace(/_(?:bool|uint256|address|int256)$/, "");

const formatSolidityValue = (paramName: string, value: string): string => {
  const cleanName = cleanParameterName(paramName);
  const cleanValue = value.replace(/^0x/, "");

  if (paramName.includes("_bool_")) {
    return `bool ${cleanName} = ${cleanValue === "01" ? "true" : "false"};`;
  }
  if (paramName.includes("_uint256_")) {
    return `uint256 ${cleanName} = 0x${cleanValue};`;
  }
  if (paramName.includes("_address_")) {
    return `address ${cleanName} = 0x${cleanValue.padStart(40, "0")};`;
  }
  if (paramName.includes("_int256_")) {
    return `int256 ${cleanName} = int256(0x${cleanValue});`;
  }
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
