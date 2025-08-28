// No imports needed for this file

export const findMatchingVariable = (
  type: string,
  position: number,
  variableMapping: Map<string, string>
): string | null => {
  // Debug output removed for production

  if (type.includes("[") && type.includes("]")) {
    const baseType = type.replace("[]", "");

    // Simple approach: look for array variables directly in the mapping
    // Array variables are stored as arrayName -> arrayVarName (e.g., "keys" -> "keys_array")
    const arrayVariables: string[] = [];

    for (const [key, value] of variableMapping) {
      // Look for array variable names (they end with "_array" or are nested arrays)
      const isRegularArray = value.endsWith("_array");
      const isNestedArray =
        !value.endsWith("_array") &&
        !key.includes("_length") &&
        !key.includes("_bytes") &&
        !key.includes("_address") &&
        !key.includes("_uint") &&
        !key.includes("_bool");

      if (isRegularArray || isNestedArray) {
        // Check if this array matches the expected type by looking at the original parameters
        const arrayName = key; // e.g., "keys", "values", "registers"

        // Try to determine the array type from the counterexample parameters
        let arrayType = "uint256"; // default

        // Look for array elements to determine type
        const elementPattern =
          /^p_(.+)\[(\d+)\]_(address|uint\d+|int\d+|bool|bytes\d*|string)_/;
        for (const [paramName] of variableMapping) {
          const match = elementPattern.exec(paramName);
          if (match && match[1] === arrayName) {
            const typeIndicator = match[3];
            if (typeIndicator === "address") {
              arrayType = "address";
            } else if (typeIndicator === "bool") {
              arrayType = "bool";
            } else if (typeIndicator.startsWith("uint")) {
              arrayType = typeIndicator;
            } else if (typeIndicator.startsWith("int")) {
              arrayType = typeIndicator;
            } else if (typeIndicator === "bytes") {
              arrayType = "bytes";
            }
            break;
          }
        }

        // For nested arrays, also check for length parameters to determine type
        if (isNestedArray && arrayType === "uint256") {
          const nestedLengthPattern = new RegExp(
            `p_${arrayName}\\[\\d+\\]_length`
          );
          for (const [paramName] of variableMapping) {
            if (nestedLengthPattern.test(paramName)) {
              arrayType = "bytes"; // Nested arrays with length are typically bytes[]
              break;
            }
          }
        }

        // If no elements found, try to infer from array name
        if (arrayType === "uint256") {
          if (arrayName.includes("address")) {
            arrayType = "address";
          } else if (arrayName.includes("bool")) {
            arrayType = "bool";
          } else if (arrayName.includes("values")) {
            arrayType = "uint256";
          }
        }

        // Debug output removed for production

        if (arrayType === baseType) {
          arrayVariables.push(value);
        }
      }
    }

    if (arrayVariables.length > 0 && position < arrayVariables.length) {
      return arrayVariables[position];
    }

    return createArrayParameter(type, variableMapping);
  }

  const typePatterns = {
    address: ["_address"],
    bool: ["_bool"],
    uint256: ["_uint256"],
    uint8: ["_uint8"],
    uint16: ["_uint16"],
    uint32: ["_uint32"],
    uint64: ["_uint64"],
    uint128: ["_uint128"],
    bytes: ["_bytes"],
    string: ["_string"],
  };

  const positionNames = ["a", "b", "c", "d", "e"];
  if (position < positionNames.length) {
    const expectedName = `${positionNames[position]}_${type.replace("[]", "")}`;
    for (const [paramName, varName] of variableMapping) {
      if (
        paramName.includes(expectedName.replace("uint256", "uint256")) ||
        paramName.includes(expectedName.replace("address", "address")) ||
        paramName.includes(expectedName.replace("bool", "bool"))
      ) {
        return varName;
      }
    }
  }

  const patterns = typePatterns[type as keyof typeof typePatterns] || [
    `_${type}`,
  ];
  for (const pattern of patterns) {
    for (const [paramName, varName] of variableMapping) {
      if (paramName.includes(pattern)) {
        return varName;
      }
    }
  }

  for (const [paramName, varName] of variableMapping) {
    if (paramName.includes(`_${type}_`) || paramName.includes(`_${type}`)) {
      return varName;
    }
  }

  return null;
};

export const createArrayParameter = (
  type: string,
  variableMapping: Map<string, string>
): string => {
  const arrayElements: string[] = [];
  let arrayLength = 0;

  const elementMap = new Map<number, string>();
  const elementPattern = /arr\[(\d+)\]/;

  for (const [paramName, varName] of variableMapping) {
    const match = elementPattern.exec(paramName);
    if (match) {
      const index = parseInt(match[1], 10);
      elementMap.set(index, varName);
      arrayLength = Math.max(arrayLength, index + 1);
    }
  }

  for (let i = 0; i < arrayLength; i++) {
    const element = elementMap.get(i);
    if (element) {
      arrayElements.push(element);
    }
  }

  if (arrayElements.length > 0) {
    return `[${arrayElements.join(", ")}]`;
  }

  return `/* ${type} parameter */`;
};

export const generateArrayDeclarations = (
  variableMapping: Map<string, string>
): { declarations: string[]; arrayVariables: Map<string, string> } => {
  const declarations: string[] = [];
  const arrayVariables = new Map<string, string>();

  const arrayGroups = new Map<
    string,
    {
      elements: Map<number, string>;
      type: string;
      length: number;
    }
  >();

  // Track nested arrays like registers[0], registers[1]
  const nestedArrays = new Map<
    string,
    {
      parentArray: string;
      elementLengths: Map<number, number>;
      elementType: string;
    }
  >();

  // Pattern to match array elements like "p_keys[0]_address_f8a6ab2_00"
  // We want to capture: arrayName, index, and type (address/uint256/bool/etc)
  const elementPattern =
    /^p_(.+)\[(\d+)\]_(address|uint\d+|int\d+|bool|bytes\d*|string)_/;
  const lengthPattern = /^p_(.+)_length/;

  // Pattern to match nested array lengths like "p_registers[0]_length_101b512_00"
  const nestedLengthPattern = /^p_(.+)\[(\d+)\]_length/;

  // First pass: collect array elements and determine types from counterexample variable names
  for (const [paramName, varName] of variableMapping) {
    const match = elementPattern.exec(paramName);
    if (match) {
      const arrayName = match[1]; // e.g., "keys", "values"
      const index = parseInt(match[2], 10);
      const typeIndicator = match[3]; // e.g., "address", "uint256"

      // Map type indicators to Solidity types
      let elementType = "uint256"; // default
      if (typeIndicator === "address") {
        elementType = "address";
      } else if (typeIndicator === "bool") {
        elementType = "bool";
      } else if (typeIndicator.startsWith("uint")) {
        elementType = typeIndicator;
      } else if (typeIndicator.startsWith("int")) {
        elementType = typeIndicator;
      } else if (typeIndicator === "bytes") {
        elementType = "bytes";
      }

      if (!arrayGroups.has(arrayName)) {
        arrayGroups.set(arrayName, {
          elements: new Map(),
          type: elementType,
          length: 0,
        });
      }

      const arrayGroup = arrayGroups.get(arrayName)!;
      arrayGroup.elements.set(index, varName);
      // Always update type based on the most recent element type found
      arrayGroup.type = elementType;
      arrayGroup.length = Math.max(arrayGroup.length, index + 1);
    }
  }

  // Second pass: collect array lengths and nested array lengths
  for (const [paramName] of variableMapping) {
    // Check for nested array lengths first (e.g., "p_registers[0]_length")
    const nestedLengthMatch = nestedLengthPattern.exec(paramName);
    if (nestedLengthMatch) {
      const parentArrayName = nestedLengthMatch[1]; // e.g., "registers"
      const elementIndex = parseInt(nestedLengthMatch[2], 10); // e.g., 0
      const lengthValue = variableMapping.get(paramName);

      if (lengthValue) {
        if (!nestedArrays.has(parentArrayName)) {
          nestedArrays.set(parentArrayName, {
            parentArray: parentArrayName,
            elementLengths: new Map(),
            elementType: "bytes", // Default to bytes for nested arrays
          });
        }

        const nestedArray = nestedArrays.get(parentArrayName)!;
        const length = parseInt(lengthValue, 10) || 0;
        nestedArray.elementLengths.set(elementIndex, length);
      }
      continue;
    }

    const lengthMatch = lengthPattern.exec(paramName);
    if (lengthMatch) {
      const arrayName = lengthMatch[1];
      const lengthVar = variableMapping.get(paramName);

      const isBytesLength = Array.from(variableMapping.keys()).some(
        (key) =>
          key.includes(`p_${arrayName}_bytes`) ||
          (key.includes(`p_${arrayName}_`) && key.includes("_bytes_"))
      );

      const isNestedArrayLength = Array.from(variableMapping.keys()).some(
        (key) => key.includes(`p_${arrayName}[`) && key.includes("]_length")
      );

      if (
        lengthVar &&
        !arrayGroups.has(arrayName) &&
        !isBytesLength &&
        !isNestedArrayLength
      ) {
        // Infer type from array name if no elements were found
        let elementType = "uint256"; // default
        if (arrayName.includes("address") || arrayName.includes("keys")) {
          elementType = "address";
        } else if (arrayName.includes("bool")) {
          elementType = "bool";
        } else if (arrayName.includes("values")) {
          elementType = "uint256"; // values arrays are typically uint256
        }

        // Parse the length value (should be a string representation of a number)
        let arrayLength = 0;
        try {
          // lengthVar is now the actual numeric value as a string
          arrayLength = parseInt(lengthVar, 10) || 0;
        } catch {
          arrayLength = 0;
        }

        arrayGroups.set(arrayName, {
          elements: new Map(),
          type: elementType,
          length: arrayLength,
        });
      } else if (lengthVar && arrayGroups.has(arrayName)) {
        // Update length if we have the length variable
        const arrayGroup = arrayGroups.get(arrayName)!;
        try {
          const parsedLength = parseInt(lengthVar, 10) || arrayGroup.length;
          arrayGroup.length = Math.max(arrayGroup.length, parsedLength);
        } catch {
          // Keep existing length
        }
      }
    }
  }

  // Generate array declarations
  for (const [arrayName, arrayInfo] of arrayGroups) {
    const arrayVarName = `${arrayName}_array`;
    const { elements, type: elementType, length } = arrayInfo;

    // Generate array declaration and element assignments

    // Create array declaration
    declarations.push(
      `    ${elementType}[] memory ${arrayVarName} = new ${elementType}[](${length});`
    );

    // Add element assignments
    for (let i = 0; i < length; i++) {
      const elementVar = elements.get(i);
      if (elementVar) {
        declarations.push(`    ${arrayVarName}[${i}] = ${elementVar};`);
      }
      // If no element variable, the array slot remains at default value (0 or address(0))
    }

    arrayVariables.set(arrayName, arrayVarName);
  }

  for (const [parentArrayName, nestedInfo] of nestedArrays) {
    const { elementLengths, elementType } = nestedInfo;
    const parentArrayVarName = parentArrayName;

    const maxIndex = Math.max(...elementLengths.keys(), -1);
    const parentArrayLength = maxIndex + 1;

    const parentLengthKey = `p_${parentArrayName}_length`;
    const parentLengthVar = variableMapping.get(parentLengthKey);
    const actualParentLength = parentLengthVar
      ? parseInt(parentLengthVar, 10)
      : parentArrayLength;

    declarations.push(
      `    ${elementType}[] memory ${parentArrayVarName} = new ${elementType}[](${actualParentLength});`
    );

    for (let i = 0; i < actualParentLength; i++) {
      const elementLength = elementLengths.get(i) || 0;
      declarations.push(
        `    ${parentArrayVarName}[${i}] = new ${elementType}(${elementLength});`
      );
    }

    arrayVariables.set(parentArrayName, parentArrayVarName);
  }

  return { declarations, arrayVariables };
};
