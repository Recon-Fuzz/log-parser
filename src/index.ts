import { Fuzzer, type FuzzingResults } from "./types/types";
import { _processEchidna } from "./echidna";
import { _processMedusa } from "./medusa";
import { _processTraceLogs } from "./utils/utils";

export const processLogs = (logs: string, tool: string): FuzzingResults => {
  const jobStats: FuzzingResults = {
    duration: "",
    coverage: "",
    failed: 0,
    passed: 0,
    results: [],
    traces: [],
    brokenProperties: [],
  };

  const lines = logs.split("\n");
  console.log("tool", tool)
  lines.forEach((line) => {
    if (tool === Fuzzer.MEDUSA) {
      _processMedusa(line, jobStats);
    } else if (tool === Fuzzer.ECHIDNA) {
      _processEchidna(line, jobStats);
    }
  });

  jobStats.traces = _processTraceLogs(jobStats.traces);
  return jobStats;
};
