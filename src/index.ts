import type { FuzzingResults } from "./types/types";
import { _processEchidna } from "./echidna";
import { _processMedusa } from "./medusa";
import { _processTraceLogs } from "./utils/utils";

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
