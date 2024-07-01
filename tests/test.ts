// TODO 0XSI
// Set up basic regression tests
import fs from "fs";
import { processLogs } from "../src/index";
import { Fuzzer } from "../src/types/types";




const dataEchidna = fs.readFileSync("./tests/test_data/echidna.txt", "utf8");

const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
console.log(jobStatsEchidna)

describe("Testing fuzz results for", () => {
  describe("Medusa fuzzer", () => {
    const dataMedusa = fs.readFileSync("./tests/test_data/medusa.txt", "utf8");
    const jobStatsMedusa = processLogs(dataMedusa, Fuzzer.MEDUSA);
    console.log(jobStatsMedusa)
    test("Medusa fuzzing duration", () => {
      expect(jobStatsMedusa.duration).toBe("4h0m0s");
    });

    test("Medusa coverage", () => {
      expect(jobStatsMedusa.coverage).toBe("26");
    });

    test("Medusa failed", () => {
      expect(jobStatsMedusa.failed).toBe("3 test(s) failed");
    });

    test("Medusa passed", () => {
      expect(jobStatsMedusa.passed).toBe("14 test(s) passed");
    });

    test("Results array should be the length of failed + passed", () => {
      expect(jobStatsMedusa.results.length).toBe(17); // 14 passed + 3 failed
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
})
