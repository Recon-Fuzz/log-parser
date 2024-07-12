import { Fuzzer, type FuzzingResults } from "./types/types";
import { processEchidna } from "./echidna/index"
import { processMedusa } from "./medusa/index";
import { processTraceLogs } from "./utils/utils";

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
export const processLogs = (logs: string, tool: Fuzzer): FuzzingResults => {
  const jobStats: FuzzingResults = {
    duration: "",
    coverage: 0,
    failed: 0,
    passed: 0,
    results: [],
    traces: [],
    brokenProperties: [],
  };

  const lines = logs.split("\n");

  lines.forEach((line) => {
    if (tool === Fuzzer.MEDUSA) {
      processMedusa(line, jobStats);
    } else if (tool === Fuzzer.ECHIDNA) {
      processEchidna(line, jobStats);
    }
  });

  jobStats.traces = processTraceLogs(jobStats.traces);
  return jobStats;
};
