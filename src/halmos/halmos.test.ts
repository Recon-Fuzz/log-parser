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
        "Counterexample:",
        "    p_a_bool_7b2a94e_00 = 0x00",
        "    p_b_bool_6c9fed6_00 = 0x00",
        "[FAIL] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.33s, bounds: [])",
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
      expect(jobStats.brokenProperties[0].sequence).toBe(
        "p_a_bool_7b2a94e_00 = 0x00\np_b_bool_6c9fed6_00 = 0x00\n"
      );
      expect(jobStats.traces).toHaveLength(0); // Should not add to traces
    });

    it("should parse timeout test without creating empty broken properties", () => {
      const lines = [
        "[TIMEOUT] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.11s, bounds: [])",
        "Timeout queries saved in: /var/folders/3_/mlyqmvxn3dx7v3f2xx3xmf3r0000gn/T/check_bool_xor_always_true-c8btwv0i-timeout",
        "Symbolic test result: 0 passed; 1 failed; time: 0.12s",
      ];

      lines.forEach((line) => processHalmos(line, jobStats));

      expect(jobStats.failed).toBe(1);
      expect(jobStats.passed).toBe(0);
      expect(jobStats.results).toHaveLength(1);
      expect(jobStats.results[0]).toContain("[TIMEOUT]");
      expect(jobStats.brokenProperties).toHaveLength(0); // No empty properties
    });

    it("should parse multiple failed tests", () => {
      const lines = [
        "Counterexample:",
        "    p_a_uint256_f73da65_00 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003",
        "    p_b_uint256_5ff3489_00 = 0x3ffffffffffff9",
        "[FAIL] check_uint_multiplication_bound(uint256,uint256) (paths: 3, time: 0.44s, bounds: [])",
        "Counterexample:",
        "    p_s.flag_bool_0dc04dc_00 = 0x01",
        "    p_s.value_uint256_c1f0917_00 = 0x00",
        "[FAIL] check_struct_simple_invariant((uint256,bool)) (paths: 4, time: 0.12s, bounds: [])",
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
      expect(jobStats.brokenProperties[0].sequence).toContain(
        "p_a_uint256_f73da65_00"
      );
      expect(jobStats.brokenProperties[1].sequence).toContain(
        "p_s.flag_bool_0dc04dc_00"
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
      const logs = `Counterexample:
    p_a_bool_7b2a94e_00 = 0x00
    p_b_bool_6c9fed6_00 = 0x00
[FAIL] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.33s, bounds: [])
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
      const logs = `Counterexample:
    p_a_bool_7b2a94e_00 = 0x00
    p_b_bool_6c9fed6_00 = 0x00
[FAIL] check_bool_xor_always_true(bool,bool) (paths: 4, time: 0.33s, bounds: [])
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
      const logs = `Counterexample:
    p_a_uint256_f73da65_00 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003
    p_b_uint256_5ff3489_00 = 0x3ffffffffffff9
[FAIL] check_uint_multiplication_bound(uint256,uint256) (paths: 3, time: 0.44s, bounds: [])
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

    it("should handle various uint types", () => {
      const logs = `Counterexample:
    p_small_uint8_4282e7a_00 = 0xff
    p_medium_uint64_5ff3489_00 = 0xffffffffffffffff
    p_large_uint256_f73da65_00 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003
[FAIL] check_uint_types(uint8,uint64,uint256) (paths: 3, time: 0.44s, bounds: [])
Symbolic test result: 0 passed; 1 failed; time: 4.54s`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain("uint8 small = 0xff;");
      expect(result).toContain("uint64 medium = 0xffffffffffffffff;");
      expect(result).toContain(
        "uint256 large = 0xffffffffffffffffffffffffffffffffffffffffffffffffffe0000000000003;"
      );
    });

    it("should handle various int types", () => {
      const logs = `Counterexample:
    p_small_int8_4282e7a_00 = 0x80
    p_medium_int128_5ff3489_00 = 0x7fffffffffffffffffffffffffffffff
    p_large_int256_f73da65_00 = 0x8000000000000000000000000000000000000000000000000000000000000000
[FAIL] check_int_types(int8,int128,int256) (paths: 3, time: 0.44s, bounds: [])
Symbolic test result: 0 passed; 1 failed; time: 4.54s`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain("int8 small = int8(0x80);");
      expect(result).toContain(
        "int128 medium = int128(0x7fffffffffffffffffffffffffffffff);"
      );
      expect(result).toContain(
        "int256 large = int256(0x8000000000000000000000000000000000000000000000000000000000000000);"
      );
    });

    it("should handle bytes types", () => {
      const logs = `Counterexample:
    p_data_bytes32_4282e7a_00 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
    p_info_bytes_5ff3489_00 = 0x48656c6c6f20576f726c64
[FAIL] check_bytes_types(bytes32,bytes) (paths: 3, time: 0.44s, bounds: [])
Symbolic test result: 0 passed; 1 failed; time: 4.54s`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "bytes32 data = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;"
      );
      expect(result).toContain("bytes info = 0x48656c6c6f20576f726c64;");
    });
  });

  describe("Enhanced processHalmos with real log format", () => {
    it("should correctly parse the actual Halmos log format from logs.md", () => {
      const lines = [
        "Running 21 tests for test/HalmosDirect.t.sol:HalmosDirect",
        "Counterexample:",
        "    p_a_address_2ca5aa8_00 = 0x00",
        "    p_b_address_35f48fe_00 = 0x00",
        "[FAIL] check_address_properties(address,address) (paths: 4, time: 0.12s, bounds: [])",
        "Counterexample:",
        "    p_arr[0]_uint256_6ee061f_00 = 0x8000000000000000000000000000000000000000000000000000000000000000",
        "    p_arr[1]_uint256_22023b2_00 = 0x00",
        "    p_arr_length_3493a6d_00 = 0x02",
        "[FAIL] check_array_sorted(uint256[]) (paths: 4, time: 0.12s, bounds: [arr=[0, 1, 2]])",
        "[PASS] check_int_absolute_value(int256) (paths: 3, time: 0.01s, bounds: [])",
        "Symbolic test result: 2 failed, 1 passed, time: 0.25s",
      ];

      lines.forEach((line) => processHalmos(line, jobStats));

      expect(jobStats.failed).toBe(2);
      expect(jobStats.passed).toBe(1);
      expect(jobStats.numberOfTests).toBe(3);
      expect(jobStats.duration).toBe("0s");
      expect(jobStats.brokenProperties).toHaveLength(2);
      expect(jobStats.traces).toHaveLength(0); // Should not add to traces

      // Check first broken property
      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "check_address_properties(address,address)"
      );
      expect(jobStats.brokenProperties[0].sequence).toBe(
        "p_a_address_2ca5aa8_00 = 0x00\np_b_address_35f48fe_00 = 0x00\n"
      );

      // Check second broken property
      expect(jobStats.brokenProperties[1].brokenProperty).toBe(
        "check_array_sorted(uint256[])"
      );
      expect(jobStats.brokenProperties[1].sequence).toContain(
        "p_arr[0]_uint256_6ee061f_00"
      );
      expect(jobStats.brokenProperties[1].sequence).toContain(
        "p_arr_length_3493a6d_00"
      );
    });
  });
});
