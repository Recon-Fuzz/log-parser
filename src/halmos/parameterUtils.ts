export const parseCallStatement = (
  callLine: string
): { functionName: string; parameters: string[] } | null => {
  const callMatch = callLine.match(/CALL\s+\w+::(\w+)\(([^)]*)\)/);
  if (!callMatch) {
    return null;
  }

  const functionName = callMatch[1];
  const paramString = callMatch[2].trim();

  if (!paramString) {
    return { functionName, parameters: [] };
  }

  if (paramString.startsWith("Concat(")) {
    const concatContent = paramString.slice(7, -1);
    const concatParams = parseConcatParameters(concatContent);
    return { functionName, parameters: concatParams };
  }

  const parameters: string[] = [];
  let currentParam = "";
  let parenDepth = 0;
  let i = 0;

  while (i < paramString.length) {
    const char = paramString[i];

    if (char === "(") {
      parenDepth++;
      currentParam += char;
    } else if (char === ")") {
      parenDepth--;
      currentParam += char;
    } else if (char === "," && parenDepth === 0) {
      if (currentParam.trim()) {
        parameters.push(currentParam.trim());
      }
      currentParam = "";
    } else {
      currentParam += char;
    }
    i++;
  }

  if (currentParam.trim()) {
    parameters.push(currentParam.trim());
  }

  return { functionName, parameters };
};

export const parseConcatParameters = (concatContent: string): string[] => {
  const parameters: string[] = [];
  let currentParam = "";
  let parenDepth = 0;
  let i = 0;

  while (i < concatContent.length) {
    const char = concatContent[i];

    if (char === "(") {
      parenDepth++;
      currentParam += char;
    } else if (char === ")") {
      parenDepth--;
      currentParam += char;
    } else if (char === "," && parenDepth === 0) {
      const param = currentParam.trim();
      if (param?.startsWith("p_")) {
        parameters.push(param);
      }
      currentParam = "";
    } else {
      currentParam += char;
    }
    i++;
  }

  const lastParam = currentParam.trim();
  if (lastParam?.startsWith("p_")) {
    parameters.push(lastParam);
  }

  return parameters;
};

export const cleanParameterName = (paramName: string): string =>
  paramName
    .replace(/^p_/, "")
    .replace(/^s\./, "") // Handle struct member notation like p_s.flag_bool_...
    .replace(/_[a-f0-9]+_\d+$/, "")
    .replace(/_[a-zA-Z0-9]+_\d+$/, "")
    .replace(/\[(\d+)\]/, "$1");

export const extractTypeFromParamName = (paramName: string): string => {
  if (paramName.includes("_bool")) return "bool";
  if (paramName.includes("_address")) return "address";
  if (paramName.includes("_uint256")) return "uint256";
  if (paramName.includes("_uint8")) return "uint8";
  if (paramName.includes("_uint16")) return "uint16";
  if (paramName.includes("_uint32")) return "uint32";
  if (paramName.includes("_uint64")) return "uint64";
  if (paramName.includes("_uint128")) return "uint128";
  if (paramName.includes("_bytes")) return "bytes";
  if (paramName.includes("_string")) return "string";

  const uintMatch = paramName.match(/_uint(\d+)_/);
  if (uintMatch) return `uint${uintMatch[1]}`;

  const intMatch = paramName.match(/_int(\d+)_/);
  if (intMatch) return `int${intMatch[1]}`;

  const bytesMatch = paramName.match(/_bytes(\d+)_/);
  if (bytesMatch) return `bytes${bytesMatch[1]}`;

  return "uint256";
};

export const formatSolidityValue = (
  paramName: string,
  value: string,
  lengthMapping?: Map<string, string>
): string => {
  const cleanName = cleanParameterName(paramName);
  const cleanValue = value.replace(/^0x/, "");
  const type = extractTypeFromParamName(paramName);

  if (type === "bool") {
    const boolValue =
      cleanValue === "01" || cleanValue === "true" || cleanValue === "1"
        ? "true"
        : "false";
    return `bool ${cleanName} = ${boolValue};`;
  }

  if (type === "address") {
    return `address ${cleanName} = 0x${cleanValue.padStart(40, "0")};`;
  }

  if (type.startsWith("uint") || type.startsWith("int")) {
    return `${type} ${cleanName} = 0x${cleanValue};`;
  }

  if (type === "bytes") {
    // For dynamic bytes, check if we have length information
    if (lengthMapping) {
      // Try different patterns to find the length parameter
      const possibleLengthKeys = [
        paramName.replace(/_bytes_[a-f0-9]+_\d+$/, "_length"),
        paramName.replace(/_bytes[^_]*_[a-f0-9]+_\d+$/, "_length"),
        `p_${cleanName}_length`,
      ];

      let lengthValue: string | undefined;

      for (const key of possibleLengthKeys) {
        lengthValue = lengthMapping.get(key);
        if (lengthValue) break;
      }

      if (!lengthValue) {
        for (const [mapKey, mapValue] of lengthMapping) {
          // Match patterns like p_blueprint_length_4558c73_00 for blueprint_bytes
          const baseParamName = cleanName.replace(/_bytes$/, ""); // Remove _bytes suffix if present
          if (
            mapKey.includes(`p_${baseParamName}_length`) ||
            (mapKey.includes(baseParamName) && mapKey.includes("length"))
          ) {
            lengthValue = mapValue;
            break;
          }
        }
      }

      if (lengthValue) {
        const length = parseInt(lengthValue, 10);
        const truncatedValue = cleanValue.substring(0, length * 2); // 2 hex chars per byte
        return `bytes memory ${cleanName} = abi.encodePacked(hex"${truncatedValue}");`;
      }
    }

    // Check if this is a bytes4 type (4 bytes = 8 hex chars) or selector
    if (cleanValue.length <= 8 || cleanName.includes("selector")) {
      return `bytes4 ${cleanName} = 0x${cleanValue.padEnd(8, "0")};`;
    }

    return `bytes memory ${cleanName} = 0x${cleanValue};`;
  }

  return `uint256 ${cleanName} = 0x${cleanValue};`;
};
