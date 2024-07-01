import { FuzzingResults, PropertyAndSequence, VmParsingData } from "../types/types";
import { captureFuzzingDuration, formatAddress, formatBytes } from "../utils/utils";
//////////////////////////////////////
//          MEDUSA                  //
//////////////////////////////////////

let medusaTraceLogger = false;
let medusaTraceLoggerFlag = false;
let currentBrokenPropertyMedusa = "";
let resultsLogger = false;
export function _processMedusa(line: string, jobStats: FuzzingResults): void {
  if (line.includes("Test for method")) {
    medusaTraceLogger = true;
  }
  if (line.includes("fuzz: elapsed:")) {
    jobStats.duration = captureFuzzingDuration(
      line.replace("fuzz: elapsed:", "")
    ) ?? ""; // TODO 0XSI - fix this
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
    jobStats.results.push(line);
  } else if (line.includes("[FAILED]") && resultsLogger) {
    jobStats.results.push(line);
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
      (medusaTraceLoggerFlag && line === "")
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

export function getFunctionCallsWithVM(
  logs: string,
  vmData?: VmParsingData
): string[] {
  const pattern: RegExp =
    /(\w+)\(([^)]*)\)\s+\(block=\d*, time=\d*, gas=\d*, gasprice=\d*, value=\d*, sender=\d*x\d*/gm;
  const matches: RegExpMatchArray | null = logs.match(pattern);

  //TODO 0XSI
  // Could be splited to be reusable by the log parser
  const functionCalls = matches?.map((entry) => {
    let returnData = "";
    let cleanedData = "";
    const splittedEntry = entry.split(" (block=")[0];
    // Format addresses
    cleanedData += formatAddress(splittedEntry);
    // Format bytes by adding hex"".
    cleanedData = formatBytes(cleanedData);

    if (vmData) {
      //@ts-ignore
      const block = parseInt(entry.match(/block=(\d+)/)[1]);
      //@ts-ignore
      const time = parseInt(entry.match(/time=(\d+)/)[1]);
      const sender = entry.match(/sender=(0x[0-9a-fA-F]{40})/)
      //@ts-ignore
        ? entry.match(/sender=(0x[0-9a-fA-F]{40})/)[1]
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
      returnData += cleanedData

    } else {
      returnData = cleanedData;
    }
    return returnData;
  }) as string[];

  return functionCalls || [];
}

// Grab the Function calls, without block etc...
// TODO: Add a way to track the ones we're unable to scrape
export function getFunctionCalls(logs: string): string[] {
  const pattern: RegExp = /\b(\w+)\(([^)]*)\)\s+\(block=/gm;
  const matches: RegExpMatchArray | null = logs.match(pattern);

  const functionCalls = matches?.map((entry) => entry.toString()) as string[];
  return functionCalls;
}

// Grab the Headers from split log
export function getHeaders(logs: string, counter: number): string {
  const res = /for method ".*\.(?<name>[a-zA-Z_0-9]+)\(.*\)"/.exec(logs);

  return res?.groups?.name ? res.groups.name : `temp_${counter}`;
}

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
