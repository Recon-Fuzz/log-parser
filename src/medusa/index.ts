import {
  FuzzingResults,
  PropertyAndSequence,
  VmParsingData,
} from "../types/types";
import {
  captureFuzzingDuration,
  formatAddress,
  formatBytes,
} from "../utils/utils";
//////////////////////////////////////
//          MEDUSA                  //
//////////////////////////////////////

let medusaTraceLogger = false;
let medusaTraceLoggerFlag = false;
let currentBrokenPropertyMedusa = "";
let resultsLogger = false;
/**
 * The function `processMedusa` parses and extracts information from a given line
 * of text to update job statistics and log results for a Medusa testing job.
 * @param {string} line - The function `processMedusa` takes in two parameters:
 * `line` and `jobStats`.
 * @param {FuzzingResults} jobStats - The function `processMedusa` takes in two
 * parameters: `line` of type string and `jobStats` of type `FuzzingResults`.
 */
export function processMedusa(line: string, jobStats: FuzzingResults): void {
  if (line.includes("Test for method")) {
    medusaTraceLogger = true;
  }
  if (line.includes("fuzz: elapsed:")) {
    jobStats.duration =
      captureFuzzingDuration(line.replace("fuzz: elapsed:", "")) ?? ""; // TODO 0XSI - fix this
    const coverageMatch = line.match(/coverage: (\d+)/);
    if (coverageMatch) {
      jobStats.coverage = +coverageMatch[1];
    }
  } else if (line.includes("Test summary:")) {
    const passedMatch = line.match(/(\d+ test\(s\) passed)/);
    const failedMatch = line.match(/(\d+ test\(s\) failed)/);
    if (passedMatch) {
      jobStats.passed = +passedMatch[1].split(" test(s)")[0];
    }
    if (failedMatch) {
      jobStats.failed = +failedMatch[1].split(" test(s)")[0];
    }
  } else if (line.includes("Fuzzer stopped, test results follow below ...")) {
    resultsLogger = true;
  } else if (line.includes("[PASSED]") && resultsLogger) {
    if (!jobStats.results.includes(line)) jobStats.results.push(line);
  } else if (line.includes("[FAILED]") && resultsLogger) {
    if (!jobStats.results.includes(line)) jobStats.results.push(line);
  } else if (medusaTraceLogger) {
    const res = /for method ".*\.(?<name>[a-zA-Z_0-9]+)\(.*\)"/.exec(line);
    const brokenProp = res?.groups?.name ? res.groups.name : "";

    if (brokenProp !== "" || currentBrokenPropertyMedusa !== "") {
      if (brokenProp !== "") {
        currentBrokenPropertyMedusa = brokenProp;
      }

      const existingProperty = jobStats.brokenProperties.find(
        (el) => el.brokenProperty === currentBrokenPropertyMedusa
      );
      if (!existingProperty) {
        jobStats.brokenProperties.push({
          brokenProperty: currentBrokenPropertyMedusa,
          sequence: `${line}\n`,
        });
      } else {
        if (!existingProperty.sequence.includes("---End Trace---")) {
          existingProperty.sequence += `${line}\n`;
        }
      }
    }

    jobStats.traces.push(line);

    if (line.includes("[return (false)]")) {
      medusaTraceLoggerFlag = true;
    }

    if (
      line.includes("panic: assertion failed") ||
      (medusaTraceLoggerFlag && line.trim() === "") ||
      line.includes("Property Test Execution Trace")
    ) {
      medusaTraceLogger = false;
      medusaTraceLoggerFlag = false;

      if (line.includes("panic: assertion failed")) {
        jobStats.traces.push("");
      }

      jobStats.traces.push("---End Trace---");

      const existingProperty = jobStats.brokenProperties.find(
        (el) => el.brokenProperty === currentBrokenPropertyMedusa
      );
      if (
        existingProperty &&
        !existingProperty.sequence.includes("---End Trace---")
      ) {
        existingProperty.sequence += `---End Trace---\n`;
      }
      currentBrokenPropertyMedusa = "";
    }
  }
}

/**
 * The function `getPropertyAndSequenceString` processes logs to extract property
 * and sequence information based on certain conditions.
 * @param {string} logs - The `logs` parameter is a string containing log entries
 * that may include information about failed or passed tests.
 * @param {VmParsingData} [vmData] - The `vmData` parameter is an optional object
 * that contains data related to Virtual Machine (VM) parsing. It is used in the
 * `getPropertyAndSequenceString` function to assist in parsing logs and extracting
 * function calls. If provided, it helps in parsing function calls with VM-specific
 * information.
 * @returns The function `getPropertyAndSequenceString` returns an array of
 * objects, where each object contains two properties: `brokenProperty` and
 * `sequence`.
 */
export function getPropertyAndSequenceString(
  logs: string,
  vmData?: VmParsingData
): PropertyAndSequence[] {
  const splitted = logs
    .split("[FAILED]")
    .filter((entry) => !entry.includes("[PASSED]"))
    .filter((entry) => !entry.includes("[FAILED]"))
    .filter((entry) => entry.trim() != "");
  const bodies = splitted.map((entry) =>
    vmData
      ? getFunctionCallsWithVM(entry, vmData)
      : getFunctionCalls(entry).map((body) => body.replace(" (block=", ";"))
  );
  const headers = splitted.map((entry, counter) => getHeaders(entry, counter));
  if (bodies.length != headers.length) {
    throw Error("oops");
  }

  return headers.map((brokenProperty, counter) => ({
    brokenProperty,
    sequence: bodies[counter],
  }));
}
/**
 * The function `getFunctionCallsWithVM` parses logs to extract function calls and
 * format data, optionally applying virtual machine actions based on provided data.
 * @param {string} logs - The `logs` parameter in the `getFunctionCallsWithVM`
 * function is a string that contains information about function calls in a
 * specific format. The function uses a regular expression pattern to extract
 * function calls from this string.
 * @param {VmParsingData} [vmData] - The `vmData` parameter in the
 * `getFunctionCallsWithVM` function is an optional parameter of type
 * `VmParsingData`. It is used to provide additional data for parsing the logs.
 * This parameter can contain information such as `roll`, `time`, and `prank`
 * properties which are
 * @returns The function `getFunctionCallsWithVM` returns an array of strings that
 * represent function calls extracted from the provided `logs` string.
 */
export function getFunctionCallsWithVM(
  logs: string,
  vmData?: VmParsingData
): string[] {
  const pattern: RegExp =
    /([\w.]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)\(?([^()]*)\)?\s+\(block=\d*,\s*time=\d*,\s*gas=\d*,\s*gasprice=\d*,\s*value=\d*,\s*sender=0x[0-9a-fA-F]{40}\)/gm;
  const matches: RegExpMatchArray | null = logs.match(pattern);

  const functionCalls = matches?.map((entry) => {
    let returnData = "";
    let cleanedData = "";
    const splittedEntry = entry.split(" (block=")[0];
    // Format addresses
    cleanedData += formatAddress(splittedEntry);
    // Format bytes by adding hex"".
    cleanedData = formatBytes(cleanedData);
    const pattern = /(\w+\.\w+)\([^)]+\)\(([^)]*)\)/g;
    const patternArrayParams = /\(([^()]+)\)/;
    const emptyArrayPattern = /\(\[\]\)/;

    // Check for uncommon scenarios like: ((hex"address",uint256)[])([])
    if (cleanedData.includes("((")) {
      // Remove the content inside the first set of parentheses and replace it with an empty string
      cleanedData = cleanedData.replace(patternArrayParams, '');

      // Remove the extra '([])' from the second set of parentheses
      cleanedData = cleanedData.replace(emptyArrayPattern, '');
    } else {
      // For common cases like: check_liquidation_solvency()();
      cleanedData = cleanedData.replace(pattern, "$1($2)");
    }

    if (vmData) {
      //@ts-ignore
      const block = parseInt(entry.match(/block=(\d+)/)[1]);
      //@ts-ignore
      const time = parseInt(entry.match(/time=(\d+)/)[1]);
      const sender = entry.match(/sender=(0x[0-9a-fA-F]{40})/)
        ? //@ts-ignore
          entry.match(/sender=(0x[0-9a-fA-F]{40})/)[1]
        : "";
      if (vmData.roll) {
        returnData += `\n   vm.roll(${block});`;
      }
      if (vmData.time) {
        returnData += `\n   vm.warp(${time});`;
      }
      if (vmData.prank) {
        returnData += `\n   vm.prank(${sender});`;
      }
      returnData += cleanedData;
    } else {
      returnData = cleanedData;
    }
    return returnData;
  }) as string[];
  return functionCalls || [];
}

// Grab the Function calls, without block etc...
// TODO: Add a way to track the ones we're unable to scrape
/**
 * The function `getFunctionCalls` extracts function calls from a log string in
 * TypeScript using a regular expression pattern.
 * @param {string} logs - Logs is a string containing information about function
 * calls in a specific format. The function `getFunctionCalls` uses a regular
 * expression pattern to extract function calls from the logs. The pattern looks
 * for word characters followed by parentheses containing any characters except
 * closing parentheses, followed by "(block=".
 * @returns An array of strings containing the function calls extracted from the
 * input logs string.
 */
export function getFunctionCalls(logs: string): string[] {
  const pattern: RegExp = /\b(\w+)\(([^)]*)\)\s+\(block=/gm;
  const matches: RegExpMatchArray | null = logs.match(pattern);

  const functionCalls = matches?.map((entry) => entry.toString()) as string[];
  return functionCalls;
}

// Grab the Headers from split log
/**
 * The function `getHeaders` extracts a method name from a log string or returns a
 * default name based on a counter.
 * @param {string} logs - The `logs` parameter is a string that likely contains
 * information about method calls, specifically looking for a method name within
 * quotes following the phrase "for method".
 * @param {number} counter - The `counter` parameter is a number that is used as a
 * fallback value in case the regular expression does not match any method name in
 * the `logs` string.
 * @returns The function `getHeaders` takes in a `logs` string and a `counter`
 * number as parameters. It then uses a regular expression to extract a method name
 * from the `logs` string. If a method name is found, it returns that name.
 * Otherwise, it returns a string `temp_`.
 */
export function getHeaders(logs: string, counter: number): string {
  const res = /for method ".*\.(?<name>[a-zA-Z_0-9]+)\(.*\)"/.exec(logs);

  return res?.groups?.name ? res.groups.name : `temp_${counter}`;
}

/**
 * medusaLogsToFunctions function takes Medusa logs, extracts relevant data, and
 * generates functions based on the extracted information.
 * @param {string} logs - The `medusaLogsToFunctions` function takes in three
 * parameters:
 * @param {string} identifier - The `identifier` parameter is a string that will be
 * used as part of the function names generated by the `medusaLogsToFunctions`
 * function. It helps differentiate the generated functions based on the identifier
 * provided.
 * @param {VmParsingData} [vmData] - The `vmData` parameter in the
 * `medusaLogsToFunctions` function is of type `VmParsingData`. It is an optional
 * parameter that can be passed to the function. This parameter is used in the
 * `getPropertyAndSequenceString` function to parse the logs and extract property
 * and sequence information
 * @returns The function `medusaLogsToFunctions` returns a string that includes
 * generated test functions based on the input logs, identifier, and optional
 * vmData.
 */
export function medusaLogsToFunctions(
  logs: string,
  identifier: string,
  vmData?: VmParsingData
): string {
  let withoutExtraLogs;

  // Scrape for entire logs
  withoutExtraLogs = logs.split(
    "Fuzzer stopped, test results follow below ..."
  )[1]; // Get it and drop the prev

  // Try your best if they just paste stuff
  if (withoutExtraLogs === undefined) {
    withoutExtraLogs = logs;
  }
  // Splitted
  // headers
  const testsToBuild = getPropertyAndSequenceString(withoutExtraLogs, vmData);
  const filtered = testsToBuild.filter((entry) =>
    Array.isArray(entry.sequence)
  );
  const unableToProcess = testsToBuild.filter(
    (entry) => !Array.isArray(entry.sequence)
  );

  const unableString = unableToProcess
    .map(
      (entry) => `
/// NOTE: Unable to process ${entry.brokenProperty}
    `
    )
    .join("\n");

  const asStrings = filtered
    .map(
      (test) => `
function test_${test.brokenProperty}_${identifier}() public {
  ${
    // @ts-expect-error | We filtered above for the ones we can't process
    test.sequence.join("\n  ")
  }
}
		`
    )
    .join("\n");

  return unableString + asStrings;
}
