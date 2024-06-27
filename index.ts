// TODO 0XSI
// This will have to be a package ultimately but for now it's a helper function
import { toChecksumAddress } from 'ethereumjs-util';

import type { FuzzingResults, PropertyAndSequence, VmParsingData } from "./types/types";

//////////////////////////////////////
//          MEDUSA                  //
//////////////////////////////////////
let medusaTraceLogger = false;
let medusaTraceLoggerFlag = false;
let recording = false;
export function _processMedusa(line: string, jobStats: FuzzingResults): void {
  if (line.includes("Fuzzer stopped, test results follow below ...")) {
    recording = true;
  }

  if (line.includes("Test for method")) {
    medusaTraceLogger = true;
  }
  if (line.includes("fuzz: elapsed:")) {
    jobStats.duration = captureFuzzingDuration(
      line.replace("fuzz: elapsed:", "")
    );
    const coverageMatch = line.match(/coverage: (\d+)/);
    if (coverageMatch) {
      jobStats.coverage = coverageMatch[1];
    }
  } else if (line.includes("Test summary:")) {
    const passedMatch = line.match(/(\d+ test\(s\) passed)/);
    const failedMatch = line.match(/(\d+ test\(s\) failed)/);
    if (passedMatch) {
      jobStats.passed = passedMatch[1];
    }
    if (failedMatch) {
      jobStats.failed = failedMatch[1];
    }
  } else if (line.includes("[PASSED]") || line.includes("[FAILED]")) {
    jobStats.results.push(line);
  } else if ((medusaTraceLogger && recording)) {
    // This is a unique string that indicates when a sequence will be shown
    jobStats.traces.push(line);

    // medusaTraceLoggerFlag is used to indicate when a trace log is detected
    // For a property the `[return (false)]` is the expected format
    // but this MUST be followed by an empty line for it to conform to the expected trace
    if (line.includes("[return (false)]")) {
      medusaTraceLoggerFlag = true;
    }

    // Once the end of the trace is reached we set the logger to false again
    if (
      line.includes("panic: assertion failed") ||
      (medusaTraceLoggerFlag && line == "")
    ) {
      medusaTraceLogger = false;
      medusaTraceLoggerFlag = false;
      // If the trace ends, let's add an emtpy line
      if (line.includes("panic: assertion failed")) {
        jobStats.traces.push("");
      }

      jobStats.traces.push("---End Trace---");
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
      const block = parseInt(entry.match(/block=(\d+)/)[1]);
      const time = parseInt(entry.match(/time=(\d+)/)[1]);
      const sender = entry.match(/sender=(0x[0-9a-fA-F]{40})/)
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


//////////////////////////////////////
//          ECHIDNA                 //
//////////////////////////////////////
let echidnaTraceLogger = false;
let echidnaSequenceLogger = false;
export function _processEchidna(line: string, jobStats: FuzzingResults): void {
  if (line.includes("[status] tests:")) {
    const durationMatch = line.match(/fuzzing: (\d+\/\d+)/);
    const coverageMatch = line.match(/cov: (\d+)/);
    const failedMatch = line.match(/tests: (\d+)\//);
    const passedMatch = line.match(/\/(\d+), fuzzing:/);

    if (durationMatch) {
      jobStats.duration = durationMatch[1];
    }
    if (coverageMatch) {
      jobStats.coverage = coverageMatch[1];
    }
    if (failedMatch && passedMatch) {
      const failed = parseInt(failedMatch[1]);
      const total = parseInt(passedMatch[1]);
      const passed = total - failed;
      jobStats.failed = `${failed}`;
      jobStats.passed = `${passed}`;
    }
  } else {
    const sequenceMatch = line.includes("Call sequence");
    if (sequenceMatch) {
      echidnaSequenceLogger = true;
    }
    const tracesMatch = line.includes("Traces:");
    if (tracesMatch) {
      echidnaTraceLogger = true;
    }

    if (line === "" && echidnaTraceLogger) {
      echidnaTraceLogger = false;
      echidnaSequenceLogger = false;
      jobStats.traces.push("---End Trace---");
    }
    if (echidnaSequenceLogger || echidnaTraceLogger) {
      jobStats.traces.push(line);
    }
  }
}

export function echidnaLogsToFunctions(
  input: string,
  prefix: string,
  vmData?: VmParsingData
): string {
  const callSequenceMatches =
    input.match(/Call sequence(?=:|,)(?=shrinking .*:)?(.+?)\n\n/gs) || [];
  return callSequenceMatches
    .map((test: string, i: number) => {
      let updated = test
        .trim()
        .replaceAll(")", ");")
        .replace(
          "Call sequence",
          `function test_prefix_${i}_${prefix}() public {`
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

      if (vmData) {
        const blockMatch = line.match(/Block delay:\s*(\d+)/);
        const block = blockMatch ? parseInt(blockMatch[1]) : null;

        const timeMatch = line.match(/Time delay:\s*(\d+)/);
        const time = timeMatch ? parseInt(timeMatch[1]) : null;

        const senderMatch = line.match(/from:\s*(0x[0-9a-fA-F]{40})/);
        const sender = senderMatch ? senderMatch[1] : null;

        if (vmData.roll && block) {
          returnData += `\n     vm.roll(${block});`;
        }
        if (vmData.time && time) {
          returnData += `\n     vm.warp(${time});`;
        }
        if (vmData.prank && sender) {
          returnData += `\n     vm.prank(${sender});`;
        }
        returnData += `\n ${line.split(";")[0]};`;
      } else {
        returnData = `  ${line.split(";")[0]};`;
      }
      return returnData;
    })
    .join("\n");
}

//////////////////////////////////////
//          UTILS                   //
//////////////////////////////////////
export function _processTraceLogs(logs: string[]): string[] {
  const result: string[] = [];
  let currentItem: string = "";

  for (const log of logs) {
    if (!log.includes("---End Trace---")) {
      currentItem += log + "\n";
    } else {
      result.push(currentItem.trim());
      currentItem = "";
    }
  }

  // Add any remaining logs if they don't end with "End trace"
  if (currentItem.trim().length > 0) {
    result.push(currentItem.trim());
  }

  return result;
}

export const processLogs = (logs: string, tool: string): FuzzingResults => {
  const jobStats: FuzzingResults = {
    duration: "",
    coverage: "",
    failed: "jobStats pending",
    passed: "jobStats pending",
    results: [],
    traces: [],
  };

  const lines = logs.split("\n");

  lines.forEach((line) => {
    if (tool === "MEDUSA") {
      _processMedusa(line, jobStats);
    } else if (tool === "ECHIDNA") {
      _processEchidna(line, jobStats);
    }
  });

  jobStats.traces = _processTraceLogs(jobStats.traces);
  return jobStats;
};

function captureFuzzingDuration(line: string): string | null {
  const pattern = /\b(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?\b/;
  const match = line.match(pattern);
  if (match) {
    return match[0];
  } else {
    return null;
  }
}

function correctChecksum(address: string): string {
  try {
    return toChecksumAddress(address);
  } catch (error) {
    return address; // Return the original address if it's invalid
  }
}

function correctAllChecksums(input: string): string {
  return input.replace(/0x[0-9a-fA-F]{40}/g, (match) => correctChecksum(match));
}

function formatAddress(input: string): string {
  let cleanedData = "";
  const potentialAddrUser = input.match(/0x[0-9a-fA-F]{40}/);
  if (potentialAddrUser) {
    cleanedData += `\n   ${correctAllChecksums(input)};`;
  } else {
    cleanedData += `\n   ${input};`;
  }
  return cleanedData;
}

function formatBytes(input: string): string {
  // Regular expression to match byte sequences (hexadecimal sequences without '0x' and not mistaken for Ethereum addresses)
  const potentialBytes = input.match(/\b(?!0x)(?=.*[a-fA-F])[0-9a-fA-F]{2,}\b/g);

  if (potentialBytes) {
    potentialBytes.forEach(byteSequence => {
      input = input.replace(byteSequence, `hex"${byteSequence}"`);
    });
  }
  return input;
}
