import { Fuzzer, type FuzzingResults } from "./types/types";
/**
 * The `processLogs` function processes logs based on the specified tool (Medusa or
 * Echidna) and returns fuzzing results.
 * @param {string} logs - A string containing logs generated during the fuzzing
 * process.
 * @param {Fuzzer} tool - The `tool` parameter in the `processLogs` function is
 * expected to be of type `Fuzzer`. It is used to determine which fuzzer tool was
 * used to generate the logs and then process the logs accordingly. The function
 * checks if the `tool` is equal to `Fuzzer.MED
 * @returns The `processLogs` function returns a `FuzzingResults` object containing
 * information about the fuzzing job, such as duration, coverage, number of failed
 * and passed tests, results, traces, and broken properties.
 */
export declare const processLogs: (logs: string, tool: Fuzzer) => FuzzingResults;
