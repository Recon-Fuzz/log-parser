import { toChecksumAddress } from 'ethereumjs-util';

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

export function correctAllChecksums(input: string): string {
  return input.replace(/0x[0-9a-fA-F]{40}/g, (match) => correctChecksum(match));
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

export function formatBytes(input: string): string {
  // Regular expression to match byte sequences (hexadecimal sequences without '0x' and not mistaken for Ethereum addresses)
  const potentialBytes = input.match(/\b(?!0x)(?=.*[a-fA-F])[0-9a-fA-F]{2,}\b/g);

  if (potentialBytes) {
    potentialBytes.forEach(byteSequence => {
      input = input.replace(byteSequence, `hex"${byteSequence}"`);
    });
  }
  return input;
}

export function _processTraceLogs(logs: string[]): string[] {
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

  return result;
}
