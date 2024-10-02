import { FuzzingResults, VmParsingData } from "../types/types";
import { correctAllChecksums } from "../utils/utils";

//////////////////////////////////////
//          ECHIDNA                 //
//////////////////////////////////////
let echidnaTraceLogger = false;
let echidnaSequenceLogger = false;
let currentBrokenPropertyEchidna = "";
let prevLine = "";
/**
 * The processEchidna function processes log lines to extract job statistics and traces for fuzzing results.
 * @param {string} line - The `processEchidna` function processes a line of text
 * from a log file generated during fuzzing and updates the `jobStats` object
 * @param {FuzzingResults} jobStats - The `jobStats` parameter in the
 * `processEchidna` function is an object of type `FuzzingResults`. It contains
 * various properties to store information related to the fuzzing job being
 * processed.
 */
export function processEchidna(line: string, jobStats: FuzzingResults): void {
  if (line.includes(": passing") || line.includes(": failed!")) {
    jobStats.results.push(line);
  }
  if (line.includes(": passing")) {
    jobStats.passed++;
  }
  if (line.includes(": failed!")) {
    jobStats.failed++;
  }
  if (line.includes("[status] tests:")) {
    const durationMatch = line.match(/fuzzing: (\d+\/\d+)/);
    const coverageMatch = line.match(/cov: (\d+)/);

    if (durationMatch) {
      jobStats.duration = durationMatch[1];
    }
    if (coverageMatch) {
      jobStats.coverage = +coverageMatch[1];
    }
  } else {
    const sequenceMatch = line.includes("Call sequence");
    if (sequenceMatch) {
      echidnaSequenceLogger = true;
      if (!currentBrokenPropertyEchidna) {
        if (prevLine.includes("falsified!")) {
          const fasifieldMatch = prevLine.match(/Test\s+(.*?)\s+falsified!/);
          if (fasifieldMatch) {
            currentBrokenPropertyEchidna = fasifieldMatch[1];
          }
        } else {
          currentBrokenPropertyEchidna = prevLine.split(": failed!")[0];
        }
      }
    }

    currentBrokenPropertyEchidna = cleanUpBrokenPropertyName(
      currentBrokenPropertyEchidna
    );
    const tracesMatch = line.includes("Traces:");
    if (tracesMatch) {
      echidnaTraceLogger = true;
    }

    if (
      (line === "" && echidnaTraceLogger) ||
      line.includes("Saved reproducer") ||
      line.includes("Traces:") ||
      line.includes("[") || 
      line.includes("]")
    ) {
      echidnaTraceLogger = false;
      echidnaSequenceLogger = false;
      jobStats.traces.push("---End Trace---");

      const existingProperty = jobStats.brokenProperties.find(
        (el) => el.brokenProperty === currentBrokenPropertyEchidna
      );
      if (
        existingProperty &&
        !existingProperty.sequence.includes("---End Trace---")
      ) {
        existingProperty.sequence += `---End Trace---\n`;
      }
      currentBrokenPropertyEchidna = "";
    }

    if (echidnaSequenceLogger || echidnaTraceLogger) {
      jobStats.traces.push(line);

      const existingProperty = jobStats.brokenProperties.find(
        (el) => el.brokenProperty === currentBrokenPropertyEchidna
      );
      if (!line.includes("*wait* ")) {
        if (!existingProperty) {
          jobStats.brokenProperties.push({
            brokenProperty: currentBrokenPropertyEchidna,
            sequence: `${line}\n`,
          });
        } else {
          if (!existingProperty.sequence.includes("---End Trace---")) {
            existingProperty.sequence += `${line}\n`;
          }
        }
      }
    }
  }

  prevLine = line;
}

// Replace brokenProp() by brokenProp
// Also account to brokenProp(uint256) to brokenProp
function cleanUpBrokenPropertyName(brokenProp: string): string {
  return brokenProp.replace(/\(.*?\)/g, "");
}

/**
 * echidnaLogsToFunctions function converts echidna logs into Solidity functions with
 * specified prefixes and additional VM data.
 * @param {string} input - The `echidnaLogsToFunctions` function takes in three
 * parameters:
 * @param {string} prefix - The `prefix` parameter is a string that will be used as
 * part of the function name when converting echidna logs to functions. It will be
 * inserted into the function name template as `test_prefix__`
 * @param {VmParsingData} [vmData] - The `vmData` parameter is an optional object
 * of type `VmParsingData` that contains information used for parsing and
 * processing the input data.
 * @returns The function `echidnaLogsToFunctions` takes in an input string, a
 * prefix string, and an optional `vmData` object. It processes the input string to
 * extract call sequences, then transforms each call sequence into a function with
 * the specified prefix. It also handles some regex replacements and additional
 * processing based on the `vmData` object.
 */
export function echidnaLogsToFunctions(
  input: string,
  prefix: string,
  brokenProp?: string,
  vmData?: VmParsingData
): string {
  const callSequenceMatches =
    input.match(/Call sequence(?=:|,)(?=shrinking .*:)?(.+?)\n\n/gs) || [];
  return callSequenceMatches
    .map((test: string, i: number) => {
      let updated = test
        .trim()
        .replace(/\)/g, ");")
        .replace(
          "Call sequence",
          `function ${
            brokenProp
              ? `test_${brokenProp}${`_`+prefix}`
              : `test_prefix_${i}_${prefix}`
          }() public {`
        )
        // Fixing shitty regex
        .replace("{,", "{")
        .replace("{:", "{")
        .replace(/public \{ shrinking \d*\/\d*:\n/, "public {\n")
        .replace(/\w+\./g, "");
      updated += `\n}`;
      return updated;
    })
    .join("\n\n")
    .split("\n")
    .map((line) => {
      if (line.startsWith("function")) {
        return line;
      }
      let returnData = "";
      let cleanedData = line;

      if (line.split(" from")[0].includes("0x")) {
        const startLine = line.split(" from")[0];
        const endLine = line.split(" from")[1];
        cleanedData = correctAllChecksums(startLine) + endLine;
      }

      if (vmData) {
        const blockMatch = line.match(/Block delay:\s*(\d+)/);
        const block = blockMatch ? parseInt(blockMatch[1]) : null;

        const timeMatch = line.match(/Time delay:\s*(\d+)/);
        const time = timeMatch ? parseInt(timeMatch[1]) : null;

        const senderMatch = line.match(/from:\s*(0x[0-9a-fA-F]{40})/);

        const sender = senderMatch ? senderMatch[1] : null;
        if (vmData.roll && block) {
          returnData += `\n     vm.roll(block.number + ${block});`;
        }
        if (vmData.time && time) {
          returnData += `\n     vm.warp(block.timestamp + ${time});`;
        }
        if (vmData.prank && sender) {
          returnData += `\n     vm.prank(${sender});`;
        }
        if (cleanedData === "}") {
          returnData += `\n ${cleanedData}`;
        } else {
          returnData += `\n     ${cleanedData.split(";")[0]};`;
        }
      } else {
        returnData = `  ${cleanedData.split(";")[0]};`;
      }
      return returnData;
    })
    .join("\n");
}
