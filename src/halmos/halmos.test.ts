import {
  processHalmos,
  halmosLogsToFunctions,
  getHalmosPropertyAndSequence,
} from "./index";
import { FuzzingResults } from "../types/types";

describe("Halmos Parser", () => {
  let jobStats: FuzzingResults;

  beforeEach(() => {
    jobStats = {
      duration: "",
      coverage: 0,
      failed: 0,
      passed: 0,
      results: [],
      traces: [],
      brokenProperties: [],
      numberOfTests: 0,
    };
  });

  describe("processHalmos", () => {
    it("should parse simple failed test with counterexample", () => {
      const lines = [
        "[FAIL] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.33s, bounds: [])",
        "Counterexample:",
        "    p_a_bool_7b2a94e_00 = 0x00",
        "    p_b_bool_6c9fed6_00 = 0x00",
        "Symbolic test result: 0 passed; 1 failed; time: 0.34s",
      ];

      lines.forEach((line) => processHalmos(line, jobStats));

      expect(jobStats.failed).toBe(1);
      expect(jobStats.passed).toBe(0);
      expect(jobStats.numberOfTests).toBe(1);
      expect(jobStats.duration).toBe("0s");
      expect(jobStats.brokenProperties).toHaveLength(1);
      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "check_bool_xor_always_true(bool,bool)"
      );
      expect(jobStats.traces).toHaveLength(2); // 2 parameters (end marker added when next test starts)
    });

    it("should parse timeout test", () => {
      const lines = [
        "[TIMEOUT] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.11s, bounds: [])",
        "Timeout queries saved in: /var/folders/3_/mlyqmvxn3dx7v3f2xx3xmf3r0000gn/T/check_bool_xor_always_true-c8btwv0i-timeout",
        "Symbolic test result: 0 passed; 1 failed; time: 0.12s",
      ];

      lines.forEach((line) => processHalmos(line, jobStats));

      expect(jobStats.failed).toBe(1);
      expect(jobStats.passed).toBe(0);
      expect(jobStats.brokenProperties).toHaveLength(1);
      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "check_bool_xor_always_true(bool,bool)"
      );
    });

    it("should parse multiple failed tests", () => {
      const lines = [
        "[FAIL] check_uint_multiplication_bound(uint256,uint256) (paths: 3, time: 0.44s, bounds: [])",
        "Counterexample:",
        "    p_a_uint256_f73da65_00 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003",
        "    p_b_uint256_5ff3489_00 = 0x3ffffffffffff9",
        "[FAIL] check_struct_simple_invariant((uint256,bool)) (paths: 4, time: 0.12s, bounds: [])",
        "Counterexample:",
        "    p_s.flag_bool_0dc04dc_00 = 0x01",
        "    p_s.value_uint256_c1f0917_00 = 0x00",
        "Symbolic test result: 0 passed; 2 failed; time: 4.54s",
      ];

      lines.forEach((line) => processHalmos(line, jobStats));

      expect(jobStats.failed).toBe(2);
      expect(jobStats.passed).toBe(0);
      expect(jobStats.numberOfTests).toBe(2);
      expect(jobStats.brokenProperties).toHaveLength(2);
      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "check_uint_multiplication_bound(uint256,uint256)"
      );
      expect(jobStats.brokenProperties[1].brokenProperty).toBe(
        "check_struct_simple_invariant((uint256,bool))"
      );
    });

    it("should skip ANSI escape sequences and empty lines", () => {
      const lines = [
        "3[2K[⠃] Compiling...",
        "",
        "⠋ Parsing /Users/mihajlorudenko/projects/recon/Halmos-Broken-Properties-Example/out",
        "Symbolic test result: 1 passed; 0 failed; time: 1.0s",
      ];

      lines.forEach((line) => processHalmos(line, jobStats));

      expect(jobStats.passed).toBe(1);
      expect(jobStats.failed).toBe(0);
      expect(jobStats.duration).toBe("1s");
    });
  });

  describe("getHalmosPropertyAndSequence", () => {
    it("should extract property and sequence from logs", () => {
      const logs = `[FAIL] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.33s, bounds: [])
Counterexample:
    p_a_bool_7b2a94e_00 = 0x00
    p_b_bool_6c9fed6_00 = 0x00
Symbolic test result: 0 passed; 1 failed; time: 0.34s`;

      const result = getHalmosPropertyAndSequence(logs);

      expect(result).toHaveLength(1);
      expect(result[0].brokenProperty).toBe(
        "check_bool_xor_always_true(bool,bool)"
      );
      expect(result[0].sequence).toHaveLength(2);
      expect(result[0].sequence[0]).toBe("p_a_bool_7b2a94e_00 = 0x00");
      expect(result[0].sequence[1]).toBe("p_b_bool_6c9fed6_00 = 0x00");
    });
  });

  describe("halmosLogsToFunctions", () => {
    it("should convert logs to Foundry test functions", () => {
      const logs = `[FAIL] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.33s, bounds: [])
Counterexample:
    p_a_bool_7b2a94e_00 = 0x00
    p_b_bool_6c9fed6_00 = 0x00
Symbolic test result: 0 passed; 1 failed; time: 0.34s`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_check_bool_xor_always_true_bool_bool__test_run_0() public {"
      );
      expect(result).toContain("bool a = false;");
      expect(result).toContain("bool b = false;");
      expect(result).toContain(
        "// Counterexample for: check_bool_xor_always_true(bool,bool)"
      );
    });

    it("should handle uint256 parameters", () => {
      const logs = `[FAIL] check_uint_multiplication_bound(uint256,uint256) (paths: 3, time: 0.44s, bounds: [])
Counterexample:
    p_a_uint256_f73da65_00 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003
    p_b_uint256_5ff3489_00 = 0x3ffffffffffff9
Symbolic test result: 0 passed; 1 failed; time: 4.54s`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "uint256 a = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003;"
      );
      expect(result).toContain("uint256 b = 0x3ffffffffffff9;");
    });

    it("should return message when no failed properties found", () => {
      const logs = `Symbolic test result: 1 passed; 0 failed; time: 1.0s`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toBe("// No failed properties found in Halmos logs");
    });
  });
});
