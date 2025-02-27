import fs from "fs";
import { processLogs } from "../src/main";
import { Fuzzer } from "../src/types/types";
import { medusaLogsToFunctions } from "../src/medusa/index";

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
      expect(jobStatsMedusa.results.length).toBe(
        jobStatsMedusa.failed + jobStatsMedusa.passed
      ); // 14 passed + 3 failed
    });
    test("brokenProperties array should be the length of failed", () => {
      expect(jobStatsMedusa.brokenProperties.length).toBe(3);
    });
    test("All traces for broken properties should start with 'test for method' and end with ---End Trace---", () => {
      jobStatsMedusa.brokenProperties.forEach((el) => {
        expect(el.sequence.startsWith("Test for method")).toBe(true);
        expect(el.sequence.endsWith("---End Trace---\n")).toBe(true);
      });
    });
  });

  describe("It should parse the bytes correctly", () => {
    const data = fs.readFileSync(
      "./tests/test_data/medusa-bytes-parsing.txt",
      "utf8"
    );
    const formattedData = processLogs(data, Fuzzer.MEDUSA);
    test("It should format the bytes correctly", () => {
      formattedData.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes("hex")).toBe(true);
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });

  describe("It should format the addresses correctly", () => {
    const addressData = fs.readFileSync(
      "./tests/test_data/medusa-address-parsing.txt",
      "utf8"
    );
    const vmData = {
      roll: false,
      time: false,
      prank: false,
    };
    expect(
      addressData.includes("0xffffffffffffffffffffffffffffffffffffffff")
    ).toBe(true);
    expect(
      addressData.includes("0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF")
    ).toBe(false);

    const format = medusaLogsToFunctions(addressData, "", vmData);
    expect(format.includes("0xffffffffffffffffffffffffffffffffffffffff")).toBe(
      false
    );
    expect(format.includes("0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF")).toBe(
      true
    );
  });

  describe("It should parse correctly the logs for Medusa 0.1.5 -- second test", () => {
    const dataMedusa = fs.readFileSync(
      "./tests/test_data/medusa-0.1.5.txt",
      "utf8"
    );
    const jobStatsMedusa = processLogs(dataMedusa, Fuzzer.MEDUSA);
    test("Medusa fuzzing duration", () => {
      expect(jobStatsMedusa.duration).toBe("11h59m56s");
    });
    test("Medusa coverage", () => {
      expect(jobStatsMedusa.coverage).toBe(12);
    });
    test("Expect right amount of test faield and passed", () => {
      expect(jobStatsMedusa.failed).toBe(2);
      expect(jobStatsMedusa.passed).toBe(81);
    })
    test("It format as expect", () => {
      jobStatsMedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: true,
          time: true,
          prank: true,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes(`test_${el.brokenProperty}_()`));
      });
      expect(jobStatsMedusa.brokenProperties.length).toBe(2);
      expect(
        jobStatsMedusa.brokenProperties[0].brokenProperty.includes(
          "check_the_overflow();"
        )
      );
      expect(
        jobStatsMedusa.brokenProperties[1].brokenProperty.includes(
          "check_liquidation_solvency();"
        )
      );
      expect(
        jobStatsMedusa.brokenProperties[1].brokenProperty.includes(
          "oracle2_setPrice_debt(71999513637761396317130899634986633);"
        )
      );
    });
    test("It should format correctly", () => {
      jobStatsMedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });

  describe("It should parse correctly the logs for Medusa 0.1.5", () => {
    const dataMedusa = fs.readFileSync(
      "./tests/test_data/medusa-0.1.5-2.txt",
      "utf8"
    );
    const jobStatsMedusa = processLogs(dataMedusa, Fuzzer.MEDUSA);
    test("Medusa fuzzing duration", () => {
      expect(jobStatsMedusa.duration).toBe("3h59m57s");
    });
    test("Medusa coverage", () => {
      expect(jobStatsMedusa.coverage).toBe(104);
    });
    test("Expect right amount of test faield and passed", () => {
      expect(jobStatsMedusa.failed).toBe(4);
      expect(jobStatsMedusa.passed).toBe(43);
    })
    test("It format as expect", () => {
      jobStatsMedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: true,
          time: true,
          prank: true,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes(`test_${el.brokenProperty}_()`));
      });
      expect(jobStatsMedusa.brokenProperties.length).toBe(4);
      expect(
        jobStatsMedusa.brokenProperties[0].brokenProperty.includes(
          "observe();"
        )
      );
      expect(
        jobStatsMedusa.brokenProperties[1].brokenProperty.includes(
          "liquidateCdps();"
        )
      );
    });
    test("It should format correctly", () => {
      jobStatsMedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });

  describe("Medusa fuzzer - 2", () => {
    const datamedusa = fs.readFileSync(
      "./tests/test_data/medusa-2.txt",
      "utf8"
    );
    const jobStatsmedusa = processLogs(datamedusa, Fuzzer.MEDUSA);
    test("Duration should be correct", () => {
      expect(jobStatsmedusa.duration).toBe("10m42s");
    })
    test("Coverage should be correct", () => {
      expect(jobStatsmedusa.coverage).toBe(40);
    });
    test("Failed should be correct", () => {
      expect(jobStatsmedusa.failed).toBe(1);
    });
    test("Passed should be correct", () => {
      expect(jobStatsmedusa.passed).toBe(18);
    });
    test("Results array should be the length of failed + passed", () => {
      expect(jobStatsmedusa.results.length).toBe(
        jobStatsmedusa.failed + jobStatsmedusa.passed
      );
    });
    test("broken property should have the correct length", () => {
      expect(jobStatsmedusa.brokenProperties.length).toBe(jobStatsmedusa.failed);
    })
    test("It should format correctly", () => {
      jobStatsmedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });

  describe("Medusa fuzzer - 3 - property should be part of the sequence", () => {
    const datamedusa = fs.readFileSync(
      "./tests/test_data/medusa-3.txt",
      "utf8"
    );
    const jobStatsmedusa = processLogs(datamedusa, Fuzzer.MEDUSA);
    test("It should format the bytes correctly", () => {
      jobStatsmedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });

  describe("Medusa fuzzer - 4 - problem with array as input", () => {
    // Ex: ((address,uint256)[])([])
    const datamedusa = fs.readFileSync(
      "./tests/test_data/medusa-4.txt",
      "utf8"
    );
    const jobStatsmedusa = processLogs(datamedusa, Fuzzer.MEDUSA);
    test("It should format params correctly", () => {
      jobStatsmedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes("([])")).toBe(true);
        expect(format.includes("((address,uint256)[])")).toBe(false);
      });
    });
  });
  describe("Medusa fuzzer - 5 - it should not include CryticTester and double () ()", () => {
    // Ex: CryticTester.oPTIMIZED_RelativeTwapWeightedObserver_observe()();
    const datamedusa = fs.readFileSync(
      "./tests/test_data/medusa-5.txt",
      "utf8"
    );
    const jobStatsmedusa = processLogs(datamedusa, Fuzzer.MEDUSA);
    test("It should format correctly", () => {
      jobStatsmedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes("CryticTester")).toBe(false);
        expect(!format.includes("()()")).toBe(true);
      });
    });
  });
  describe("Medusa fuzzer - 6 - it should format correctly", () => {
    // Ex:    governance_allocateLQTY_clamped_single_initiative(uint8,uint96,uint96)(123, 18044524858584422064056176436, 0);
    const datamedusa = fs.readFileSync(
      "./tests/test_data/medusa-6.txt",
      "utf8"
    );
    const jobStatsmedusa = processLogs(datamedusa, Fuzzer.MEDUSA);
    test("It should format correctly", () => {
      jobStatsmedusa.brokenProperties.forEach((el) => {
        const vmData = {
          roll: false,
          time: false,
          prank: false,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        expect(format.includes("CryticTester")).toBe(false);
        expect(!format.includes("()()")).toBe(true);
        expect(format.includes("(uint8,uint96,uint96)")).toBe(false);
        expect(format.includes("(uint8)")).toBe(false);
        expect(format.includes('(hex"address")')).toBe(false);
      });
    });
  });

  describe("Medusa fuzzer - 7 - it should format correctly", () => {
    // Parse compressed addresses correctly: 0x20000 should be ok
    const datamedusa = fs.readFileSync(
      "./tests/test_data/medusa-7.txt",
      "utf8"
    );
    const jobStatsmedusa = processLogs(datamedusa, Fuzzer.MEDUSA);
    test("It should format correctly", () => {
      jobStatsmedusa.brokenProperties.forEach((el, i) => {
        const vmData = {
          roll: true,
          time: true,
          prank: true,
        };
        const format = medusaLogsToFunctions(el.sequence, "", vmData);
        console.log("format --> \n", format)
        if (i === 0) {
          expect(format.includes("0x20000")).toBe(true);
          expect(format.includes("0x10000")).toBe(true);
        } else if (i === 1) {
          expect(format.includes("0x10000")).toBe(true);
        } else if (i === 2) {
          expect(format.includes("0x20000")).toBe(true);
        }
      });
    });
  });
  describe("Medusa fuzzzer - Should parse the number of tests correctly ", () => {
    const dataMedusa1 = fs.readFileSync("./tests/test_data/medusa.txt", "utf8");
    const jobStatsMedusa1 = processLogs(dataMedusa1, Fuzzer.MEDUSA);
    test("It should have the right number of tests", () => {
      expect(jobStatsMedusa1.numberOfTests).toBe(220728379);
    });

    const dataMedusa2 = fs.readFileSync("./tests/test_data/medusa-2.txt", "utf8");
    const jobStatsMedusa2 = processLogs(dataMedusa2, Fuzzer.MEDUSA);
    test("It should have the right number of tests", () => {
      expect(jobStatsMedusa2.numberOfTests).toBe(107754);
    });
  })
});
