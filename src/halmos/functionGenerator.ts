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

  const types = paramTypes.split(",").map((t) => t.trim());
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

  sequences
    .filter(
      (param): param is string =>
        typeof param === "string" &&
        param.includes("=") &&
        param.startsWith("p_")
    )
    .forEach((param) => {
      const [paramName, paramValue] = param.split("=").map((s) => s.trim());
      const solidityDeclaration = formatSolidityValue(paramName, paramValue);

      const varPattern = /\w+\s+(\w+)\s*=/;
      const varMatch = varPattern.exec(solidityDeclaration);
      if (varMatch) {
        const varName = varMatch[1];
        if (!usedVariableNames.has(varName)) {
          if (!paramName.includes("_length")) {
            parameterDeclarations.push(`    ${solidityDeclaration}`);
          }
          usedVariableNames.add(varName);
          variableMapping.set(paramName, varName);
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
