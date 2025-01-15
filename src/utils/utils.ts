import { toChecksumAddress, bufferToInt, toBuffer } from "ethereumjs-util";

export function captureFuzzingDuration(line: string): string | null {
  const pattern = /\b(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?\b/;
  const match = line.match(pattern);
  if (match) {
    return match[0];
  } else {
    return null;
  }
}

export function correctChecksum(address: string): string {
  try {
    return toChecksumAddress(address);
  } catch (error) {
    return address; // Return the original address if it's invalid
  }
}

export function correctAllChecksums(input: string) {
  return input.replace(/0x[0-9a-fA-F]{1,40}/g, (match) => {
    const correctedAddress = convertToEthereumAddress(match);
    return correctChecksum(correctedAddress);
  });
}

export function formatAddress(input: string): string {
  let cleanedData = "";
  const potentialAddrUser = input.match(/0x[0-9a-fA-F]{40}/);
  if (potentialAddrUser) {
    cleanedData += `\n   ${correctAllChecksums(input)};`;
  } else {
    cleanedData += `\n   ${input};`;
  }
  return cleanedData;
}

export function parseHexValue(input: string): string {
  const value = input.split(" Value: ")[1];
  const fnCall = input.split("(");
  try {
    // Remove 0x prefix if present
    const cleanHex = value.slice(2);
    // Convert to buffer
    const buffer = toBuffer(`0x${cleanHex}`);
    // Convert buffer to integer
    const valueNumber = bufferToInt(buffer);
    return `${fnCall[0]}{value: ${valueNumber}}(${
      fnCall[1].split(" Value: ")[0]
    }`;
  } catch (e) {
    console.error("Failed to parse hex value:", e);
    return "";
  }
}

export function formatBytes(input: string) {
  const parenthesesRegex = /\(([^)]+)\)/;
  const match = parenthesesRegex.exec(input);

  if (match && match[1]) {
    let innerContent = match[1];

    const byteSequenceRegex = /\b(?!0x)(?=\w*[a-fA-F])\w{2,}\b/g;
    const potentialBytes = innerContent.match(byteSequenceRegex);
    if (potentialBytes) {
      innerContent = innerContent.replace(
        /\b(?!0x)(?=\w*[a-fA-F])\w{2,}\b(?!")/g,
        (byteSequence) => {
          // Only wrap sequences not already wrapped with hex""
          if (!byteSequence.startsWith('hex"')) {
            return `hex"${byteSequence}"`;
          }
          return byteSequence;
        }
      );
    }

    input = input.replace(match[1], innerContent);
  }

  return input;
}

export function processTraceLogs(logs: string[]): string[] {
  const result: string[] = [];
  let currentItem: string = "";

  for (const log of logs) {
    if (!log.includes("---End Trace---")) {
      currentItem += log + "\n";
    } else {
      result.push(currentItem.trim());
      currentItem = "";
    }
  }

  // Add any remaining logs if they don't end with "End trace"
  if (currentItem.trim().length > 0) {
    result.push(currentItem.trim());
  }

  return result.filter((el) => el !== "");
}

function convertToEthereumAddress(rawBytes: string) {
  let hexString = rawBytes.startsWith("0x") ? rawBytes.slice(2) : rawBytes;

  const paddedHexString = hexString.padStart(40, "0");

  const ethereumAddress = "0x" + paddedHexString;

  return ethereumAddress;
}

export const parseTimestamp = (log: string): Date | null => {
  const timestampRegex = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{2})\]/;
  const match = log.match(timestampRegex);
  if (match) {
    return new Date(match[1].replace(" ", "T"));
  } else {
    return null;
  }
};

export const formatTimeDifference = (diffSeconds: number): string => {
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = Math.floor(diffSeconds % 60);

  const formattedTime = `${hours > 0 ? `${hours}h` : ""}${
    minutes > 0 ? `${minutes}m` : ""
  }${seconds}s`;
  return formattedTime;
};

export function isInsideQuotes(line: string, pos: number): boolean {
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < pos; i++) {
    if (line[i] === "\\") {
      escaped = !escaped;
      continue;
    }
    if (line[i] === '"' && !escaped) {
      inQuotes = !inQuotes;
    }
    if (escaped) {
      escaped = false;
    }
  }
  return inQuotes;
}

export const shouldParseLine = (line: string): boolean => {
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === "[" || char === "]") && !isInsideQuotes(line, i)) {
      // Only count brackets not inside quotes and not part of function calls
      const prevChar = line[i - 1];
      const nextChar = line[i + 1];
      if (
        !(char === "[" && prevChar === "(") &&
        !(char === "]" && nextChar === ")")
      ) {
        return true;
      }
    }
  }
  return false;
};

export function parseSpecialChars(match: string): string {
  try {
    // Remove surrounding quotes
    const s = match.slice(1, -1);
    const resultBytes: number[] = [];

    // ASCII escape mappings (similar to Python's ascii_escape_map)
    const asciiEscapeMap: { [key: string]: number[] } = {
      "\\SOH": [1],
      "\\SO": [14],
      "\\EOT": [4],
      "\\DLE": [16],
      "\\DC1": [17],
      "\\DC2": [18],
      "\\DC3": [19],
      "\\DC4": [20],
      "\\SYN": [22],
      "\\ETB": [23],
      "\\ESC": [27],
      "\\FS": [28],
      "\\GS": [29],
      "\\RS": [30],
      "\\US": [31],
      "\\ETX": [3],
      "\\ENQ": [5],
      "\\ACK": [6],
      "\\BEL": [7],
      "\\BS": [8],
      "\\HT": [9],
      "\\LF": [10],
      "\\VT": [11],
      "\\FF": [12],
      "\\CR": [13],
      "\\SI": [15],
      "\\SUB": [26],
      "\\EM": [25],
      "\\CAN": [24],
      "\\NAK": [21],
      "\\f": [12],
      "\\n": [10],
      "\\r": [13],
      "\\t": [9],
      "\\v": [11],
    };

    // Process string character by character
    let i = 0;
    while (i < s.length) {
      // Check for escape sequence
      if (s[i] === "\\") {
        let matched = false;

        // Check known escape sequences
        for (const [seq, bytes] of Object.entries(asciiEscapeMap)) {
          if (s.startsWith(seq, i)) {
            resultBytes.push(...bytes);
            i += seq.length;
            matched = true;
            break;
          }
        }

        if (!matched) {
          // Check for decimal escape (like \160)
          const decMatch = s.slice(i).match(/^\\(\d{1,3})/);
          if (decMatch) {
            const decimalValue = parseInt(decMatch[1], 10);
            resultBytes.push(decimalValue);
            i += decMatch[0].length;
          } else {
            // Handle octal escapes
            const octMatch = s.slice(i).match(/^\\([0-7]{1,3})/);
            if (octMatch) {
              const octalValue = parseInt(octMatch[1], 8);
              resultBytes.push(octalValue);
              i += octMatch[0].length;
            } else {
              // Skip unknown escape
              i++;
            }
          }
        }
      } else {
        // Normal character
        resultBytes.push(s.charCodeAt(i));
        i++;
      }
    }

    // Convert to hex string
    const hexString = Buffer.from(resultBytes).toString("hex");
    return `hex"${hexString}"`;
  } catch (e) {
    console.error("Failed to parse special chars:", e);
    return match;
  }
}
