import fs from "fs";
import { processLogs } from "../src/index";
import { Fuzzer } from "../src/types/types";
import { medusaLogsToFunctions } from "../src/medusa";

describe("Testing fuzz results for", () => {
  describe("Medusa fuzzer", () => {
    const dataMedusa = fs.readFileSync("./tests/test_data/medusa.txt", "utf8");
    const jobStatsMedusa = processLogs(dataMedusa, Fuzzer.MEDUSA);
    test("Medusa fuzzing duration", () => {
      expect(jobStatsMedusa.duration).toBe("4h0m0s");
    });

    test("Medusa coverage", () => {
      expect(jobStatsMedusa.coverage).toBe(26);
    });

    test("Medusa failed", () => {
      expect(jobStatsMedusa.failed).toBe(3);
    });

    test("Medusa passed", () => {
      expect(jobStatsMedusa.passed).toBe(14);
    });

    test("Results array should be the length of failed + passed", () => {
      expect(jobStatsMedusa.results.length).toBe(jobStatsMedusa.failed + jobStatsMedusa.passed); // 14 passed + 3 failed
    })
    test("brokenProperties array should be the length of failed", () => {
      expect(jobStatsMedusa.brokenProperties.length).toBe(3);
    });
    test("All traces for broken properties should start with 'test for method' and end with ---End Trace---", () => {
      jobStatsMedusa.brokenProperties.forEach((el) => {
        expect(el.sequence.startsWith("Test for method")).toBe(true);
        expect(el.sequence.endsWith("---End Trace---\n")).toBe(true);
      })
    })
  })
  describe("Echidna fuzzer", () => {
    const dataEchidna = fs.readFileSync("./tests/test_data/echidna.txt", "utf8");
    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    console.log(jobStatsEchidna)
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
      expect(jobStatsEchidna.passed).toBe(15);
    });

    test("Results array should be the length of failed + passed", () => {
      expect(jobStatsEchidna.results.length).toBe(jobStatsEchidna.failed + jobStatsEchidna.passed); // 14 passed + 3 failed
    })
    test("brokenProperties array should be the length of failed", () => {
      expect(jobStatsEchidna.brokenProperties.length).toBe(jobStatsEchidna.failed);
    });
    test("All traces for broken properties should start with 'test for method' and end with ---End Trace---", () => {
      jobStatsEchidna.brokenProperties.forEach((el) => {
        expect(el.sequence.startsWith("  Call sequence:\n")).toBe(true);
        expect(el.sequence.endsWith("---End Trace---\n")).toBe(true);
      })
    })
  })

  describe("It should parse the bytes correctly", () => {
    const data = fs.readFileSync("./tests/test_data/medusa-bytes-parsing.txt", "utf8");
    const formattedData = processLogs(data, Fuzzer.MEDUSA);
    test("It should format the bytes correctly", () => {
      formattedData.brokenProperties.forEach(el => {
        const vmData = {
          roll: false,
          time: false,
          prank: false
        }
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes("hex")).toBe(true);
      })
    });
  });
})
