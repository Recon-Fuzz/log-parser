import { echidnaLogsToFunctions, echidnaShrunkAndProcess } from "../echidna";
import { halmosLogsToFunctions } from "../halmos";
import { processLogs } from "../main";
import { medusaLogsToFunctions } from "../medusa";
import { Fuzzer, FuzzingResults, VmParsingData } from "../types/types";

export const generateJobMD = (fuzzer: Fuzzer, logs: string, label: string) => {
  let data = processLogs(logs, fuzzer);
  if (fuzzer === Fuzzer.ECHIDNA) {
    data = echidnaShrunkAndProcess(logs, data);
  }
  const md = markdownShell(data, fuzzer, label);
  return md;
};

const vmData: VmParsingData = {
  roll: true,
  time: true,
  prank: true,
};

const markdownShell = (
  jobStats: FuzzingResults,
  fuzzer: string,
  label: string
): string => {
  return `
# Recon Recap for ${label}

## Fuzzer overview
- Fuzzer: ${fuzzer}
- Duration: ${jobStats.duration}
- Coverage: ${jobStats.coverage}
- Failed: ${jobStats.failed}
- Passed: ${jobStats.passed}
- Number of tests: ${jobStats.numberOfTests}

<details>
  <summary> <h2> Results </h2> </summary>

| Property | Status |
|----------|--------|
${jobStats.results
  .map((data) => {
    const { property, status } = prepareProperties(data);
    return `| ${property} | ${status} |`;
  })
  .join("\n")}

${jobStats.brokenProperties.length > 0 ? "## Broken Properties" : ""}
${jobStats.brokenProperties
  .map((el, index) => {
    return `
## Broken property
**${el.brokenProperty}**

### Sequence
\`\`\`solidity
${prepareTrace(fuzzer, el.sequence, el.brokenProperty)}
\`\`\`
  `;
  })
  .join("\n")}
</details>

`;
};

const prepareTrace = (
  fuzzer: string,
  trace: string,
  brokenProperty: string
) => {
  let finalTrace = "";
  if (fuzzer === "MEDUSA") {
    finalTrace = medusaLogsToFunctions(trace, "", vmData);
  } else if (fuzzer === "ECHIDNA") {
    finalTrace = echidnaLogsToFunctions(trace, "", brokenProperty, vmData);
  } else if (fuzzer === "HALMOS") {
    finalTrace = halmosLogsToFunctions(trace, "");
  }
  const functionName = finalTrace
    .split("() public")[0]
    .replace("function ", "");
  const forgeCommand = `// forge test --match-test ${functionName} -vv`.replace(
    "\n",
    ""
  );
  return `${forgeCommand} \n ${finalTrace}`;
};

export const prepareProperties = (
  propRaw: string
): { property: string; status: string } => {
  // Capture Medusa
  if (propRaw.includes("[FAILED]")) {
    return {
      property: propRaw.split(".")[1],
      status: "❌",
    };
  } else if (propRaw.includes("[PASSED]")) {
    return {
      property: propRaw.split(".")[1],
      status: "✅",
    };
    // Capture Echidna
  } else if (propRaw.includes("passing")) {
    return {
      property: propRaw.split(":")[0],
      status: "✅",
    };
  } else if (propRaw.includes("failed")) {
    return {
      property: propRaw.split(":")[0],
      status: "❌",
    };
  } else {
    return {
      property: "Unknown",
      status: "❔",
    };
  }
};
