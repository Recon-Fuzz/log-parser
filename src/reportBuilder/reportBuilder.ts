import { echidnaLogsToFunctions } from "../echidna";
import { processLogs } from "../main";
import { medusaLogsToFunctions } from "../medusa";
import { Fuzzer, FuzzingResults, VmParsingData } from "../types/types";

export const generateJobMD = async (
  fuzzer: Fuzzer,
  logs: string,
  orgName: string,
  repoName: string,
  ref: string,
) => {
  const data = processLogs(logs, fuzzer);
  const md = markdownShell(
    orgName,
    repoName,
    ref,
    data,
    fuzzer
  );
  return md;
};

const vmData: VmParsingData = {
  roll: true,
  time: true,
  prank: true,
};

const markdownShell = (
  orgName: string,
  repoName: string,
  branchName: string,
  jobStats: FuzzingResults,
  fuzzer: string
): string => {
  return `
# Recon Recap for ${orgName}/${repoName}/${branchName}


## Fuzzer overview
- Fuzzer: ${fuzzer}
- Duration: ${jobStats.duration}
- Coverage: ${jobStats.coverage}
- Failed: ${jobStats.failed}
- Passed: ${jobStats.passed}

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
### Broken property:
**${el.brokenProperty}**

### Sequence
\`\`\`javascript
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
