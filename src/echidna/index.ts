
import { FuzzingResults, VmParsingData } from "../types/types";

//////////////////////////////////////
//          ECHIDNA                 //
//////////////////////////////////////
let echidnaTraceLogger = false;
let echidnaSequenceLogger = false;
let currentBrokenPropertyEchidna = "";
let prevLine = "";
export function _processEchidna(line: string, jobStats: FuzzingResults): void {
  if (line.includes(": passing") || line.includes(": failed!")) {
    jobStats.results.push(line);
  }
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
      jobStats.failed = failed;
      jobStats.passed = passed;
    }
  } else {
    const sequenceMatch = line.includes("Call sequence");
    if (sequenceMatch) {
      echidnaSequenceLogger = true;
      if (!currentBrokenPropertyEchidna) {
        currentBrokenPropertyEchidna = prevLine.split(": failed!")[0];
      }
    }

    const tracesMatch = line.includes("Traces:");
    if (tracesMatch) {
      echidnaTraceLogger = true;
    }

    if (line === "" && echidnaTraceLogger) {
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

  prevLine = line;
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
