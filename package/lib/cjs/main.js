"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processLogs = void 0;
const types_1 = require("./types/types");
const index_1 = require("./echidna/index");
const index_2 = require("./medusa/index");
const utils_1 = require("./utils/utils");
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
const processLogs = (logs, tool) => {
    const jobStats = {
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
        if (tool === types_1.Fuzzer.MEDUSA) {
            (0, index_2.processMedusa)(line, jobStats);
        }
        else if (tool === types_1.Fuzzer.ECHIDNA) {
            (0, index_1.processEchidna)(line, jobStats);
        }
    });
    jobStats.traces = (0, utils_1.processTraceLogs)(jobStats.traces);
    return jobStats;
};
exports.processLogs = processLogs;
