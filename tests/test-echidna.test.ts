import fs from "fs";
import { processLogs } from "../src/main";
import { Fuzzer } from "../src/types/types";
import { echidnaLogsToFunctions } from "../src/echidna";

describe("Testing fuzz results for", () => {
  describe("Echidna fuzzer - 1 ", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna.txt",
      "utf8"
    );
    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    test("Echidna fuzzing duration", () => {
      expect(jobStatsEchidna.duration).toBe("3h7m21s");
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
    jobStatsEchidna.brokenProperties.forEach((el) => {
      const vmData = {
        roll: false,
        time: false,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      test("it should have the correct format", () => {
        testFormat(format);
      })
      test("it should have clean traces", () => {
        testCleanTraces(el.sequence);
      })
      test("Format should include the broken property", () => {
        expect(format.includes(el.brokenProperty)).toBe(true);
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
      expect(jobStatsEchidna.duration).toBe("1h36s");
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
    jobStatsEchidna.brokenProperties.forEach((el, index) => {
      const vmData = {
        roll: true,
        time: true,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      if (index === 0) { // take a random one to test
        test("it should include block.number and block.timestamp", () => {
          expect(format.includes("block.number")).toBe(true);
          expect(format.includes("block.timestamp")).toBe(true);
        });
      }
      test("it should have the correct format", () => {
        testFormat(format);
      })
      test("it should have clean traces", () => {
        testCleanTraces(el.sequence);
      })
      test("Format should include the broken property", () => {
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });
  describe("Echidna fuzzer - 3 - Address casted as bytes", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna-3.txt",
      "utf8"
    );

    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    test("Duration should be correct", () => {
      expect(jobStatsEchidna.duration).toBe("1h1m23s");
    })
    jobStatsEchidna.brokenProperties.forEach((el) => {
      const vmData = {
        roll: false,
        time: false,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      test("it should have the correct format", () => {
        testFormat(format);
      })
      test("it should have clean traces", () => {
        testCleanTraces(el.sequence);
      })
      test("Format should include the broken property", () => {
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
      test("it should cast the address passed as bytes correctly", () => {
        expect(format.includes("0x1fffffffe")).toBe(false);
        expect(format.includes("0x00000000000000000000000000000001fffffffE")).toBe(true);
      });
    });
  });
  describe("Echidna fuzzer - 4 - Multiple test and callsequence in a single broken props should not happen", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna-4.txt",
      "utf8"
    );

    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    test("Duration should be correct", () => {
      expect(jobStatsEchidna.duration).toBe("15m54s");
    })
    jobStatsEchidna.brokenProperties.forEach((el, i) => {
      const vmData = {
        roll: false,
        time: false,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      test("it should have the correct format", () => {
        testFormat(format);
      })
      test("it should have clean traces", () => {
        testCleanTraces(el.sequence);
      })
      test("Format should include the broken property", () => {
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
    test("it should have the correct totaly of passed tests", () => {
      expect(jobStatsEchidna.passed).toBe(42);
    })
    test("it should have the correct totaly of failed tests", () => {
      expect(jobStatsEchidna.failed).toBe(29);
    })
  });
  describe("Echidna fuzzer - 5", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna-5.txt",
      "utf8"
    );

    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    jobStatsEchidna.brokenProperties.forEach((el, i) => {
      const vmData = {
        roll: false,
        time: false,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      if (el.brokenProperty === "property_sum_of_user_voting_weights") {
        expect(format.includes("governance_allocateLQTY([")).toBe(true);
      }
      test("it should have the correct format", () => {
        testFormat(format);
      })
      test("it should have clean traces", () => {
        testCleanTraces(el.sequence);
      })
      test("Format should include the broken property", () => {
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });
  describe("Echidna fuzzer - Should parse *wait* correctly", () => {
    const dataEchidna = fs.readFileSync(
      "./tests/test_data/echidna-6.txt",
      "utf8"
    );

    const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
    jobStatsEchidna.brokenProperties.forEach((el, i) => {
      const vmData = {
        roll: false,
        time: false,
        prank: false,
      };
      const format = echidnaLogsToFunctions(el.sequence, "", el.brokenProperty, vmData);
      if (i === 0) {
        expect(format.includes("vm.warp(block.timestamp + 613397);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 1);")).toBe(true);
      } else if (i === 1) {
        expect(format.includes("vm.warp(block.timestamp + 198541);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 92437);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 358061);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 201);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 83001);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 23276);")).toBe(true);
      } else if (i ===2 ) {
        expect(format.includes("vm.warp(block.timestamp + 562840);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 43315);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 835858);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 69439);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 867);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 32304);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 322316);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 37820);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 555653);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 896);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 273544);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 58181);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 835858);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 69439);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 927126);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 16204);")).toBe(true);
        expect(format.includes("vm.warp(block.timestamp + 488787);")).toBe(true);
        expect(format.includes("vm.roll(block.number + 37200);")).toBe(true);
      }
      test("it should have the correct format", () => {
        testFormat(format);
      })
      test("it should have clean traces", () => {
        testCleanTraces(el.sequence);
      })
      test("Format should include the broken property", () => {
        expect(format.includes(el.brokenProperty)).toBe(true);
      });
    });
  });
  describe("Echidna fuzzer - Should parse the number of tests correctly", () => {
    const dataEchidna1 = fs.readFileSync(
      "./tests/test_data/echidna.txt",
      "utf8"
    );
    const jobStatsEchidna1 = processLogs(dataEchidna1, Fuzzer.ECHIDNA);
    test("It should have the right number of tests", () => {
      expect(jobStatsEchidna1.numberOfTests).toBe(20000462);
    });

    const dataEchidna2 = fs.readFileSync(
      "./tests/test_data/echidna-2.txt",
      "utf8"
    );
    const jobStatsEchidna2 = processLogs(dataEchidna2, Fuzzer.ECHIDNA);
    test("It should have the right number of tests", () => {
      expect(jobStatsEchidna2.numberOfTests).toBe(1000511);
    });
  })
});

// Make sure we don't have multiple functions in the same broken prop function
function testFormat(format: string) {
  const firstCount = (format.match(/{/g) || []).length;
  expect(firstCount).toBe(1);
  const secondCount = (format.match(/}/g) || []).length;
  expect(secondCount).toBe(1);
}

//Make sure we only have 1 call sequence per broken property
function testCleanTraces(traces: string) {
  expect(traces.includes("---End Trace---")).toBe(true);
  const sequenceCount = (traces.match(/Call sequence:/g) || []).length;
  expect(sequenceCount).toBe(1);
}
