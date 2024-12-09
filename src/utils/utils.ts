import { toChecksumAddress } from "ethereumjs-util";

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

  return result.filter(el => el !== "");
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
    if (line[i] === '\\') {
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
    if ((char === '[' || char === ']') && !isInsideQuotes(line, i)) {
      // Only count brackets not inside quotes and not part of function calls
      const prevChar = line[i-1];
      const nextChar = line[i+1];
      if (!(char === '[' && prevChar === '(') &&
          !(char === ']' && nextChar === ')')) {
        return true;
      }
    }
  }
  return false;
};
