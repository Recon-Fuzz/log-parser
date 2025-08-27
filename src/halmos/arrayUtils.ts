import { extractTypeFromParamName } from "./parameterUtils";

export const findMatchingVariable = (
  type: string,
  position: number,
  variableMapping: Map<string, string>
): string | null => {
  if (type.includes("[") && type.includes("]")) {
    const baseType = type.replace("[]", "");
    const elementPattern = /^(.+)\[(\d+)\]/;
    const lengthPattern = /^p_(.+)_length/;
    const arraysByType = new Map<string, Set<string>>();

    for (const [paramName] of variableMapping) {
      const match = elementPattern.exec(paramName);
      if (match) {
        const fullArrayName = match[1];
        const arrayName = fullArrayName.startsWith("p_")
          ? fullArrayName.substring(2)
          : fullArrayName;

        const paramType = extractTypeFromParamName(paramName);
        if (!arraysByType.has(paramType)) {
          arraysByType.set(paramType, new Set());
        }
        arraysByType.get(paramType)!.add(arrayName);
      }
    }

    for (const [paramName] of variableMapping) {
      const lengthMatch = lengthPattern.exec(paramName);
      if (lengthMatch) {
        const arrayName = lengthMatch[1];

        let alreadyExists = false;
        for (const [, arraySet] of arraysByType) {
          if (arraySet.has(arrayName)) {
            alreadyExists = true;
            break;
          }
        }

        if (!alreadyExists) {
          let inferredType = "uint256";
          if (arrayName.includes("address")) {
            inferredType = "address";
          } else if (arrayName.includes("bool")) {
            inferredType = "bool";
          }

          if (inferredType === baseType) {
            if (!arraysByType.has(baseType)) {
              arraysByType.set(baseType, new Set());
            }
            arraysByType.get(baseType)!.add(arrayName);
          }
        }
      }
    }

    const matchingArrays = arraysByType.get(baseType);

    if (matchingArrays && matchingArrays.size > 0) {
      const sortedArrayNames = Array.from(matchingArrays).sort();

      if (position < sortedArrayNames.length) {
        const arrayName = sortedArrayNames[position];
        const arrayVarName = `${arrayName}_array`;

        if (variableMapping.has(arrayName)) {
          return variableMapping.get(arrayName)!;
        }

        return arrayVarName;
      }
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
    Map<number, { varName: string; type: string }>
  >();

  const elementPattern = /^(.+)\[(\d+)\]/;
  const lengthPattern = /^p_(.+)_length/;

  for (const [paramName, varName] of variableMapping) {
    const match = elementPattern.exec(paramName);
    if (match) {
      const fullArrayName = match[1]; // e.g., "p_keys", "p_values", "arr"
      const index = parseInt(match[2], 10);

      const arrayName = fullArrayName.startsWith("p_")
        ? fullArrayName.substring(2)
        : fullArrayName;

      const type = extractTypeFromParamName(paramName);

      if (!arrayGroups.has(arrayName)) {
        arrayGroups.set(arrayName, new Map());
      }
      arrayGroups.get(arrayName)!.set(index, { varName, type });
    }
  }

  for (const [paramName] of variableMapping) {
    const lengthMatch = lengthPattern.exec(paramName);
    if (lengthMatch) {
      const arrayName = lengthMatch[1];

      if (!arrayGroups.has(arrayName)) {
        arrayGroups.set(arrayName, new Map());
      }
    }
  }

  for (const [arrayName, elements] of arrayGroups) {
    let elementType = "uint256"; // default type
    const arrayElements: string[] = [];

    if (elements.size > 0) {
      const maxIndex = Math.max(...elements.keys());

      for (let i = 0; i <= maxIndex; i++) {
        const element = elements.get(i);
        if (element) {
          arrayElements.push(element.varName);
          elementType = element.type;
        } else {
          arrayElements.push(elementType === "address" ? "address(0)" : "0");
        }
      }
    } else {
      if (arrayName.includes("address")) {
        elementType = "address";
      } else if (arrayName.includes("bool")) {
        elementType = "bool";
      }
    }

    const arrayVarName = `${arrayName}_array`;

    if (arrayElements.length > 0) {
      declarations.push(
        `    ${elementType}[] memory ${arrayVarName} = new ${elementType}[](${arrayElements.length});`
      );

      arrayElements.forEach((element, index) => {
        declarations.push(`    ${arrayVarName}[${index}] = ${element};`);
      });
    } else {
      declarations.push(
        `    ${elementType}[] memory ${arrayVarName} = new ${elementType}[](0);`
      );
    }

    arrayVariables.set(arrayName, arrayVarName);
  }

  return { declarations, arrayVariables };
};
