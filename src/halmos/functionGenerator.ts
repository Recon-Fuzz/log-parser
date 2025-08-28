import { type PropertyAndSequence } from "../types/types";
import { parseCallStatement, formatSolidityValue } from "./parameterUtils";
import { findMatchingVariable, generateArrayDeclarations } from "./arrayUtils";

export const generateFunctionCall = (
  brokenProperty: string,
  variableMapping: Map<string, string>
): string => {
  const functionMatch = brokenProperty.match(/^([^(]+)\(([^)]*)\)/);
  if (!functionMatch) {
    return `${brokenProperty}(/* parameters not parsed */)`;
  }

  const functionName = functionMatch[1];
  const paramTypes = functionMatch[2];

  if (!paramTypes.trim()) {
    return `${functionName}()`;
  }

  const types = paramTypes.split(",").map((t) => t.trim().replace(/[()]/g, ""));
  const parameters: string[] = [];

  const paramsByType = new Map<string, number[]>();
  types.forEach((type, index) => {
    if (!paramsByType.has(type)) {
      paramsByType.set(type, []);
    }
    paramsByType.get(type)!.push(index);
  });

  types.forEach((type, index) => {
    let positionInType = 0;
    if (type.includes("[]")) {
      const indicesOfSameType = paramsByType.get(type)!;
      positionInType = indicesOfSameType.indexOf(index);
    }

    const matchingVar = findMatchingVariable(
      type,
      positionInType,
      variableMapping
    );

    parameters.push(matchingVar || `/* ${type} parameter */`);
  });

  return `${functionName}(${parameters.join(", ")})`;
};

export const generateTestFunction = (
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

  const parameterDeclarations: string[] = [];
  const usedVariableNames = new Set<string>();
  const variableMapping = new Map<string, string>();
  const arrayDeclarations: string[] = [];
  const sequenceCalls: string[] = [];

  // Process only the first counterexample when there are multiple
  const firstCounterexampleLines: string[] = [];
  let inFirstCounterexample = false;
  let foundFirstCounterexample = false;

  for (const line of sequences) {
    if (typeof line === "string") {
      const trimmedLine = line.trim();

      if (trimmedLine === "Counterexample:") {
        if (!foundFirstCounterexample) {
          inFirstCounterexample = true;
          foundFirstCounterexample = true;
        } else {
          // Stop processing when we hit the second counterexample
          break;
        }
      } else if (trimmedLine.includes("=") && inFirstCounterexample) {
        firstCounterexampleLines.push(trimmedLine);
      } else if (
        trimmedLine.startsWith("[FAIL]") ||
        (trimmedLine.startsWith("Counterexample:") && foundFirstCounterexample)
      ) {
        // End of current counterexample
        inFirstCounterexample = false;
      }
    }
  }

  // If no explicit counterexample markers, process all parameter lines
  const parametersToProcess =
    firstCounterexampleLines.length > 0
      ? firstCounterexampleLines
      : sequences.filter(
          (param): param is string =>
            typeof param === "string" &&
            param.includes("=") &&
            (param.startsWith("p_") ||
              param.includes("p_") ||
              param.includes("p_s."))
        );

  // First pass: process all length parameters
  parametersToProcess.forEach((param) => {
    const cleanParam = param.replace(/^["'\s]*/, "").trim();
    const [paramName, paramValue] = cleanParam.split("=").map((s) => s.trim());

    if (paramName.includes("_length")) {
      // For length parameters, store the actual numeric value
      const cleanValue = paramValue.replace(/^0x/, "");
      const lengthValue = parseInt(cleanValue, 16) || 0;
      variableMapping.set(paramName, lengthValue.toString());
    }
  });

  // Second pass: process all non-length parameters
  parametersToProcess.forEach((param) => {
    const cleanParam = param.replace(/^["'\s]*/, "").trim();
    const [paramName, paramValue] = cleanParam.split("=").map((s) => s.trim());

    if (!paramName.includes("_length")) {
      // Create a map with all the length parameters
      const lengthMap = new Map<string, string>();
      for (const [key, value] of variableMapping) {
        if (key.includes("_length")) {
          lengthMap.set(key, value);
        }
      }

      const solidityDeclaration = formatSolidityValue(
        paramName,
        paramValue,
        lengthMap
      );

      const varPattern = /\w+\s+(\w+)\s*=/;
      const varMatch = varPattern.exec(solidityDeclaration);
      if (varMatch) {
        const varName = varMatch[1];
        if (!usedVariableNames.has(varName)) {
          parameterDeclarations.push(`    ${solidityDeclaration}`);
          usedVariableNames.add(varName);
          variableMapping.set(paramName, varName);
        }
      }
    }
  });

  sequences
    .filter(
      (line): line is string =>
        typeof line === "string" && line.startsWith("CALL ")
    )
    .forEach((callLine) => {
      const parsedCall = parseCallStatement(callLine);
      if (parsedCall) {
        const { functionName: callFunctionName, parameters } = parsedCall;

        const mappedParams = parameters.map((param) => {
          const paramMatch = /p_\w+_[a-f0-9]+_\d+/.exec(param);
          if (paramMatch) {
            const paramName = paramMatch[0];
            const mappedVar = variableMapping.get(paramName);
            if (mappedVar) {
              return mappedVar;
            }

            const baseName = paramName.split("_")[1]; // Extract base name like "flag", "account", etc.
            for (const [key, value] of variableMapping) {
              if (key.includes(baseName)) {
                return value;
              }
            }
            return paramName;
          }

          if (param.startsWith("p_")) {
            const mappedVar = variableMapping.get(param);
            if (mappedVar) {
              return mappedVar;
            }

            const baseName = param.split("_")[1];
            for (const [key, value] of variableMapping) {
              if (key.includes(baseName)) {
                return value;
              }
            }
          }

          return param;
        });

        const functionCallStr = `${callFunctionName}(${mappedParams.join(
          ", "
        )})`;
        sequenceCalls.push(`    ${functionCallStr};`);
      }
    });

  const arrayInfo = generateArrayDeclarations(variableMapping);
  if (arrayInfo.declarations.length > 0) {
    arrayDeclarations.push(...arrayInfo.declarations);
    arrayInfo.arrayVariables.forEach((varName: string, arrayName: string) => {
      variableMapping.set(arrayName, varName);
    });
  }

  const parts = [
    `function ${functionName}() public {`,
    `    // Counterexample for: ${propSeq.brokenProperty}`,
  ];

  if (parameterDeclarations.length > 0) {
    parts.push("", "    // Parameter declarations:");
    parts.push(...parameterDeclarations);
  }

  if (arrayDeclarations.length > 0) {
    parts.push("", "    // Array declarations:");
    parts.push(...arrayDeclarations);
  }

  parts.push("", "    // Reproduction sequence:");

  if (sequenceCalls.length > 0) {
    parts.push(...sequenceCalls);

    if (propSeq.brokenProperty.includes("invariant")) {
      const invariantCall = generateFunctionCall(
        propSeq.brokenProperty,
        variableMapping
      );
      parts.push(`    ${invariantCall};`);
    }
  } else {
    const functionCall = generateFunctionCall(
      propSeq.brokenProperty,
      variableMapping
    );
    parts.push(`    ${functionCall};`);
  }

  parts.push("}");

  return parts.join("\n");
};
