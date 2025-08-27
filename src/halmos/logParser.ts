import { type FuzzingResults, type PropertyAndSequence } from "../types/types";

let allLines: string[] = [];

export function extractCallStatement(line: string): string | null {
  const callStart = line.indexOf("CALL ");
  if (callStart === -1) return null;

  const functionMatch = line.match(/CALL\s+(\w+::[\w]+)\(/);
  if (!functionMatch) return null;

  const functionName = functionMatch[1];
  const openParenIndex = line.indexOf("(", callStart);
  if (openParenIndex === -1) return null;

  let parenCount = 1;
  let i = openParenIndex + 1;
  while (i < line.length && parenCount > 0) {
    if (line[i] === "(") parenCount++;
    else if (line[i] === ")") parenCount--;
    i++;
  }

  if (parenCount === 0) {
    const params = line.substring(openParenIndex + 1, i - 1);
    return `CALL ${functionName}(${params})`;
  }

  return null;
}

export function processHalmos(line: string, jobStats: FuzzingResults): void {
  allLines.push(line);

  if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
    jobStats.failed++;
  } else if (line.includes("[PASS]")) {
    jobStats.passed++;
  }

  if (line.includes("Running") && line.includes("tests for")) {
    const testCountMatch = line.match(/Running (\d+) tests/);
    if (testCountMatch) {
      jobStats.numberOfTests = parseInt(testCountMatch[1]);
    }
  }

  if (line.includes("[FAIL]") || line.includes("[TIMEOUT]")) {
    const logsText = allLines.join("\n");
    const propertySequences = getHalmosPropertyAndSequence(logsText);

    propertySequences.forEach((propSeq) => {
      const exists = jobStats.brokenProperties.some(
        (existing) => existing.brokenProperty === propSeq.brokenProperty
      );
      if (!exists) {
        const sequenceString = Array.isArray(propSeq.sequence)
          ? propSeq.sequence.join("\n")
          : propSeq.sequence;
        jobStats.brokenProperties.push({
          brokenProperty: propSeq.brokenProperty,
          sequence: sequenceString,
        });
      }
    });
  }

  if (line.includes("Counterexample:")) {
    allLines = [line];
  }

  if (line.trim()) {
    jobStats.traces.push(line.trim());
  }
}

export function getHalmosPropertyAndSequence(
  logs: string
): PropertyAndSequence[] {
  const results: PropertyAndSequence[] = [];
  const lines = logs.split("\n");

  let currentCounterexample: string[] = [];
  let currentSequenceCalls: string[] = [];
  let capturing = false;
  let capturingSequence = false;
  let currentCall = "";
  let currentProperty = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const failMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(line);
    if (failMatch) {
      currentProperty = failMatch[1].trim();
    }

    const assertionFailMatch =
      /Assertion failure detected in \w+\.(.+?)\(\)/.exec(line);
    if (assertionFailMatch) {
      currentProperty = assertionFailMatch[1].trim();
    }

    if (line === "Counterexample:" || line.includes("Counterexample:")) {
      capturing = true;
      capturingSequence = false;
      currentCounterexample = [];
      currentSequenceCalls = [];
      currentCall = "";
      continue;
    }

    if (line === "Sequence:" || line.includes("Sequence:")) {
      capturingSequence = true;
      currentCall = "";
      continue;
    }

    if (capturing) {
      const isEndCondition =
        line.includes("[FAIL]") ||
        line.includes("[TIMEOUT]") ||
        line.includes("Symbolic test result:") ||
        (currentProperty && i === lines.length - 1);

      if (isEndCondition) {
        if (currentCall && capturingSequence) {
          const callMatch = extractCallStatement(currentCall);
          if (callMatch) {
            currentSequenceCalls.push(callMatch);
          }
        }

        let propertyName = currentProperty;
        if (!propertyName) {
          const propertyMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(
            line
          );
          if (propertyMatch) {
            propertyName = propertyMatch[1].trim();
          }
        }

        if (propertyName && currentCounterexample.length > 0) {
          const combinedSequence = [
            ...currentCounterexample,
            ...currentSequenceCalls,
          ];
          results.push({
            brokenProperty: propertyName,
            sequence: combinedSequence,
          });
        }
        capturing = false;
        capturingSequence = false;
        currentCounterexample = [];
        currentSequenceCalls = [];
        currentCall = "";
        currentProperty = "";
      } else if (capturingSequence && line.startsWith("CALL ")) {
        if (currentCall) {
          const callMatch = extractCallStatement(currentCall);
          if (callMatch) {
            currentSequenceCalls.push(callMatch);
          }
        }
        currentCall = line;
      } else if (
        capturingSequence &&
        currentCall &&
        !line.startsWith("    CALL ") &&
        !line.startsWith("        ") &&
        line.trim() &&
        !line.includes("[FAIL]") &&
        !line.includes("[TIMEOUT]")
      ) {
        if (line.includes(")") || line.includes(",") || line.includes("p_")) {
          currentCall += " " + line.trim();
        }
      } else if (
        capturingSequence &&
        currentCall &&
        (line.includes("(value:") ||
          line.includes("(caller:") ||
          line.startsWith("halmos_msg_"))
      ) {
        continue;
      } else if (
        capturingSequence &&
        line.startsWith("    ") &&
        (line.includes("SLOAD") ||
          line.includes("SSTORE") ||
          line.includes("STATICCALL") ||
          line.includes("CREATE") ||
          line.includes("↩ RETURN"))
      ) {
        continue;
      } else if (
        !capturingSequence &&
        line.includes("=") &&
        (line.startsWith("p_") ||
          line.includes("_uint256") ||
          line.includes("_address") ||
          line.includes("_bool") ||
          line.includes("halmos_"))
      ) {
        if (!line.includes("halmos_") || line.startsWith("p_")) {
          currentCounterexample.push(line);
        }
      } else if (
        !capturingSequence &&
        line.length > 0 &&
        !line.includes("=") &&
        currentCounterexample.length > 0
      ) {
        const lastParam =
          currentCounterexample[currentCounterexample.length - 1];
        if (lastParam.includes("=") && !lastParam.includes("0x")) {
          currentCounterexample[currentCounterexample.length - 1] =
            lastParam + line;
        }
      }
    }
  }

  return results;
}
