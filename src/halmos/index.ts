import {
  type FuzzingResults,
  type PropertyAndSequence,
  type VmParsingData,
} from "../types/types";
import { captureFuzzingDuration } from "../utils/utils";

//////////////////////////////////////
//          HALMOS                  //
//////////////////////////////////////

let halmosTraceLogger = false;
let currentBrokenPropertyHalmos = "";

/**
 * Process a single line of HALMOS output and update the job statistics.
 * @param {string} line - A single line from HALMOS output
 * @param {FuzzingResults} jobStats - The job statistics object to update
 */
export const processHalmos = (line: string, jobStats: FuzzingResults): void => {
  const trimmedLine = line.trim();

  // Skip empty lines and ANSI escape sequences
  if (
    !trimmedLine ||
    trimmedLine.includes("\x1b[") ||
    trimmedLine.includes("3[2K")
  ) {
    return;
  }

  // Extract duration from final result line
  if (trimmedLine.includes("Symbolic test result:")) {
    const timeMatch = trimmedLine.match(/time:\s*([\d.]+)s/);
    if (timeMatch) {
      const durationStr = `${Math.floor(parseFloat(timeMatch[1]))}s`;
      const duration = captureFuzzingDuration(durationStr);
      jobStats.duration = duration || durationStr;
    }

    // Extract passed/failed counts
    const passedMatch = trimmedLine.match(/(\d+)\s+passed/);
    const failedMatch = trimmedLine.match(/(\d+)\s+failed/);

    if (passedMatch) {
      jobStats.passed = parseInt(passedMatch[1]);
    }
    if (failedMatch) {
      jobStats.failed = parseInt(failedMatch[1]);
    }

    jobStats.numberOfTests = jobStats.passed + jobStats.failed;
    return;
  }

  // Detect test results - [FAIL] or [TIMEOUT]
  if (trimmedLine.includes("[FAIL]") || trimmedLine.includes("[TIMEOUT]")) {
    const testMatch = trimmedLine.match(
      /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/
    );
    if (testMatch) {
      currentBrokenPropertyHalmos = testMatch[1].trim();
      jobStats.results.push(trimmedLine);

      // For timeout tests without counterexamples, add broken property immediately
      if (trimmedLine.includes("[TIMEOUT]")) {
        jobStats.brokenProperties.push({
          brokenProperty: currentBrokenPropertyHalmos,
          sequence: "",
        });
      }
    }
    return;
  }

  // Start capturing counterexample
  if (trimmedLine === "Counterexample:") {
    halmosTraceLogger = true;
    return;
  }

  // Capture counterexample parameters and end trace
  if (halmosTraceLogger) {
    if (trimmedLine.includes("=")) {
      jobStats.traces.push(trimmedLine);

      const existingProperty = jobStats.brokenProperties.find(
        (prop) => prop.brokenProperty === currentBrokenPropertyHalmos
      );

      if (!existingProperty) {
        jobStats.brokenProperties.push({
          brokenProperty: currentBrokenPropertyHalmos,
          sequence: `${trimmedLine}\n`,
        });
      } else {
        existingProperty.sequence += `${trimmedLine}\n`;
      }
    } else if (
      trimmedLine.includes("[FAIL]") ||
      trimmedLine.includes("[TIMEOUT]") ||
      trimmedLine.includes("Symbolic test result:")
    ) {
      // End trace
      halmosTraceLogger = false;
      jobStats.traces.push("---End Trace---");

      const existingProperty = jobStats.brokenProperties.find(
        (prop) => prop.brokenProperty === currentBrokenPropertyHalmos
      );

      if (
        existingProperty &&
        !existingProperty.sequence.includes("---End Trace---")
      ) {
        existingProperty.sequence += "---End Trace---\n";
      }

      currentBrokenPropertyHalmos = "";
    }
  }
};

/**
 * Extract property and sequence information from Halmos logs.
 * @param {string} logs - Raw Halmos logs
 * @param {VmParsingData} [vmData] - Optional VM parsing data
 * @returns {PropertyAndSequence[]} Array of property and sequence objects
 */
export function getHalmosPropertyAndSequence(
  logs: string,
  vmData?: VmParsingData
): PropertyAndSequence[] {
  const results: PropertyAndSequence[] = [];

  // Split by [FAIL] and [TIMEOUT] to get individual test entries
  const entries = logs
    .split(/\[(?:FAIL|TIMEOUT)\]/)
    .filter((entry) => entry.trim() !== "");

  // Process all entries (no need to skip first since we're looking for content after [FAIL])
  entries.forEach((entry, index) => {
    const header = getHalmosHeaders(`[FAIL]${entry}`, index);
    const body = getHalmosCounterexamples(entry);

    if (header !== `temp_${index}` && body.length > 0) {
      results.push({
        brokenProperty: header,
        sequence: body,
      });
    }
  });

  return results;
}

/**
 * Extract counterexample parameters from Halmos log entry
 * @param {string} logs - Log entry containing counterexample
 * @returns {string[]} Array of parameter assignments
 */
function getHalmosCounterexamples(logs: string): string[] {
  const lines = logs.split("\n");
  const counterexamples: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "Counterexample:") {
      capturing = true;
      continue;
    }
    if (capturing && trimmed.includes("=")) {
      counterexamples.push(trimmed);
    } else if (
      capturing &&
      (trimmed.includes("Symbolic test result:") || trimmed.includes("[FAIL]"))
    ) {
      break;
    }
  }

  return counterexamples;
}

/**
 * Extract test function name from Halmos log entry
 * @param {string} logs - Log entry
 * @param {number} counter - Fallback counter
 * @returns {string} Function name
 */
function getHalmosHeaders(logs: string, counter: number): string {
  const failMatch = logs.match(/\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/);
  return failMatch?.[1] || `temp_${counter}`;
}

/**
 * Convert HALMOS logs to Foundry test functions.
 * @param {string} logs - Raw HALMOS logs
 * @param {string} identifier - Test identifier/prefix
 * @param {VmParsingData} [vmData] - Optional VM parsing data
 * @returns {string} Generated Foundry test functions
 */
export function halmosLogsToFunctions(
  logs: string,
  identifier: string,
  vmData?: VmParsingData
): string {
  const propertySequences = getHalmosPropertyAndSequence(logs, vmData);

  if (propertySequences.length === 0) {
    return "// No failed properties found in Halmos logs";
  }

  return propertySequences
    .map((propSeq, index) => {
      const functionName = `test_${propSeq.brokenProperty.replace(
        /\W/g,
        "_"
      )}_${identifier}_${index}`;
      const sequences = Array.isArray(propSeq.sequence)
        ? propSeq.sequence
        : [propSeq.sequence];

      let functionBody = `function ${functionName}() public {\n`;
      functionBody += `    // Counterexample for: ${propSeq.brokenProperty}\n`;

      sequences.forEach((param) => {
        if (typeof param === "string" && param.includes("=")) {
          const [paramName, paramValue] = param.split("=").map((s) => s.trim());

          // Convert Halmos parameter format to Solidity
          let cleanParamName = paramName
            .replace(/^p_/, "")
            .replace(/_[a-f0-9]+_\d+$/, "");

          // Remove type suffix from parameter name (e.g., "a_bool" -> "a")
          cleanParamName = cleanParamName.replace(
            /_(?:bool|uint256|address|int256)$/,
            ""
          );

          const cleanValue = paramValue.replace(/^0x/, "");

          // Determine type based on parameter name patterns
          if (paramName.includes("_bool_")) {
            const boolValue = cleanValue === "01" ? "true" : "false";
            functionBody += `    bool ${cleanParamName} = ${boolValue};\n`;
          } else if (paramName.includes("_uint256_")) {
            functionBody += `    uint256 ${cleanParamName} = 0x${cleanValue};\n`;
          } else if (paramName.includes("_address_")) {
            functionBody += `    address ${cleanParamName} = 0x${cleanValue.padStart(
              40,
              "0"
            )};\n`;
          } else if (paramName.includes("_int256_")) {
            functionBody += `    int256 ${cleanParamName} = int256(0x${cleanValue});\n`;
          } else {
            // Default to uint256 for unknown types
            functionBody += `    uint256 ${cleanParamName} = 0x${cleanValue};\n`;
          }
        }
      });

      functionBody += `    \n    // Call the original function with counterexample values\n`;
      functionBody += `    // ${propSeq.brokenProperty}(/* add parameters here */);\n`;
      functionBody += `}`;

      return functionBody;
    })
    .join("\n\n");
}
