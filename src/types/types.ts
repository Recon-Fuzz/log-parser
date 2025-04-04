export interface VmParsingData {
  roll: boolean;
  time: boolean;
  prank: boolean;
}

export interface FuzzingResults {
  duration: string;
  coverage: number;
  failed: number;
  passed: number;
  results: string[];
  traces: string[];
  brokenProperties: BrokenProperty[];
  numberOfTests: number;
}

export interface BrokenProperty {
  brokenProperty: string;
  sequence: string;
}


export interface PropertyAndSequence {
  brokenProperty: string;
  sequence: string[] | string;
}

export enum Fuzzer {
  MEDUSA = "MEDUSA",
  ECHIDNA = "ECHIDNA",
}
