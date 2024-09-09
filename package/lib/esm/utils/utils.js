import { toChecksumAddress } from "ethereumjs-util";
export function captureFuzzingDuration(line) {
    const pattern = /\b(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?\b/;
    const match = line.match(pattern);
    if (match) {
        return match[0];
    }
    else {
        return null;
    }
}
export function correctChecksum(address) {
    try {
        return toChecksumAddress(address);
    }
    catch (error) {
        return address; // Return the original address if it's invalid
    }
}
export function correctAllChecksums(input) {
    return input.replace(/0x[0-9a-fA-F]{1,40}/g, (match) => {
        const correctedAddress = convertToEthereumAddress(match);
        return correctChecksum(correctedAddress);
    });
}
export function formatAddress(input) {
    let cleanedData = "";
    const potentialAddrUser = input.match(/0x[0-9a-fA-F]{40}/);
    if (potentialAddrUser) {
        cleanedData += `\n   ${correctAllChecksums(input)};`;
    }
    else {
        cleanedData += `\n   ${input};`;
    }
    return cleanedData;
}
export function formatBytes(input) {
    const parenthesesRegex = /\(([^)]+)\)/;
    const match = parenthesesRegex.exec(input);
    if (match && match[1]) {
        let innerContent = match[1];
        const byteSequenceRegex = /\b(?!0x)(?=\w*[a-fA-F])\w{2,}\b/g;
        const potentialBytes = innerContent.match(byteSequenceRegex);
        if (potentialBytes) {
            innerContent = innerContent.replace(/\b(?!0x)(?=\w*[a-fA-F])\w{2,}\b(?!")/g, (byteSequence) => {
                // Only wrap sequences not already wrapped with hex""
                if (!byteSequence.startsWith('hex"')) {
                    return `hex"${byteSequence}"`;
                }
                return byteSequence;
            });
        }
        input = input.replace(match[1], innerContent);
    }
    return input;
}
export function processTraceLogs(logs) {
    const result = [];
    let currentItem = "";
    for (const log of logs) {
        if (!log.includes("---End Trace---")) {
            currentItem += log + "\n";
        }
        else {
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
function convertToEthereumAddress(rawBytes) {
    let hexString = rawBytes.startsWith("0x") ? rawBytes.slice(2) : rawBytes;
    const paddedHexString = hexString.padStart(40, "0");
    const ethereumAddress = "0x" + paddedHexString;
    return ethereumAddress;
}
