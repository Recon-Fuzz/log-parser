import { getHalmosPropertyAndSequence, halmosLogsToFunctions } from "./index";

describe("Halmos Parser", () => {
  describe("getHalmosPropertyAndSequence", () => {
    it("should extract property and sequence from logs", () => {
      const logs = `Counterexample:
    p_value_uint256_abc123_00 = 0x1234
[FAIL] test_property(uint256) (paths: 1, time: 0.1s, bounds: [])`;

      const result = getHalmosPropertyAndSequence(logs);

      expect(result).toHaveLength(1);
      expect(result[0].brokenProperty).toBe("test_property(uint256)");
      expect(result[0].sequence).toEqual([
        "p_value_uint256_abc123_00 = 0x1234",
      ]);
    });

    it("should handle multiple failed properties", () => {
      const logs = `Running 21 tests for test/HalmosDirect.t.sol:HalmosDirect
Counterexample:
    p_a_address_2ca5aa8_00 = 0x00
    p_b_address_35f48fe_00 = 0x00
[FAIL] check_address_properties(address,address) (paths: 4, time: 0.12s, bounds: [])
Counterexample:
    p_arr[0]_uint256_6ee061f_00 = 0x8000000000000000000000000000000000000000000000000000000000000000
    p_arr[1]_uint256_22023b2_00 = 0x00
    p_arr_length_3493a6d_00 = 0x02
[FAIL] check_array_sorted(uint256[]) (paths: 4, time: 0.12s, bounds: [arr=[0, 1, 2]])
[PASS] check_int_absolute_value(int256) (paths: 3, time: 0.01s, bounds: [])`;

      const result = getHalmosPropertyAndSequence(logs);

      expect(result).toHaveLength(2);
      expect(result[0].brokenProperty).toBe(
        "check_address_properties(address,address)"
      );
      expect(result[1].brokenProperty).toBe("check_array_sorted(uint256[])");
    });
  });

  describe("halmosLogsToFunctions", () => {
    it("should convert logs to Foundry test functions", () => {
      const logs = `Counterexample:
    p_value_uint256_abc123_00 = 0x1234
[FAIL] test_property(uint256) (paths: 1, time: 0.1s, bounds: [])`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_test_property_uint256__test_run_0() public {"
      );
      expect(result).toContain("// Counterexample for: test_property(uint256)");
      expect(result).toContain("uint256 value_uint256 = 0x1234;");
    });

    it("should return message when no failed properties found", () => {
      const logs = `[PASS] test_property(uint256) (paths: 1, time: 0.1s, bounds: [])`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toBe("// No failed properties found in Halmos logs");
    });
  });
});
