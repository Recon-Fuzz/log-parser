import { ethers } from "ethers";

type AddressBook = Record<string, string>; // ContractName => 0xaddr

// Public API used by src/halmos/index
export function parseAddressBook(input: string): AddressBook {
  const book: AddressBook = {};
  const sectionRegex = /Initial Invariant Target Functions([\s\S]*?)\n╰/m;
  const m = sectionRegex.exec(input);
  if (!m) return book;
  const body = m[1];
  const lineRegex = /\u2502\s+([^\s:]+)\.sol:([^\s]+)\s@\s(0x[a-fA-F0-9]{8,40})/g; // │ Counter.sol:Counter @ 0xaaaa0003
  let mo: RegExpExecArray | null;
  while ((mo = lineRegex.exec(body))) {
    const contract = mo[2];
    const addr = normalizeAddress(mo[3]);
    book[contract] = addr.toLowerCase();
  }
  return book;
}

export function parseFailedProperties(input: string): Set<string> {
  const set = new Set<string>();
  const re = /^\[FAIL\]\s+([^\(\[]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    set.add(m[1].trim());
  }
  return set;
}

interface CounterexampleBlock {
  headerLine: string; // The [FAIL] line
  traceFirstLine: string; // The first CALL line of the Trace: block (the final failing call)
  counterexampleVars: Record<string, string>; // p_* and halmos_* values
  sequenceCalls: string[]; // CALL lines inside Sequence: (filtered)
  emptyCounterexample?: boolean; // true when Counterexample: ∅
}

export interface HalmosGenOptions {
  maxCounterexamples?: number; // default 3
}

export function buildReprosFromHalmosLogs(
  input: string,
  prefix: string,
  addressBook: AddressBook,
  allowProps: Set<string>,
  options?: HalmosGenOptions
): string {
  const maxPerProp = options?.maxCounterexamples ?? 3;
  // Break the log by FAIL markers to find blocks
  const blocks = splitIntoBlocks(input);
  const filtered = blocks.filter((b) => allowProps.has(extractPropName(b.headerLine)));

  // Group by property
  const byProp = new Map<string, CounterexampleBlock[]>();
  for (const b of filtered) {
    const key = extractPropName(b.headerLine);
    const arr = byProp.get(key) || [];
    arr.push(b);
    byProp.set(key, arr);
  }

  // For any property with an empty counterexample, keep only one block (prefer the empty one)
  const flattened: CounterexampleBlock[] = [];
  for (const [prop, arr] of byProp) {
    const empty = arr.find((x) => x.emptyCounterexample);
    if (empty) {
      flattened.push(empty);
    } else {
      flattened.push(...arr.slice(0, Math.max(0, maxPerProp)));
    }
  }

  const rendered = flattened.map((b, idx) => renderFoundryTest(b, idx, prefix, addressBook));
  return rendered.join("\n\n");
}

function splitIntoBlocks(input: string): CounterexampleBlock[] {
  const results: CounterexampleBlock[] = [];

  let pos = 0;
  while (true) {
    const traceIdx = input.indexOf("Trace:", pos);
    if (traceIdx === -1) break;
    const nextTrace = input.indexOf("\nTrace:", traceIdx + 6);
    const chunk = input.slice(traceIdx, nextTrace === -1 ? input.length : nextTrace);

    // Extract first CALL line in this Trace block
    const callInTrace = (chunk.match(/^\s{4}CALL\s.*$/m) || [""])[0];

    // Build a synthetic header line capturing the function name for later filtering
    const fnName = (() => {
      const m1 = /CALL\s+[^:]+::([^\(]+)\(/.exec(callInTrace);
      return m1?.[1] ?? "unknown";
    })();
    const headerLine = `[TRACE] ${fnName}`;

    // Extract Counterexample map
    let ceMap: Record<string, string> = {};
    let ceEmpty = false;
    const ceStart = chunk.indexOf("Counterexample:");
    if (ceStart !== -1) {
      const rest = chunk.slice(ceStart);
      const seqPos = rest.indexOf("\nSequence:");
      const ceBody = seqPos !== -1 ? rest.slice(0, seqPos) : rest;
      if (!/Counterexample:\s*∅/.test(ceBody)) {
        ceMap = parseCounterexampleVars(ceBody);
      } else {
        ceEmpty = true;
      }
    }

    // Sequence CALL lines
    const sequenceCalls = extractSequenceCalls(chunk);

    results.push({
      headerLine,
      traceFirstLine: callInTrace.trim(),
      counterexampleVars: ceMap,
      sequenceCalls,
      emptyCounterexample: ceEmpty,
    });

    pos = nextTrace === -1 ? input.length : nextTrace + 1;
  }

  return results;
}

function parseCounterexampleVars(counterexampleSection: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /^\s{4}([\w\[\]\.]+)\s*=\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(counterexampleSection))) {
    const key = m[1];
    const value = m[2].trim();
    map[key] = value;
  }
  return map;
}

function extractSequenceCalls(chunk: string): string[] {
  const seqIdx = chunk.indexOf("\nSequence:");
  if (seqIdx === -1) return [];
  const after = chunk.slice(seqIdx);
  const callLines = after
    .split("\n")
    .filter((l) => /^\s{4}CALL\s/.test(l))
    .map((l) => l.trim());
  return callLines;
}

function extractPropName(headerLine: string): string {
  // Supports either [FAIL] name or [TRACE] name
  const m = /\[(?:FAIL|TRACE)\]\s+([^\(\[]+)/.exec(headerLine);
  return (m?.[1] || "").trim();
}

function renderFoundryTest(
  block: CounterexampleBlock,
  idx: number,
  prefix: string,
  addressBook: AddressBook
): string {
  const name = sanitizeTestName(extractPropName(block.headerLine));
  const header = `function test_${name}_${prefix}_${idx}() public {`;
  const bodyLines: string[] = [];

  // Render sequence first (setup), then the final trace call last
  for (const seq of block.sequenceCalls) {
    const { call, prank, pre } = renderCall(seq, block.counterexampleVars, addressBook);
    if (pre && pre.length) pre.forEach((l) => bodyLines.push(`   ${l}`));
    if (prank) bodyLines.push(`   vm.prank(${prank});`);
    bodyLines.push(`   ${call};`);
  }

  // Render final call from Trace first line, always last
  if (block.traceFirstLine) {
    const { call, prank, pre } = renderCall(block.traceFirstLine, block.counterexampleVars, addressBook);
    if (pre && pre.length) pre.forEach((l) => bodyLines.push(`   ${l}`));
    if (prank) bodyLines.push(`   vm.prank(${prank});`);
    bodyLines.push(`   ${call};`);
  }

  const footer = "}";
  return [header, ...bodyLines, footer].join("\n");
}

function sanitizeTestName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

let __tempVarId = 0;
function nextTemp(prefix = "arr"): string {
  return `${prefix}_${__tempVarId++}`;
}

function renderCall(
  traceCallLine: string,
  vars: Record<string, string>,
  addressBook: AddressBook
): { call: string; prank?: string; pre?: string[] } {
  // Example line:
  // CALL 0xaaaa0002::approve(Concat(p_spender_address_..., p_amount_uint256_...)) (value: ...) (caller: halmos_msg_sender_...)
  // or CALL CryticToFoundry::foo(...)
  const callerMatch = /\(caller:\s([^\)]+)\)$/.exec(traceCallLine);
  const callerTag = callerMatch?.[1] || "";
  const prankResolved = resolveCaller(callerTag, vars);

  // Remove trailing tags like (value: ...) and (caller: ...) before parsing target + args
  const sanitized = stripMetaTags(traceCallLine);

  // Extract target and args inside first parentheses
  const m = /^CALL\s+([^:]+)::([^\(]+)\((.*)\)/.exec(sanitized.replace(/^\s+/, ""));
  if (!m) {
    // Try form where left is a hex address: CALL 0xaaaa0003::increment()
  const fm = /^CALL\s+(0x[a-fA-F0-9]{8,40})::([^\(]+)\((.*)\)/.exec(sanitized.replace(/^\s+/, ""));
    if (!fm) return { call: "/* unable to parse call */" };
  const addr = normalizeAddress(fm[1]).toLowerCase();
    const fn = fm[2];
    const rawArgs = fm[3];
    const { args, pre } = materializeArgsWithPre(rawArgs, vars);
    const contractName = findContractByAddress(addressBook, addr);
    const left = contractLeft(contractName, addr);
    return { call: `${left}.${fn}(${args})`, prank: shouldPrank(callerTag, prankResolved) ? prankResolved : undefined, pre };
  } else {
    const left = m[1];
    const fn = m[2];
    const rawArgs = m[3];
    const { args, pre } = materializeArgsWithPre(rawArgs, vars);
    let leftRendered = "";
    const isLeftHex = /^0x[a-fA-F0-9]{8,40}$/.test(left);
    if (isLeftHex) {
      const addr = normalizeAddress(left).toLowerCase();
      const name = findContractByAddress(addressBook, addr);
      leftRendered = contractLeft(name, addr);
    } else if (left.includes("::")) {
      leftRendered = left.split("::").pop() || left;
    } else if (left.includes("::") === false) {
      // names like CryticToFoundry
      leftRendered = left;
    }
    // If it still contains :: then fallback to last identifier
    if (leftRendered.includes("::")) leftRendered = leftRendered.split("::").pop() as string;
    // If original left was hex, always render as <contract>.<fn>(...)
    if (isLeftHex) {
      return { call: `${leftRendered}.${fn}(${args})`, prank: shouldPrank(callerTag, prankResolved) ? prankResolved : undefined, pre };
    }
    // Otherwise, for symbolic names (e.g., CryticToFoundry), just the function name alone
    if (!/^\s*MockERC20\s*\(/.test(leftRendered) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(leftRendered)) {
      return { call: `${fn}(${args})`, prank: shouldPrank(callerTag, prankResolved) ? prankResolved : undefined, pre };
    }
    // Otherwise we already resolved to contractLeft
    return { call: `${leftRendered}.${fn}(${args})`, prank: shouldPrank(callerTag, prankResolved) ? prankResolved : undefined, pre };
  }
}

const DEFAULT_SENDER = normalizeAddress("0x1804c8ab1f12e6bbf3894d4083f33e07309d1f38");

function shouldPrank(callerTag: string, prankAddress?: string): boolean {
  if (!prankAddress) return false;
  // Skip if caller var is a symbolic halmos_msg_sender_*
  if (callerTag.startsWith("halmos_msg_sender_")) return false;
  // Skip if caller is the default sender
  if (normalizeAddress(prankAddress) === DEFAULT_SENDER) return false;
  return true;
}

function stripMetaTags(line: string): string {
  // Remove (value: ...) and (caller: ...) anywhere in the line (typically at the end)
  return line
    .replace(/\s+\(value:[^\)]*\)/g, "")
    .replace(/\s+\(caller:[^\)]*\)/g, "");
}

function resolveCaller(callerTag: string, vars: Record<string, string>): string | undefined {
  // callerTag examples:
  // 0x1804c8ab1f12...
  // halmos_msg_sender_0x..._abc_01
  const direct = callerTag.match(/(0x[a-fA-F0-9]{8,40})/);
  if (direct) return formatAddressLiteral(normalizeAddress(direct[1]));
  if (!callerTag) return undefined;
  const v = vars[callerTag];
  if (!v) return undefined;
  // value may be 0x00 or a 20-byte hex string without 0x prefix length 40
  const hex = v.startsWith("0x") ? v : `0x${v}`;
  return formatAddressLiteral(normalizeAddress(hex));
}

function formatAddressLiteral(addr: string): string {
  return addr;
}

function findContractByAddress(book: AddressBook, addr: string): string | undefined {
  for (const [name, a] of Object.entries(book)) {
    if (normalizeAddress(a).toLowerCase() === normalizeAddress(addr).toLowerCase()) return name;
  }
  return undefined;
}

function contractLeft(name: string | undefined, addr: string): string {
  if (name === "MockERC20") return `MockERC20(_getAsset())`;
  if (name) return toSnakeCase(name);
  // fallback to raw address via address(this) style is not available; leave as hex in comment
  return `/* ${addr} */`;
}

function materializeArgs(raw: string, vars: Record<string, string>): string {
  // raw may be 'Concat(a, b, c)' or empty
  const m = /Concat\((.*)\)/.exec(raw.trim());
  if (!m) return renderAtom(raw.trim(), vars);
  const inside = m[1];
  const parts = splitTopLevelArgs(inside).map((p) => p.trim());

  // Heuristic for dynamic arrays: 0x...20, p_arr_length_*, p_arr[i]_type_*
  if (parts.length >= 2 && /^0x0*20$/i.test(parts[0]) && /^p_.*_length_/.test(parts[1])) {
    const lenVar = parts[1];
    const lenRaw = vars[lenVar];
    let len = 0;
    try { len = Number(BigInt(lenRaw)); } catch { len = 0; }
    const base = lenVar.split("_length_")[0]; // e.g. p_arr
    const elems: string[] = [];
    for (let i = 0; i < len; i++) {
      const re = new RegExp(`^${escapeRegExp(base)}\\\\[${i}\\\\]_`);
      const part = parts.find((p) => re.test(p));
      if (part) {
        elems.push(renderAtom(part, vars));
      } else {
        elems.push("0");
      }
    }
    return `[${elems.join(", ")}]`;
  }

  const rendered = parts
    .map((p) => renderAtom(p, vars))
    .filter((x) => x !== "")
    .join(", ");
  return rendered;
}

function materializeArgsWithPre(raw: string, vars: Record<string, string>): { args: string; pre: string[] } {
  const pre: string[] = [];
  const trimmed = raw.trim();
  const m = /Concat\((.*)\)/.exec(trimmed);
  if (!m) {
    return { args: renderAtom(trimmed, vars), pre };
  }
  const inside = m[1];
  const parts = splitTopLevelArgs(inside).map((p) => p.trim());

  // Mixed scalars and dynamic arrays encoded together: detect any length vars first
  {
    const basesInOrder: string[] = [];
    for (const token of parts) {
      const mt = /^p_(.*)_length_/.exec(token);
      if (mt) {
        const base = `p_${mt[1]}`;
        if (!basesInOrder.includes(base)) basesInOrder.push(base);
      }
    }
    if (basesInOrder.length >= 1) {
      // 1) Build arrays in the order they appear
      const arrayVarNames: string[] = [];
      for (const base of basesInOrder) {
        const varName = sanitizeIdentifier(base.replace(/^p_/, "")) || "arr";
        // Bytes special-case: p_*_bytes_* present
        const bytesBlobVar = parts.find((p) => new RegExp(`^${escapeRegExp(base)}_bytes_`).test(p));
        if (bytesBlobVar && vars[bytesBlobVar] !== undefined) {
          const rawHex = vars[bytesBlobVar];
          const hexNo0x = (rawHex || "").replace(/^0x/, "");
          pre.push(`bytes memory ${varName} = hex"${hexNo0x}";`);
          arrayVarNames.push(varName);
          continue;
        }
        const lenToken = parts.find((p) => p.startsWith(`${base}_length_`));
        const lenRaw = lenToken ? vars[lenToken] : undefined;
        let len = 0;
        try { len = lenRaw !== undefined ? Number(BigInt(lenRaw)) : 0; } catch { len = 0; }
        const elemVar = parts.find((p) => new RegExp(`^${escapeRegExp(base)}\\[0\\]_`).test(p));
        const elemType = inferSolElemType(elemVar || "p_uint256_0");
        pre.push(`${elemType}[] memory ${varName} = new ${elemType}[](${len});`);
        for (let i = 0; i < len; i++) {
          const re = new RegExp(`^${escapeRegExp(base)}\\[${i}\\]_`);
          const part = parts.find((p) => re.test(p));
          const value = part ? renderAtom(part, vars) : (elemType === "address" ? "address(0)" : "0");
          pre.push(`${varName}[${i}] = ${value};`);
        }
        arrayVarNames.push(varName);
      }

      // 2) Collect scalar args that are not offsets, not lengths, not array elements, not bytes blobs for those bases
      const isBaseToken = (tok: string) => basesInOrder.some((b) =>
        new RegExp(`^${escapeRegExp(b)}_length_`).test(tok) ||
        new RegExp(`^${escapeRegExp(b)}\\\\[\\\\d+\\\\]_`).test(tok) ||
        new RegExp(`^${escapeRegExp(b)}_bytes_`).test(tok)
      );
      const scalarArgs: string[] = [];
      for (const tok of parts) {
        if (isBaseToken(tok)) continue; // skip tokens belonging to detected array bases
        if (/^0x[0-9a-fA-F]+$/.test(tok)) {
          // Skip ABI offset hex words when arrays are present
          try {
            const n = BigInt(tok);
            if (n % 32n === 0n) continue;
          } catch {}
        }
        // Keep direct scalar variables
        if (/^p_[\w\[\]\.]+/.test(tok) || /^halmos_/.test(tok)) {
          const rendered = renderAtom(tok, vars);
          if (rendered !== "") scalarArgs.push(rendered);
        }
      }

      const finalArgs = [...scalarArgs, ...arrayVarNames].join(", ");
      return { args: finalArgs, pre };
    }
  }

  // Dynamic array encoding: [offset=0x...20, lengthVar, elem0, elem1, ...]
  if (parts.length >= 2 && /^0x0*20$/i.test(parts[0]) && /^p_.*_length_/.test(parts[1])) {
    const lenVar = parts[1];
    const lenRaw = vars[lenVar];
    let len = 0;
    try { len = Number(BigInt(lenRaw)); } catch { len = 0; }
      const base = lenVar.split("_length_")[0]; // e.g. p_arr
      const varBaseName = sanitizeIdentifier(base.replace(/^p_/, "")) || "arr";
    // Special-case bytes: look for a single bytes blob var (e.g., p_data_bytes_*)
    const bytesBlobVar = parts.slice(2).find((p) => /_bytes_/.test(p));
    if (bytesBlobVar && vars[bytesBlobVar] !== undefined) {
      const varName = varBaseName;
      const rawHex = vars[bytesBlobVar];
      const hexNo0x = (rawHex || "").replace(/^0x/, "");
      pre.push(`bytes memory ${varName} = hex"${hexNo0x}";`);
      return { args: varName, pre };
    }
    // Infer element type from first element var name if possible
    const elemVar = parts.find((p) => new RegExp(`^${escapeRegExp(base)}\\\\[0\\\\]_`).test(p));
    const elemType = inferSolElemType(elemVar || "p_uint256_0");
      const varName = varBaseName;
    pre.push(`${elemType}[] memory ${varName} = new ${elemType}[](${len});`);
    for (let i = 0; i < len; i++) {
      const re = new RegExp(`^${escapeRegExp(base)}\\\\[${i}\\\\]_`);
      const part = parts.find((p) => re.test(p));
      const value = part ? renderAtom(part, vars) : "0";
      pre.push(`${varName}[${i}] = ${value};`);
    }
    return { args: varName, pre };
  }

  // Fixed-size array: Concat(p_arr[0]_T_*, p_arr[1]_T_*, ..., p_arr[n-1]_T_*)
  if (
    parts.length >= 2 &&
    parts.every((p) => /^p_[^\[]+\[\d+\]_/.test(p))
  ) {
    const matches = parts.map((p) => /^p_([^\[]+)\[(\d+)\]_/.exec(p) as RegExpExecArray);
    const baseName = matches[0][1];
    const sameBase = matches.every((m) => m && m[1] === baseName);
    const indices = matches.map((m) => parseInt(m[2], 10)).sort((a,b)=>a-b);
    const contiguous = indices.every((v, i) => v === i);
    if (sameBase && contiguous) {
      const elemType = inferSolElemType(parts[0]);
      const len = parts.length;
        const varName = sanitizeIdentifier(baseName) || "arr";
      pre.push(`${elemType}[${len}] memory ${varName};`);
      for (let i = 0; i < len; i++) {
        const part = parts[i];
        const value = renderAtom(part, vars);
        pre.push(`${varName}[${i}] = ${value};`);
      }
      return { args: varName, pre };
    }
  }

  // Struct-like tuple: Concat(p_s.field_type_*, p_s.otherField_type_*, ...)
  if (
    parts.length >= 2 &&
    parts.every((p) => /^p_[^.]+\.[^_]+_/.test(p))
  ) {
    const m0 = /^p_([^.]+)\.[^_]+_/.exec(parts[0]) as RegExpExecArray;
    const baseVarRaw = m0 && m0[1] ? m0[1] : "s";
    const sameBase = parts.every((p) => {
      const m = /^p_([^.]+)\.[^_]+_/.exec(p);
      return m && m[1] === baseVarRaw;
    });
    if (sameBase) {
      const varName = sanitizeIdentifier(baseVarRaw) || "s";
      const typeName = toTypeName(varName);
      pre.push(`${typeName} memory ${varName};`);
      for (const tok of parts) {
        const mf = /^p_[^.]+\.([^_]+)_/.exec(tok);
        const field = mf && mf[1] ? sanitizeIdentifier(mf[1]) : "field";
        const value = renderAtom(tok, vars);
        pre.push(`${varName}.${field} = ${value};`);
      }
      return { args: varName, pre };
    }
  }

  // Not a dynamic array, treat as normal concat of arguments
  const rendered = parts
    .map((p) => renderAtom(p, vars))
    .filter((x) => x !== "")
    .join(", ");
  return { args: rendered, pre };
}

function inferSolElemType(varNameLike: string): string {
  if (/_bool_/i.test(varNameLike)) return "bool";
  if (/_address_/i.test(varNameLike)) return "address";
  if (/_bytes32_/i.test(varNameLike)) return "bytes32";
  if (/_int(\d+)?_/i.test(varNameLike)) return "int256";
  // default to uint256
  return "uint256";
}

function splitTopLevelArgs(s: string): string[] {
  const res: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" ) depth++;
    if (c === ")" ) depth--;
    if (c === "," && depth === 0) {
      res.push(cur);
      cur = "";
    } else {
      if (!(c === "," && depth === 0)) cur += c;
    }
  }
  if (cur.trim() !== "") res.push(cur);
  return res;
}

function renderAtom(atom: string, vars: Record<string, string>): string {
  const t = atom.trim();
  if (t === "") return "";
  // If it's a direct parameter variable, lookup its value and convert type-aware
  if (/^p_[\w\[\]\.]+/.test(t) || /^halmos_/.test(t)) {
    const val = vars[t];
    if (val === undefined) return defaultValueForVar(t);
    return convertValueGuessType(t, val);
  }
  // Static hex literal
  if (/^0x[0-9a-fA-F]+$/.test(t)) return convertHexToSolidityLiteral(t);
  // Nested Concat
  const mc = /Concat\((.*)\)/.exec(t);
  if (mc) {
    return materializeArgs(t, vars);
  }
  // Fallback
  return t;
}

function defaultValueForVar(varName: string): string {
  if (/_bool_/i.test(varName)) return "false";
  if (/_address_/i.test(varName)) return "address(0)";
  if (/_bytes32_/i.test(varName)) return "0x" + "00".repeat(32);
  if (/_bytes_/i.test(varName)) return 'hex""';
  if (/_int(\d+)?_/i.test(varName) || /_uint(\d+)?_/i.test(varName) || /_uint256_/i.test(varName)) return "0";
  // Unknown -> safest neutral default
  return "0";
}

function convertValueGuessType(varName: string, raw: string): string {
  // Halmos embeds type in varName like _bool_, _uint256_, _address_, _bytes32_
  if (/_bool_/.test(varName)) return raw === "0x01" ? "true" : "false";
  if (/_address_/.test(varName)) {
    const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
    try {
      return ethers.getAddress(hex);
    } catch {
      return "address(0)";
    }
  }
  if (/_bytes32_/.test(varName)) {
    const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
    return hex;
  }
  if (/_uint/.test(varName) || /_int/.test(varName) || /_uint256_/.test(varName)) {
    // Interpret as big-endian hex number
    if (raw === "0x" || raw === "0x00" || raw === "0") return "0";
    // trim 0x and parse
    const bn = BigInt(raw);
    return bn.toString(10);
  }
  // Unknown -> return as-is
  return raw;
}

function convertHexToSolidityLiteral(hex: string): string {
  // Could be a big number, default to hex literal
  return hex;
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAddress(raw: string): string {
  let h = raw.toLowerCase();
  if (h.startsWith("0x")) h = h.slice(2);
  if (h.length > 40) h = h.slice(h.length - 40); // keep right-most 20 bytes
  h = h.padStart(40, "0");
  return `0x${h}`;
}

function toTypeName(varName: string): string {
  if (!varName) return "S";
  return varName.charAt(0).toUpperCase() + varName.slice(1);
}

function sanitizeIdentifier(name: string): string {
  // Replace invalid chars with underscore, ensure it starts with letter or underscore
  let n = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(n)) n = `_${n}`;
  return n;
}
