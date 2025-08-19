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

      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "check_address_properties(address,address)"
      );
      expect(jobStats.brokenProperties[0].sequence).toBe(
        "p_a_address_2ca5aa8_00 = 0x00\np_b_address_35f48fe_00 = 0x00\n"
      );

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

  describe("Enhanced Halmos parser with real output format", () => {
    it("should parse real Halmos output with Counterexample and Sequence sections", () => {
      const logs = `Running 4 tests for test/recon/CryticToFoundry.sol:CryticToFoundry

Counterexample:
    halmos_block_timestamp_depth1_24e077e = 0x8000000000000000
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_11c31dd_03 = 0x00
    p_decimals_uint8_b2b4d3d_04 = 0x00
Sequence:
    CALL CryticToFoundry::add_new_asset(p_decimals_uint8_b2b4d3d_04) (value: halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_11c31dd_03) (caller: halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_3631ef6_02)
        CREATE 0xaaaa0004::<7875 bytes of initcode>
    ↩ RETURN 0x00000000000000000000000000000000000000000000000000000000aaaa0004

Counterexample:
    halmos_block_timestamp_depth1_35fd8e1 = 0x8000000000000000
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_f9163e1_07 = 0x00
    p_amt_uint128_db4946c_09 = 0x00
    p_to_address_d838b72_08 = 0x00
Sequence:
    CALL CryticToFoundry::asset_approve(Concat(p_to_address_d838b72_08, p_amt_uint128_db4946c_09)) (value: halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_f9163e1_07) (caller: halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_6908987_06)
        SLOAD  @6 → 0x00000000000000000000000000000000000000000000000000000000aaaa0003
    ↩ RETURN 0x`;

      const result = getHalmosPropertyAndSequence(logs);

      expect(result).toHaveLength(2);

      expect(result[0].brokenProperty).toBe("add_new_asset");
      expect(result[0].sequence).toContain(
        "p_decimals_uint8_b2b4d3d_04 = 0x00"
      );
      const sequence0 = Array.isArray(result[0].sequence)
        ? result[0].sequence
        : [result[0].sequence];
      expect(
        sequence0.some((line: string) =>
          line.includes(
            "CALL CryticToFoundry::add_new_asset(p_decimals_uint8_b2b4d3d_04)"
          )
        )
      ).toBe(true);

      expect(result[1].brokenProperty).toBe("asset_approve");
      expect(result[1].sequence).toContain("p_amt_uint128_db4946c_09 = 0x00");
      const sequence1 = Array.isArray(result[1].sequence)
        ? result[1].sequence
        : [result[1].sequence];
      expect(
        sequence1.some((line: string) =>
          line.includes(
            "CALL CryticToFoundry::asset_approve(Concat(p_to_address_d838b72_08, p_amt_uint128_db4946c_09))"
          )
        )
      ).toBe(true);
    });

    it("should generate enhanced Foundry test functions from real Halmos output", () => {
      const logs = `Counterexample:
    p_decimals_uint8_b2b4d3d_04 = 0x00
Sequence:
    CALL CryticToFoundry::add_new_asset(p_decimals_uint8_b2b4d3d_04) (value: halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_11c31dd_03) (caller: halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_3631ef6_02)`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_add_new_asset_test_run_0() public {"
      );
      expect(result).toContain("// Counterexample for: add_new_asset");
      expect(result).toContain("uint8 decimals = 0x00;");
      expect(result).toContain("// Reproduction sequence:");
      expect(result).toContain("add_new_asset(decimals);");
    });

    it("should handle complex Concat parameters in function calls", () => {
      const logs = `Counterexample:
    p_amt_uint128_db4946c_09 = 0x00
    p_to_address_d838b72_08 = 0x00
Sequence:
    CALL CryticToFoundry::asset_approve(Concat(p_to_address_d838b72_08, p_amt_uint128_db4946c_09)) (value: halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_f9163e1_07) (caller: halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_6908987_06)`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_asset_approve_test_run_0() public {"
      );
      expect(result).toContain("uint128 amt = 0x00;");
      expect(result).toContain(
        "address to = 0x0000000000000000000000000000000000000000;"
      );
      expect(result).toContain("asset_approve(to, amt);");
    });

    it("should handle multiple counterexamples for different functions", () => {
      const logs = `Counterexample:
    p_decimals_uint8_b2b4d3d_04 = 0x00
Sequence:
    CALL CryticToFoundry::add_new_asset(p_decimals_uint8_b2b4d3d_04) (value: halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_11c31dd_03) (caller: halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_3631ef6_02)

Counterexample:
    p_amt_uint128_8d3dedb_14 = 0x00
    p_to_address_b2448c2_13 = 0x00
Sequence:
    CALL CryticToFoundry::asset_mint(Concat(p_to_address_b2448c2_13, p_amt_uint128_8d3dedb_14)) (value: halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_65b875c_12) (caller: halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_24b0ea7_11)`;

      const result = halmosLogsToFunctions(logs, "test_run");

      // Should generate two separate test functions
      expect(result).toContain(
        "function test_add_new_asset_test_run_0() public {"
      );
      expect(result).toContain(
        "function test_asset_mint_test_run_1() public {"
      );

      // First function should have add_new_asset call
      expect(result).toContain("add_new_asset(decimals);");

      // Second function should have asset_mint call
      expect(result).toContain("asset_mint(to, amt);");
    });

    it("should handle empty counterexamples gracefully", () => {
      const logs = `Counterexample: ∅
Sequence:
    CALL CryticToFoundry::some_function() (value: 0x00) (caller: 0x1234)`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_some_function_test_run_0() public {"
      );
      expect(result).toContain("some_function();");
      expect(result).not.toContain("Parameter declarations:");
    });
  });

  describe("Enhanced parser edge cases", () => {
    it("should handle mixed old and new format gracefully", () => {
      const oldFormatLogs = `Counterexample:
    p_a_bool_7b2a94e_00 = 0x00
[FAIL] check_bool_property(bool) (paths: 4, time: 0.33s, bounds: [])`;

      const result = halmosLogsToFunctions(oldFormatLogs, "test_run");

      expect(result).toContain(
        "function test_check_bool_property_bool__test_run_0() public {"
      );
      expect(result).toContain("bool a = false;");
    });

    it("should handle complex Extract expressions", () => {
      const logs = `Counterexample:
    p_value_uint256_abc123_01 = 0x1234567890abcdef
Sequence:
    CALL TestContract::complex_function(Extract(0x9f, 0x00, p_value_uint256_abc123_01)) (caller: 0x1234)`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_complex_function_test_run_0() public {"
      );
      expect(result).toContain("uint256 value = 0x1234567890abcdef;");
      expect(result).toContain("complex_function(value);");
    });
  });
});
