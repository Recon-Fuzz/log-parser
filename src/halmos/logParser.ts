import { type FuzzingResults, type PropertyAndSequence } from "../types/types";

let allLines: string[] = [];

export function extractCallStatement(line: string): string | null {
  const callStart = line.indexOf("CALL");
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

    // Extract msg.value if present
    const valueMatch = line.match(/\(value:\s*([^)]+)\)/);
    const msgValue = valueMatch ? valueMatch[1].trim() : null;

    if (msgValue) {
      return `CALL ${functionName}(${params}) VALUE(${msgValue})`;
    }

    return `CALL ${functionName}(${params})`;
  }

  return null;
}

let hasAssertionFailure = false;

export function processHalmos(line: string, jobStats: FuzzingResults): void {
  allLines.push(line);

  // Track if we've seen an assertion failure in the logs
  if (line.includes("Assertion failure detected")) {
    hasAssertionFailure = true;
  }

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

  // Trigger extraction when we hit an end-of-run marker.
  // Always run extraction on summary lines; if there's nothing to extract, it’s a no-op.
  if (
    line.includes("[FAIL]") ||
    line.includes("[TIMEOUT]") ||
    (line.includes("[PASS]") && hasAssertionFailure) ||
    line.includes("Symbolic test result:")
  ) {
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

    if (line.includes("[PASS]") || line.includes("Symbolic test result:")) {
      hasAssertionFailure = false;
    }
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
  let foundFirstCounterexample = false;
  let callDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip counterexample if it's 'Counterexample: ∅'
    if (line === "Counterexample: ∅" || line.includes("Counterexample: ∅")) {
      capturing = false;
      currentCounterexample = [];
      currentSequenceCalls = [];
      capturingSequence = false;
      continue;
    }

    const failMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(line);
    if (failMatch) {
      currentProperty = failMatch[1].trim();
    }

    const assertionFailMatch =
      /Assertion failure detected in \w+\.(.+?)\(/.exec(line);
    if (assertionFailMatch) {
      currentProperty = assertionFailMatch[1].trim();
    }

    if (line.includes("Counterexample:")) {
      if (!foundFirstCounterexample) {
        capturing = true;
        capturingSequence = false;
        currentCounterexample = [];
        currentSequenceCalls = [];
        currentCall = "";
        foundFirstCounterexample = true;
      } else {
        // Skip subsequent counterexamples
        capturing = false;
        capturingSequence = false;
      }
      continue;
    }

    if (line.includes("Sequence:")) {
      capturingSequence = true;
      currentCall = "";
      callDepth = 0; // reset depth at the start of a new sequence
      continue;
    }

    // Check for end condition regardless of capturing state
    const isEndCondition =
      line.includes("[FAIL]") ||
      line.includes("[TIMEOUT]") ||
      line.includes("Symbolic test result:") ||
      (currentProperty && i === lines.length - 1) ||
      (currentProperty && line.includes("[PASS]"));

    if (isEndCondition || capturing) {
      if (isEndCondition) {
        if (currentCall && capturingSequence) {
          const callMatch = extractCallStatement(currentCall);
          if (callMatch) {
            currentSequenceCalls.push(callMatch);
          }
        }

        let propertyName = currentProperty;
        if (!propertyName) {
          const propertyMatch =
            /\[(?:FAIL|TIMEOUT|PASS)\]\s+(.+?)\s+\(paths:/.exec(line);
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
        foundFirstCounterexample = false;
      } else if (capturingSequence && line.startsWith("CALL")) {
        // Start accumulating a multi-line CALL statement
        currentCall = line;
        // Check if parentheses are balanced
        let openParens = (currentCall.match(/\(/g) || []).length;
        let closeParens = (currentCall.match(/\)/g) || []).length;
        while (openParens > closeParens && i + 1 < lines.length) {
          i++;
          const nextLine = lines[i].trim();
          currentCall += " " + nextLine;
          openParens = (currentCall.match(/\(/g) || []).length;
          closeParens = (currentCall.match(/\)/g) || []).length;
        }
        const callMatch = extractCallStatement(currentCall);
        if (callMatch) {
          const contractMatch = /CALL\s+([^:]+)::/.exec(callMatch);
          const contractName = contractMatch ? contractMatch[1] : "";
          if (contractName === "CryticToFoundry") {
            currentSequenceCalls.push(callMatch);
          }
        }
        callDepth++;
        currentCall = "";
      } else if (
        capturingSequence &&
        (line.startsWith("↩") || line.startsWith("\u21A9"))
      ) {
        callDepth = Math.max(0, callDepth - 1);
        continue;
      } else if (
        capturingSequence &&
        currentCall &&
        !line.startsWith("CALL") &&
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
        (line.includes("SLOAD") ||
          line.includes("SSTORE") ||
          line.includes("STATICCALL") ||
          line.includes("CREATE") ||
          line.includes("RETURN"))
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
        if (
          !line.includes("halmos_") ||
          line.startsWith("p_") ||
          line.startsWith("halmos_msg_value_")
        ) {
          // Only capture parameters if we're in the first counterexample
          if (capturing && foundFirstCounterexample) {
            currentCounterexample.push(line);
          }
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
