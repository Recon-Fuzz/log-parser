import { getPropertyAndSequenceString } from "./index";

describe("Medusa Parser", () => {
  describe("getPropertyAndSequenceString", () => {
    it("should handle logs with no function calls without crashing", () => {
      const logsWithNoFunctionCalls = `
[FAILED] Assertion Test: CryticTester.restakingRouter_redeem(address,uint256)
Test for method "CryticTester.restakingRouter_redeem(address,uint256)" resulted in an assertion failure after the following call sequence:
[Call Sequence]
1) CryticTester.restakingBondMM_unpause()() (block=68924, time=621386, gas=12500000, gasprice=1, value=0, sender=0x30000)
2) CryticTester.restakingRouter_redeem(address,uint256)(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496, 1000309797381228308400539929892) (block=68924, time=621386, gas=12500000, gasprice=1, value=0, sender=0x30000)
[Execution Trace]
 => [call] CryticTester.restakingRouter_redeem(address,uint256)(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496, 1000309797381228308400539929892) (addr=0x2e234DAe75C793f67A35089C9d99245E1C58470b, value=0, sender=0x30000)
 => [panic: assertion failed]
[Logs]
 "loanData[_maturity].l", 0
 "cashOut", 0
      `;

      // This should not crash
      expect(() => {
        const result = getPropertyAndSequenceString(logsWithNoFunctionCalls);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      }).not.toThrow();
    });

    it("should handle logs with function calls correctly", () => {
      const logsWithFunctionCalls = `
[FAILED] Assertion Test: CryticTester.restakingRouter_redeem(address,uint256)
Test for method "CryticTester.restakingRouter_redeem(address,uint256)" resulted in an assertion failure after the following call sequence:
[Call Sequence]
1) CryticTester.restakingBondMM_unpause()() (block=68924, time=621386, gas=12500000, gasprice=1, value=0, sender=0x30000)
2) CryticTester.restakingRouter_redeem(address,uint256)(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496, 1000309797381228308400539929892) (block=68924, time=621386, gas=12500000, gasprice=1, value=0, sender=0x30000)
      `;

      const result = getPropertyAndSequenceString(logsWithFunctionCalls);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      if (result.length > 0) {
        expect(result[0]).toHaveProperty("brokenProperty");
        expect(result[0]).toHaveProperty("sequence");
        expect(result[0].brokenProperty).toBe("restakingRouter_redeem");
      }
    });

    it("should handle empty logs without crashing", () => {
      const emptyLogs = "";

      expect(() => {
        const result = getPropertyAndSequenceString(emptyLogs);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      }).not.toThrow();
    });

    it("should handle logs with no [FAILED] sections", () => {
      const logsWithoutFailed = `
Some random log content
without any failed sections
      `;

      expect(() => {
        const result = getPropertyAndSequenceString(logsWithoutFailed);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        // The function may return some results even without [FAILED] sections
        // The important thing is that it doesn't crash
      }).not.toThrow();
    });

    it("should handle the actual failed logs from the file", () => {
      // This is a simplified version of the actual failed logs that were causing the crash
      const actualFailedLogs = `
[FAILED] Assertion Test: CryticTester.restakingRouter_redeem(address,uint256)
Test for method "CryticTester.restakingRouter_redeem(address,uint256)" resulted in an assertion failure after the following call sequence:
[Call Sequence]
1) CryticTester.restakingBondMM_unpause()() (block=68924, time=621386, gas=12500000, gasprice=1, value=0, sender=0x30000)
2) CryticTester.restakingRouter_redeem(address,uint256)(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496, 1000309797381228308400539929892) (block=68924, time=621386, gas=12500000, gasprice=1, value=0, sender=0x30000)
[Execution Trace]
 => [call] CryticTester.restakingRouter_redeem(address,uint256)(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496, 1000309797381228308400539929892) (addr=0x2e234DAe75C793f67A35089C9d99245E1C58470b, value=0, sender=0x30000)
 => [call] RestakingRouter.getRate(address)(0xcDAA741ad6c9B73a249718651B6ff86565beC634) (addr=0x6985c91901D47804564bB155267991BF3Fd9f476, value=<nil>, sender=0x2e234DAe75C793f67A35089C9d99245E1C58470b)
 => [call] RestakingBondMM.getUintRate()() (addr=0xcDAA741ad6c9B73a249718651B6ff86565beC634, value=<nil>, sender=0x6985c91901D47804564bB155267991BF3Fd9f476)
 => [return (0, 50000000000000000)]
 => [return (0, 50000000000000000)]
 => [panic: assertion failed]
[Logs]
 "loanData[_maturity].l", 0
 "cashOut", 0
      `;

      // This should not crash with the fix
      expect(() => {
        const result = getPropertyAndSequenceString(actualFailedLogs);
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      }).not.toThrow();
    });
  });
});
