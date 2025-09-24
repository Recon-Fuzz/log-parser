import { FuzzingResults, VmParsingData } from "../types/types";
import {
    buildReprosFromHalmosLogs,
    parseAddressBook,
    parseFailedProperties,
    parseTargetFunctions,
} from "./functionGenerator";

// Parse the entire Halmos log and update the jobStats counters and results list
export const processHalmos = (logs: string, jobStats: FuzzingResults, maxCounterexamples: number = 1) => {
    // Collect result lines
    const resultLines = logs
        .split("\n")
        .filter((l) => l.startsWith("[PASS]") || l.startsWith("[FAIL]") || l.startsWith("[TIMEOUT]"));

    jobStats.results.push(...resultLines);

    jobStats.passed = resultLines.filter((l) => l.startsWith("[PASS]")).length;
    // failed will be finalized later from parseFailedProperties (which includes inline assertions)
    jobStats.failed = resultLines.filter((l) => l.startsWith("[FAIL]")).length;
    // TIMEOUT is informational here; we don't store a separate counter in FuzzingResults

    // Extract the address section once so we can prefix sequences for proper address mapping
    const addressSection = extractAddressSection(logs);

    // Only produce broken properties when we detect failures ([FAIL] lines or inline assertion failures)
    const allowedFailedProps = parseFailedProperties(logs);
    // Also synthesize result lines for each target function based on whether it failed via inline assertion
    const targets = Array.from(parseTargetFunctions(logs)); // e.g., fn(uint256)
    const existingProps = new Set(
        jobStats.results
            .map((l) => /\[(?:PASS|FAIL|TIMEOUT)\]\s+([^\(\[]+)/.exec(l)?.[1]?.trim())
            .filter((x): x is string => !!x)
    );
    for (const sig of targets) {
        const nameOnly = sig.replace(/\(.*/, "");
        // Skip if already present in result lines
        if (existingProps.has(nameOnly)) continue;
        if (allowedFailedProps.has(nameOnly)) {
            // Use full signature when synthesizing FAIL entries
            jobStats.results.push(`[FAIL] ${sig} (paths: -, time: -, bounds: [])`);
        } else {
            jobStats.results.push(`[PASS] ${sig} (paths: -, time: -, bounds: [])`);
        }
    }
    if (allowedFailedProps.size > 0) {
        // Extract each Trace/Counterexample/Sequence block and attach it as a brokenProperty entry,
        // capped by maxCounterexamples per property, preferring empty counterexamples when present.
        const traceBlocks = extractTraceBlocks(logs);
        const byProp = new Map<string, Array<{ block: string; empty: boolean }>>();
        for (const tb of traceBlocks) {
            if (!tb.property) continue;
            // Filter to only properties considered failed
            if (!allowedFailedProps.has(tb.property)) continue;
            const arr = byProp.get(tb.property) ?? [];
            arr.push({ block: tb.block, empty: tb.empty });
            byProp.set(tb.property, arr);
        }
        for (const [prop, arr] of byProp) {
            const empty = arr.find((x) => x.empty);
            if (empty) {
                jobStats.brokenProperties.push({
                    brokenProperty: prop,
                    sequence: `${addressSection}\n${empty.block}`,
                });
                continue;
            }
            const limited = arr.slice(0, Math.max(0, maxCounterexamples));
            for (const it of limited) {
                jobStats.brokenProperties.push({
                    brokenProperty: prop,
                    sequence: `${addressSection}\n${it.block}`,
                });
            }
        }
    }
    // Finalize failed count as number of unique failed properties (including inline assertions and [FAIL] lines)
    const failedFromResults = new Set(
        jobStats.results
            .filter((l) => l.startsWith("[FAIL]"))
            .map((l) => /\[FAIL\]\s+([^\(\[]+)/.exec(l)?.[1]?.trim())
            .filter((x): x is string => !!x)
    );
    allowedFailedProps.forEach((p) => failedFromResults.add(p));
    jobStats.failed = failedFromResults.size;
    // Recompute passed based on results after synthesis
    jobStats.passed = jobStats.results.filter((l) => l.startsWith("[PASS]")).length;

    // Parse final symbolic result summary for duration and (optionally) number of tests
    // Example: "Symbolic test result: 1 passed; 20 failed; time: 3.21s"
    const symRe = /Symbolic test result:\s*(\d+)\s+passed;\s*(\d+)\s+failed;\s*time:\s*([0-9.]+)s/g;
    let match: RegExpExecArray | null;
    let last: { passed: number; failed: number; time: string } | undefined;
    while ((match = symRe.exec(logs))) {
        last = { passed: parseInt(match[1], 10), failed: parseInt(match[2], 10), time: match[3] };
    }
    if (last) {
        jobStats.duration = `${last.time}s`;
        const total = last.passed + last.failed;
        if (!isNaN(total)) jobStats.numberOfTests = total;
    }
};

function extractAddressSection(logs: string): string {
    // Capture from the header line down to the closing box line that starts with '╰'
    const m = /Initial Invariant Target Functions[\s\S]*?\n╰.*\n/m.exec(logs);
    return m ? m[0] : "";
}

function extractTraceBlocks(logs: string): Array<{ property: string; block: string; empty: boolean }> {
    const res: Array<{ property: string; block: string; empty: boolean }> = [];
    const regex = /Trace:[\s\S]*?(?=(?:\nTrace:)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(logs))) {
        const block = m[0].trimEnd();
        const prop = extractPropFromTraceBlock(block);
        const empty = /Counterexample:\s*∅/.test(block);
        // Keep only non-empty blocks that contain at least one CALL
        if (prop && /\bCALL\b/.test(block)) {
            res.push({ property: prop, block, empty });
        }
    }
    return res;
}

function extractPropFromTraceBlock(block: string): string {
    // The first CALL line indicates which invariant/property was executed, e.g.
    // CALL CryticTester::invariant_amt_isAbove0()
    const m = /CALL\s+[^:]+::([^\(\n]+)\(/.exec(block);
    return m ? m[1].trim() : "";
}

// Convert Halmos logs to Foundry test functions
export const halmosLogsToFunctions = (
    input: string,
    prefix: string,
    brokenProp?: string,
    _vmData?: VmParsingData,
    maxCounterexamples: number = 1
): string => {
    // Build address maps from the initial target section
    const addressBook = parseAddressBook(input);
    // Decide which properties to emit: either specific or all failed ones
    const failedProps = brokenProp
        ? new Set<string>([brokenProp])
        : parseFailedProperties(input);

    if (failedProps.size === 0) {
        return "// No failed properties found in Halmos logs";
    }
    return buildReprosFromHalmosLogs(input, prefix, addressBook, failedProps, { maxCounterexamples });
};