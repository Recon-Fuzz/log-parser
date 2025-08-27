import { type PropertyAndSequence } from "../types/types";
import { getHalmosPropertyAndSequence } from "./logParser";
import { generateTestFunction } from "./functionGenerator";

// Re-export functions from modules
export { processHalmos, getHalmosPropertyAndSequence } from "./logParser";

/**
 * Generate a single test function from property name and sequence
 * Used by frontend for individual broken properties
 * This function works with individual sequences (similar to Medusa/Echidna approach)
 */
export function halmosSequenceToFunction(
  sequence: string,
  brokenProperty: string,
  identifier: string,
  index: number = 0
): string {
  // Parse the sequence string back to array format
  const sequenceArray = sequence
    .split("\n")
    .filter((line) => line.trim() !== "");
  const propSeq = { brokenProperty, sequence: sequenceArray };
  return generateTestFunction(propSeq, identifier, index);
}

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
