import { FuzzingResults, VmParsingData } from "../types/types";
/**
 * The processEchidna function processes log lines to extract job statistics and traces for fuzzing results.
 * @param {string} line - The `processEchidna` function processes a line of text
 * from a log file generated during fuzzing and updates the `jobStats` object
 * @param {FuzzingResults} jobStats - The `jobStats` parameter in the
 * `processEchidna` function is an object of type `FuzzingResults`. It contains
 * various properties to store information related to the fuzzing job being
 * processed.
 */
export declare function processEchidna(line: string, jobStats: FuzzingResults): void;
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
export declare function echidnaLogsToFunctions(input: string, prefix: string, brokenProp?: string, vmData?: VmParsingData): string;
