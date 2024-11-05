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
  const unescapedLogs = logs.replace(/\\n/g, '\n');
  const lines = unescapedLogs.split('\n');
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


// Call sequence:
// EchidnaForkTester.asserts_GENERAL_17() from: 0x0000000000000000000000000000000000030000 Time delay: 38059 seconds Block delay: 257
// EchidnaForkTester.asserts_test_fail() from: 0x0000000000000000000000000000000000020000 Time delay: 469057 seconds Block delay: 1424

// ---End Trace---
