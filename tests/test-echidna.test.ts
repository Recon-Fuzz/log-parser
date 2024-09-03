import fs from "fs";
import { processLogs } from "../src/main";
import { Fuzzer } from "../src/types/types";
import { echidnaLogsToFunctions } from "../src/echidna";

describe("Testing fuzz results for", () => {
  describe("Echidna fuzzer", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna.txt",
      "utf8"
    );
    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    test("Echidna fuzzing duration", () => {
      expect(jobStatsEchidna.duration).toBe("20000462/20000000");
    });

    test("Echidna coverage", () => {
      expect(jobStatsEchidna.coverage).toBe(53367);
    });

    test("Echidna failed", () => {
      expect(jobStatsEchidna.failed).toBe(2);
    });

    test("Echidna passed", () => {
      expect(jobStatsEchidna.passed).toBe(14);
    });
    test("Results array should be the length of failed + passed", () => {
      expect(jobStatsEchidna.results.length).toBe(
        jobStatsEchidna.failed + jobStatsEchidna.passed
      ); // 14 passed + 2 failed
    });
    test("brokenProperties array should be the length of failed", () => {
      expect(jobStatsEchidna.brokenProperties.length).toBe(
        jobStatsEchidna.failed
      );
    });
    test("All traces for broken properties should start with 'test for method' and end with ---End Trace---", () => {
      jobStatsEchidna.brokenProperties.forEach((el) => {
        expect(el.sequence.startsWith("  Call sequence:\n")).toBe(true);
        expect(el.sequence.endsWith("---End Trace---\n")).toBe(true);
      });
    });
  });
  describe("Echidna fuzzer - 2", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna-2.txt",
      "utf8"
    );
    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    test("Duration should be correct", () => {
      expect(jobStatsEchidna.duration).toBe("1000511/1000000");
    })
    test("Coverage should be correct", () => {
      expect(jobStatsEchidna.coverage).toBe(42586);
    });
    test("Failed should be correct", () => {
      expect(jobStatsEchidna.failed).toBe(14);
    });
    test("Passed should be correct", () => {
      expect(jobStatsEchidna.passed).toBe(64);
    });
    test("Results array should be the length of failed + passed", () => {
      expect(jobStatsEchidna.results.length).toBe(
        jobStatsEchidna.failed + jobStatsEchidna.passed
      );
    });
    test("broken property should have the correct length", () => {
      expect(jobStatsEchidna.brokenProperties.length).toBe(jobStatsEchidna.failed);
    })
  });
  describe("Echidna fuzzer - 3 - Address casted as bytes", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna-3.txt",
      "utf8"
    );

    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    jobStatsEchidna.brokenProperties.forEach((el) => {
      const vmData = {
        roll: false,
        time: false,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      expect(format.includes(el.brokenProperty)).toBe(true);
      expect(format.includes("0x1fffffffe")).toBe(false);
      expect(format.includes("0x00000000000000000000000000000001fffffffE")).toBe(true);
    });
  });
});
