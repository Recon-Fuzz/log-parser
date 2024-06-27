export interface VmParsingData {
  roll: boolean;
  time: boolean;
  prank: boolean;
}

export interface FuzzingResults {
  duration: string;
  coverage: string;
  failed: string;
  passed: string;
  results: string[];
  traces: string[];
}

export interface PropertyAndSequence {
  brokenProperty: string;
  sequence: string[] | string;
}

export enum Fuzzer {
  MEDUSA = "MEDUSA",
  ECHIDNA = "ECHIDNA",
}
