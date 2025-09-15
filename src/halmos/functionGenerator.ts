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
  // Track msg.value variables that are explicitly zero to omit {value: ...}
  const zeroMsgValueKeys = new Set<string>();
  // When any msg.value variable is declared as zero, omit value from all calls
  let anyMsgValueZero = false;

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
              param.includes("p_s.") ||
              param.startsWith("halmos_msg_value_"))
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

          // Track zero msg.value to omit value decorator in calls
          if (paramName.startsWith("halmos_msg_value_")) {
            const raw = paramValue.trim();
            const hex = raw.toLowerCase().startsWith("0x") ? raw.slice(2) : raw;
            const isZero = hex.length === 0 || /^0+$/.test(hex);
            if (isZero) {
              zeroMsgValueKeys.add(paramName);
              anyMsgValueZero = true;
            }
          }
        }
      }
    }
  });

  sequences
    .filter(
      (line): line is string =>
        typeof line === "string" &&
        line.startsWith("CALL ") &&
        !line.includes("hevm::prank")
    )
    .forEach((callLine) => {
      const parsedCall = parseCallStatement(callLine);
      if (parsedCall) {
        const {
          functionName: callFunctionName,
          parameters,
          msgValue,
        } = parsedCall;

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

        let functionCallStr = "";
        let shouldIncludeValue = false;
        if (msgValue) {
          if (anyMsgValueZero) {
            // If any msg.value is explicitly zero, omit value decorator entirely
            shouldIncludeValue = false;
          } else if (!zeroMsgValueKeys.has(msgValue)) {
            // Fallback: inspect the mapped variable declaration to see if it's zero
            const mappedMsgValueVar = variableMapping.get(msgValue);
            if (mappedMsgValueVar) {
              const decl = parameterDeclarations.find((d) =>
                d.includes(` ${mappedMsgValueVar} = 0x`)
              );
              if (decl) {
                const hexPart = (decl.split("= 0x")[1] || "")
                  .replace(/;$/, "")
                  .trim();
                // Treat empty or all-zero as zero
                const isZeroHex = hexPart.length === 0 || /^0+$/i.test(hexPart);
                shouldIncludeValue = !isZeroHex;
              } else {
                // If we can't find the declaration, include it conservatively
                shouldIncludeValue = true;
              }
            } else {
              // No mapping available, include it conservatively
              shouldIncludeValue = true;
            }
          }
        }

        if (msgValue && shouldIncludeValue) {
          const mappedMsgValue = variableMapping.get(msgValue) || msgValue;
          functionCallStr = `${callFunctionName}{value: ${mappedMsgValue}}(${mappedParams.join(
            ", "
          )})`;
        } else {
          functionCallStr = `${callFunctionName}(${mappedParams.join(", ")})`;
        }
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
