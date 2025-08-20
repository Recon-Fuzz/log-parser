import {
  getHalmosPropertyAndSequence,
  halmosLogsToFunctions,
  halmosSequenceToFunction,
  processHalmos,
} from "./index";
import { type FuzzingResults } from "../types/types";
import * as fs from "fs";
import * as path from "path";

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

    it("should handle invariant tests with sequence calls", () => {
      const logs = `Counterexample:
    p_entropy_uint256_b61accd_37 = 0x00
    p_manager_address_518a6bc_70 = 0x8000000000000000000000000000000000000000
Sequence:
    CALL CryticToFoundry::switchActor(p_entropy_uint256_b61accd_37)
    CALL CryticToFoundry::setTheManager(p_manager_address_518a6bc_70)
[FAIL] invariant_never_manager() (paths: 90, time: 0.56s, bounds: [])`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toContain(
        "function test_invariant_never_manager___test_run_0() public {"
      );
      expect(result).toContain(
        "// Counterexample for: invariant_never_manager()"
      );
      expect(result).toContain("uint256 entropy_uint256 = 0x00;");
      expect(result).toContain(
        "address manager_address = 0x8000000000000000000000000000000000000000;"
      );
      expect(result).toContain("switchActor(entropy_uint256);");
      expect(result).toContain("setTheManager(manager_address);");
      expect(result).toContain("invariant_never_manager();");
    });

    it("should return message when no failed properties found", () => {
      const logs = `[PASS] test_property(uint256) (paths: 1, time: 0.1s, bounds: [])`;

      const result = halmosLogsToFunctions(logs, "test_run");

      expect(result).toBe("// No failed properties found in Halmos logs");
    });

    it("should parse actual logs file and generate correct invariant test", () => {
      const logs = fs.readFileSync(path.join(__dirname, "logs.txt"), "utf-8");
      const result = halmosLogsToFunctions(logs, "test");

      console.log("Generated test functions:");
      console.log(result);

      // Check that the invariant test includes the sequence calls
      expect(result).toContain("switchActor(");
      expect(result).toContain("setTheManager(");
      expect(result).toContain("invariant_never_manager()");
    });

    it("should debug the specific failing case", () => {
      const logs = `Counterexample:
    halmos_block_timestamp_depth1_6c7bfa9 = 0x8000000000000000
    halmos_block_timestamp_depth2_ad1396a = 0x8000000000000000
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36 =
0x00
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e23a43b_69 =
0x00
    p_entropy_uint256_bf67ff6_37 = 0x00
    p_manager_address_b8e5817_70 = 0x8000000000000000000000000000000000000000
Sequence:
    CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_9282034_35)
        SLOAD  @1 →
0x0000000000000000000000000000000000000000000000000000000000000002
        SLOAD
@+(0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6,
p_entropy_uint256_bf67ff6_37) →
Select(storage_0x7fa9385be102ac3eac297483dd6233d62b3e1496_1_1_256_14378b1_03,
+(0x0000000000000000000000000000000000000000000000000000000000000000,
p_entropy_uint256_bf67ff6_37))
        SLOAD  @0 →
0x0000000000000000000000007fa9385be102ac3eac297483dd6233d62b3e1496
        SSTORE @0 ← Concat(0x000000000000000000000000, Extract(0x9f, 0x00,
Select(storage_0x7fa9385be102ac3eac297483dd6233d62b3e1496_1_1_256_14378b1_03,
p_entropy_uint256_bf67ff6_37)))
    ↩ RETURN 0x
    CALL CryticToFoundry::setTheManager(p_manager_address_b8e5817_70) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e23a43b_69) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_22a8176_68)
        SLOAD  @10 →
0x0000000000000000000000000000000000000000000000000000000000000000
        SSTORE @10 ← Concat(0x000000000000000000000000, Extract(0x9f, 0x00,
p_manager_address_b8e5817_70))
    ↩ RETURN 0x

[FAIL] invariant_never_manager() (paths: 90, time: 0.56s, bounds: [])`;

      const propertySequences = getHalmosPropertyAndSequence(logs);
      console.log(
        "Parsed property sequences:",
        JSON.stringify(propertySequences, null, 2)
      );

      const result = halmosLogsToFunctions(logs, "test");
      console.log("Generated function:");
      console.log(result);

      // Check that the invariant test includes the sequence calls
      expect(result).toContain("switchActor(");
      expect(result).toContain("setTheManager(");
      expect(result).toContain("invariant_never_manager()");
    });

    it("should test halmosSequenceToFunction specifically", () => {
      const sequence = `p_entropy_uint256_bf67ff6_37 = 0x00
p_manager_address_b8e5817_70 = 0x8000000000000000000000000000000000000000
CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37)
CALL CryticToFoundry::setTheManager(p_manager_address_b8e5817_70)`;

      const result = halmosSequenceToFunction(
        sequence,
        "invariant_never_manager()",
        "test",
        0
      );
      console.log("halmosSequenceToFunction result:");
      console.log(result);

      // Check that the invariant test includes the sequence calls
      expect(result).toContain("switchActor(");
      expect(result).toContain("setTheManager(");
      expect(result).toContain("invariant_never_manager()");
    });

    it("should debug sequence extraction issue", () => {
      const logs = `Counterexample:
    p_entropy_uint256_bf67ff6_37 = 0x00
    p_manager_address_b8e5817_70 = 0x8000000000000000000000000000000000000000
Sequence:
    CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_9282034_35)
        SLOAD  @1 →
0x0000000000000000000000000000000000000000000000000000000000000002
    CALL CryticToFoundry::setTheManager(p_manager_address_b8e5817_70) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e23a43b_69) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_22a8176_68)
        SLOAD  @10 →
0x0000000000000000000000000000000000000000000000000000000000000000

[FAIL] invariant_never_manager() (paths: 90, time: 0.56s, bounds: [])`;

      const propertySequences = getHalmosPropertyAndSequence(logs);
      console.log(
        "Debug - Full parsed sequences:",
        JSON.stringify(propertySequences, null, 2)
      );

      if (propertySequences.length > 0) {
        const sequence = propertySequences[0].sequence;
        console.log("Debug - Sequence array:", sequence);
        console.log(
          "Debug - Sequence as string:",
          Array.isArray(sequence) ? sequence.join("\n") : sequence
        );

        // Test what happens when we pass just the parameters (simulating the frontend issue)
        const sequenceArray = Array.isArray(sequence) ? sequence : [sequence];
        const parametersOnly = sequenceArray
          .filter((line: string) => line.includes("="))
          .join("\n");
        console.log("Debug - Parameters only:", parametersOnly);

        const resultWithParametersOnly = halmosSequenceToFunction(
          parametersOnly,
          "invariant_never_manager()",
          "test",
          0
        );
        console.log("Debug - Result with parameters only:");
        console.log(resultWithParametersOnly);

        // Test with full sequence
        const fullSequence = Array.isArray(sequence)
          ? sequence.join("\n")
          : sequence;
        const resultWithFullSequence = halmosSequenceToFunction(
          fullSequence,
          "invariant_never_manager()",
          "test",
          0
        );
        console.log("Debug - Result with full sequence:");
        console.log(resultWithFullSequence);
      }
    });

    it("should test processHalmos function with the problematic logs", () => {
      const logs = `Counterexample:
    halmos_block_timestamp_depth1_6c7bfa9 = 0x8000000000000000
    halmos_block_timestamp_depth2_ad1396a = 0x8000000000000000
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36 =
0x00
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e23a43b_69 =
0x00
    p_entropy_uint256_bf67ff6_37 = 0x00
    p_manager_address_b8e5817_70 = 0x8000000000000000000000000000000000000000
Sequence:
    CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_9282034_35)
        SLOAD  @1 →
0x0000000000000000000000000000000000000000000000000000000000000002
    CALL CryticToFoundry::setTheManager(p_manager_address_b8e5817_70) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e23a43b_69) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_22a8176_68)
        SLOAD  @10 →
0x0000000000000000000000000000000000000000000000000000000000000000

[FAIL] invariant_never_manager() (paths: 90, time: 0.56s, bounds: [])`;

      const jobStats: FuzzingResults = {
        duration: "",
        coverage: 0,
        failed: 0,
        passed: 0,
        results: [],
        traces: [],
        brokenProperties: [],
        numberOfTests: 0,
      };

      // Process the logs line by line like the main processLogs function does
      const lines = logs.split("\n");
      lines.forEach((line) => {
        processHalmos(line, jobStats);
      });

      console.log(
        "Debug - processHalmos result:",
        JSON.stringify(jobStats.brokenProperties, null, 2)
      );

      expect(jobStats.brokenProperties).toHaveLength(1);
      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "invariant_never_manager()"
      );

      const sequence = jobStats.brokenProperties[0].sequence;
      console.log("Debug - processHalmos sequence:", sequence);

      // Check that the sequence contains both parameters and CALL statements
      expect(sequence).toContain("p_entropy_uint256_bf67ff6_37 = 0x00");
      expect(sequence).toContain(
        "p_manager_address_b8e5817_70 = 0x8000000000000000000000000000000000000000"
      );
      expect(sequence).toContain(
        "CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37)"
      );
      expect(sequence).toContain(
        "CALL CryticToFoundry::setTheManager(p_manager_address_b8e5817_70)"
      );
    });

    it("should handle the new problematic logs with Concat parameters", () => {
      const logs = `Counterexample:
    halmos_block_timestamp_depth1_6c7bfa9 = 0x8000000000000000
    halmos_block_timestamp_depth2_abaca96 = 0x8000000000000000
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36 =
0x00
    halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e4ecfe0_64 =
0x00
    p_entropy_uint256_bf67ff6_37 = 0x00
    p_isManager_bool_27d3489_66 = 0x01
    p_manager_address_7f0b765_65 = 0x00
Sequence:
    CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_31225f5_36) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_9282034_35)
        SLOAD  @1 →
0x0000000000000000000000000000000000000000000000000000000000000002
    CALL CryticToFoundry::setIsManager(Concat(p_manager_address_7f0b765_65,
p_isManager_bool_27d3489_66)) (value:
halmos_msg_value_0x7fa9385be102ac3eac297483dd6233d62b3e1496_e4ecfe0_64) (caller:
halmos_msg_sender_0x7fa9385be102ac3eac297483dd6233d62b3e1496_3c634f7_63)
        SLOAD  @f_sha3_512(Concat(0x000000000000000000000000, Extract(0x9f,
0x00, p_manager_address_7f0b765_65),
0x0000000000000000000000000000000000000000000000000000000000000009)) → 0x00

[FAIL] invariant_isNeverManager() (paths: 90, time: 0.57s, bounds: [])`;

      const jobStats: FuzzingResults = {
        duration: "",
        coverage: 0,
        failed: 0,
        passed: 0,
        results: [],
        traces: [],
        brokenProperties: [],
        numberOfTests: 0,
      };

      // Process the logs line by line like the main processLogs function does
      const lines = logs.split("\n");
      lines.forEach((line) => {
        processHalmos(line, jobStats);
      });

      console.log(
        "Debug - New logs processHalmos result:",
        JSON.stringify(jobStats.brokenProperties, null, 2)
      );

      expect(jobStats.brokenProperties).toHaveLength(1);
      expect(jobStats.brokenProperties[0].brokenProperty).toBe(
        "invariant_isNeverManager()"
      );

      const sequence = jobStats.brokenProperties[0].sequence;
      console.log("Debug - New logs processHalmos sequence:", sequence);

      // Check that the sequence contains both parameters and CALL statements
      expect(sequence).toContain("p_entropy_uint256_bf67ff6_37 = 0x00");
      expect(sequence).toContain("p_isManager_bool_27d3489_66 = 0x01");
      expect(sequence).toContain("p_manager_address_7f0b765_65 = 0x00");
      expect(sequence).toContain(
        "CALL CryticToFoundry::switchActor(p_entropy_uint256_bf67ff6_37)"
      );
      expect(sequence).toContain(
        "CALL CryticToFoundry::setIsManager(Concat(p_manager_address_7f0b765_65, p_isManager_bool_27d3489_66))"
      );

      // Test the generated function
      const result = halmosSequenceToFunction(
        sequence,
        "invariant_isNeverManager()",
        "test",
        0
      );
      console.log("Debug - Generated function for new logs:");
      console.log(result);

      // Check that the function includes both calls
      expect(result).toContain("switchActor(");
      expect(result).toContain("setIsManager(");
      expect(result).toContain("invariant_isNeverManager()");
    });
  });
});
