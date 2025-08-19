import { type FuzzingResults, type PropertyAndSequence } from "../types/types";
import { captureFuzzingDuration } from "../utils/utils";

let halmosCounterexampleLogger = false;
let currentCounterexampleData: string[] = [];

const isEmptyOrAnsi = (line: string): boolean =>
  !line || line.includes("\x1b[") || line.includes("3[2K");

const isTestResult = (line: string): boolean =>
  line.includes("[FAIL]") || line.includes("[TIMEOUT]");

const extractTestProperty = (line: string): string | null => {
  const match = line.match(/\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/);
  return match?.[1]?.trim() || null;
};

const extractCounts = (line: string) => {
  const passedMatch = line.match(/(\d+)\s+passed/);
  const failedMatch = line.match(/(\d+)\s+failed/);
  return {
    passed: passedMatch ? parseInt(passedMatch[1]) : 0,
    failed: failedMatch ? parseInt(failedMatch[1]) : 0,
  };
};

const extractDuration = (line: string): string => {
  const timeMatch = line.match(/time:\s*([\d.]+)s/);
  if (!timeMatch) return "";

  const durationStr = `${Math.floor(parseFloat(timeMatch[1]))}s`;
  return captureFuzzingDuration(durationStr) || durationStr;
};

const findOrCreateProperty = (
  jobStats: FuzzingResults,
  propertyName: string
) => {
  let property = jobStats.brokenProperties.find(
    (prop) => prop.brokenProperty === propertyName
  );

  if (!property) {
    property = { brokenProperty: propertyName, sequence: "" };
    jobStats.brokenProperties.push(property);
  }

  return property;
};

export const processHalmos = (line: string, jobStats: FuzzingResults): void => {
  const trimmedLine = line.trim();

  if (isEmptyOrAnsi(trimmedLine)) return;

  if (trimmedLine.includes("Symbolic test result:")) {
    const { passed, failed } = extractCounts(trimmedLine);
    jobStats.passed = passed;
    jobStats.failed = failed;
    jobStats.numberOfTests = passed + failed;
    jobStats.duration = extractDuration(trimmedLine);
    return;
  }

  if (trimmedLine === "Counterexample:") {
    if (halmosCounterexampleLogger && currentCounterexampleData.length > 0) {
      halmosCounterexampleLogger = false;
      currentCounterexampleData = [];
    }

    halmosCounterexampleLogger = true;
    currentCounterexampleData = [];
    return;
  }

  if (halmosCounterexampleLogger) {
    if (isTestResult(trimmedLine)) {
      const property = extractTestProperty(trimmedLine);
      if (property && currentCounterexampleData.length > 0) {
        jobStats.results.push(trimmedLine);

        const brokenProperty = findOrCreateProperty(jobStats, property);
        brokenProperty.sequence = currentCounterexampleData.join("\n") + "\n";
      } else if (property) {
        jobStats.results.push(trimmedLine);
      }

      halmosCounterexampleLogger = false;
      currentCounterexampleData = [];
    } else if (trimmedLine.includes("=")) {
      currentCounterexampleData.push(trimmedLine);
    } else if (
      trimmedLine.includes("Symbolic test result:") ||
      trimmedLine.includes("[PASS]") ||
      trimmedLine === "Counterexample:"
    ) {
      halmosCounterexampleLogger = false;
      currentCounterexampleData = [];

      if (trimmedLine === "Counterexample:") {
        halmosCounterexampleLogger = true;
        currentCounterexampleData = [];
      }
    }
  }

  if (!halmosCounterexampleLogger && isTestResult(trimmedLine)) {
    const property = extractTestProperty(trimmedLine);
    if (property) {
      jobStats.results.push(trimmedLine);
    }
  }
};

interface HalmosCounterexample {
  parameters: string[];
  sequence: string[];
  functionCall?: string;
}

export function getHalmosPropertyAndSequence(
  logs: string
): PropertyAndSequence[] {
  const lines = logs.split("\n");

  // Check if this is the new format with Counterexample: and Sequence: sections
  const hasNewFormat = logs.includes("Sequence:");

  if (hasNewFormat) {
    return parseNewHalmosFormat(lines);
  } else {
    return parseOldHalmosFormat(lines);
  }
}

function parseNewHalmosFormat(lines: string[]): PropertyAndSequence[] {
  const results: PropertyAndSequence[] = [];
  const counterexamples: HalmosCounterexample[] = [];

  let currentCounterexample: HalmosCounterexample | null = null;
  let inCounterexample = false;
  let inSequence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Start of a new counterexample
    if (trimmed === "Counterexample:" || trimmed === "Counterexample: ∅") {
      if (currentCounterexample) {
        counterexamples.push(currentCounterexample);
      }

      currentCounterexample = {
        parameters: [],
        sequence: [],
      };
      inCounterexample = true;
      inSequence = false;
      continue;
    }

    if (trimmed === "Sequence:") {
      inSequence = true;
      inCounterexample = false;
      continue;
    }

    if (inCounterexample && currentCounterexample && trimmed.includes("=")) {
      currentCounterexample.parameters.push(trimmed);
      continue;
    }

    if (inSequence && currentCounterexample && trimmed.startsWith("CALL ")) {
      currentCounterexample.sequence.push(trimmed);
      const callMatch = /CALL\s+\w+::(\w+)\(/.exec(trimmed);
      if (callMatch && !currentCounterexample.functionCall) {
        currentCounterexample.functionCall = callMatch[1];
      }
      continue;
    }

    if (
      (trimmed === "" ||
        trimmed.startsWith("Running ") ||
        trimmed.startsWith("╭")) &&
      (inCounterexample || inSequence)
    ) {
      inCounterexample = false;
      inSequence = false;
    }
  }

  if (currentCounterexample) {
    counterexamples.push(currentCounterexample);
  }

  counterexamples.forEach((ce, index) => {
    if (ce.sequence.length > 0) {
      const functionCall = ce.functionCall || `unknown_function_${index}`;
      results.push({
        brokenProperty: functionCall,
        sequence: [...ce.parameters, ...ce.sequence],
      });
    }
  });

  return results;
}

function parseOldHalmosFormat(lines: string[]): PropertyAndSequence[] {
  const results: PropertyAndSequence[] = [];
  let currentCounterexamples: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Counterexample:") {
      capturing = true;
      currentCounterexamples = [];
      continue;
    }

    if (capturing) {
      if (trimmed.includes("=")) {
        currentCounterexamples.push(trimmed);
      } else if (trimmed.includes("[FAIL]") || trimmed.includes("[TIMEOUT]")) {
        const propertyMatch = /\[(?:FAIL|TIMEOUT)\]\s+(.+?)\s+\(paths:/.exec(
          trimmed
        );
        if (propertyMatch && currentCounterexamples.length > 0) {
          results.push({
            brokenProperty: propertyMatch[1].trim(),
            sequence: currentCounterexamples,
          });
        }
        capturing = false;
        currentCounterexamples = [];
      }
    }
  }

  return results;
}

const cleanParameterName = (paramName: string): string =>
  paramName
    .replace(/^p_/, "")
    .replace(/_[a-f0-9]+_\d+$/, "")
    .replace(/_(?:bool|uint\d+|address|int\d+|bytes\d*)$/, "");

const extractTypeFromParamName = (paramName: string): string | null => {
  const typeMatch = paramName.match(
    /_(?:bool|uint\d+|address|int\d+|bytes\d*)_/
  );
  return typeMatch ? typeMatch[0].slice(1, -1) : null;
};

const formatSolidityValue = (paramName: string, value: string): string => {
  const cleanName = cleanParameterName(paramName);
  const cleanValue = value.replace(/^0x/, "");
  const type = extractTypeFromParamName(paramName);

  if (paramName.includes("_bool_")) {
    return `bool ${cleanName} = ${cleanValue === "01" ? "true" : "false"};`;
  }

  if (paramName.includes("_address_")) {
    return `address ${cleanName} = 0x${cleanValue.padStart(40, "0")};`;
  }

  if (type?.startsWith("uint")) {
    return `${type} ${cleanName} = 0x${cleanValue};`;
  }

  if (type?.startsWith("int")) {
    return `${type} ${cleanName} = ${type}(0x${cleanValue});`;
  }

  if (type?.startsWith("bytes")) {
    return `${type} ${cleanName} = 0x${cleanValue};`;
  }

  return `uint256 ${cleanName} = 0x${cleanValue};`;
};

interface ParsedFunctionCall {
  functionName: string;
  parameters: string[];
  originalCall: string;
}

const extractFunctionCallFromSequence = (
  sequence: string[]
): ParsedFunctionCall[] => {
  const functionCalls: ParsedFunctionCall[] = [];

  for (const line of sequence) {
    if (line.startsWith("CALL ")) {
      const functionMatch = /CALL\s+\w+::(\w+)\(/.exec(line);
      if (functionMatch) {
        const functionName = functionMatch[1];

        const paramStart = line.indexOf("(", line.indexOf(functionName)) + 1;

        let paramEnd = paramStart;
        let depth = 1;

        for (let i = paramStart; i < line.length && depth > 0; i++) {
          if (line[i] === "(") depth++;
          else if (line[i] === ")") depth--;
          if (depth === 0) {
            paramEnd = i;
            break;
          }
        }

        const params = line.substring(paramStart, paramEnd);

        const parameters = parseHalmosParameters(params);

        functionCalls.push({
          functionName,
          parameters,
          originalCall: line,
        });
      }
    }
  }

  return functionCalls;
};

const parseHalmosParameters = (params: string): string[] => {
  if (!params.trim()) return [];

  const parameters: string[] = [];
  let currentParam = "";
  let depth = 0;

  for (const element of params) {
    const char = element;

    if (char === "(") {
      depth++;
      currentParam += char;
    } else if (char === ")") {
      depth--;
      currentParam += char;
    } else if (char === "," && depth === 0) {
      if (currentParam.trim()) {
        parameters.push(currentParam.trim());
      }
      currentParam = "";
    } else {
      currentParam += char;
    }
  }

  if (currentParam.trim()) {
    parameters.push(currentParam.trim());
  }

  return parameters;
};

const mapHalmosParameterToVariable = (
  halmosParam: string,
  parameterMap: Map<string, string>
): string => {
  if (halmosParam.startsWith("p_") && parameterMap.has(halmosParam)) {
    return parameterMap.get(halmosParam)!;
  }

  if (halmosParam.startsWith("Concat(")) {
    const concatMatch = /Concat\(([^)]+)\)/.exec(halmosParam);
    if (concatMatch) {
      const innerParams = concatMatch[1].split(",").map((p) => p.trim());
      const mappedParams = innerParams
        .filter((p) => p.startsWith("p_") && parameterMap.has(p))
        .map((p) => parameterMap.get(p)!);
      return mappedParams.length > 0
        ? mappedParams.join(", ")
        : "/* complex parameter */";
    }
  }

  if (halmosParam.includes("Extract(")) {
    const extractMatch = /Extract\([^,]+,\s*[^,]+,\s*(p_[^)]+)\)/.exec(
      halmosParam
    );
    if (extractMatch && parameterMap.has(extractMatch[1])) {
      return parameterMap.get(extractMatch[1])!;
    }
  }

  return "/* unmapped parameter */";
};

const generateTestFunction = (
  propSeq: PropertyAndSequence,
  identifier: string,
  index: number
): string => {
  const functionName = `test_${propSeq.brokenProperty.replace(
    /\W/g,
    "_"
  )}_${identifier}_${index}`;
  const sequences = Array.isArray(propSeq.sequence)
    ? propSeq.sequence
    : [propSeq.sequence];

  const parameterMap = new Map<string, string>();
  const parameterDeclarations: string[] = [];

  sequences
    .filter(
      (param): param is string =>
        typeof param === "string" &&
        param.includes("=") &&
        !param.startsWith("CALL")
    )
    .forEach((param) => {
      const [paramName, paramValue] = param.split("=").map((s) => s.trim());
      const solidityDeclaration = formatSolidityValue(paramName, paramValue);
      parameterDeclarations.push(`    ${solidityDeclaration}`);

      // Extract variable name from the declaration for mapping
      const varMatch = solidityDeclaration.match(/\w+\s+(\w+)\s*=/);
      if (varMatch) {
        parameterMap.set(paramName, varMatch[1]);
      }
    });

  // Extract function calls from sequence and generate actual calls
  const functionCalls = extractFunctionCallFromSequence(sequences);
  const callsSection =
    functionCalls.length > 0
      ? functionCalls
          .map((call) => {
            const mappedParams = call.parameters
              .map((param) => mapHalmosParameterToVariable(param, parameterMap))
              .join(", ");
            return `    ${call.functionName}(${mappedParams});`;
          })
          .join("\n")
      : `    // ${propSeq.brokenProperty}(/* add parameters here */);`;

  const parts = [
    `function ${functionName}() public {`,
    `    // Counterexample for: ${propSeq.brokenProperty}`,
  ];

  if (parameterDeclarations.length > 0) {
    parts.push("", "    // Parameter declarations:");
    parts.push(...parameterDeclarations);
  }

  parts.push("", "    // Reproduction sequence:");
  parts.push(callsSection);
  parts.push("}");

  return parts.join("\n");
};

export function halmosLogsToFunctions(
  logs: string,
  identifier: string
): string {
  const propertySequences = getHalmosPropertyAndSequence(logs);

  return propertySequences.length === 0
    ? "// No failed properties found in Halmos logs"
    : propertySequences
        .map((propSeq, index) =>
          generateTestFunction(propSeq, identifier, index)
        )
        .join("\n\n");
}
