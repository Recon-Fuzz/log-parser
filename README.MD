# Log Parser

A TypeScript utility for parsing Medusa, Echidna, and Halmos fuzzing / symbolic execution logs.

## Web

Used in:

- Recon VSCode Extension
- https://getrecon.xyz/tools/medusa
- https://getrecon.xyz/tools/echidna
- https://getrecon.xyz/tools/halmos

## NPM

https://www.npmjs.com/package/@recon-fuzz/log-parser

## Installation

```bash
yarn add @recon-fuzz/log-parser
```


## Usage

```typescript
import { processLogs, Fuzzer } from '@recon-fuzz/log-parser';

// Process Medusa logs
const medusaResults = processLogs(medusaLogContent, Fuzzer.MEDUSA);

// Process Echidna logs
const echidnaResults = processLogs(echidnaLogContent, Fuzzer.ECHIDNA);

// Process Halmos logs
const halmosResults = processLogs(halmosLogContent, Fuzzer.HALMOS);
```

## API Reference

### `processLogs(logs: string, tool: Fuzzer): FuzzingResults`

Processes fuzzing logs and returns structured results.

#### Parameters
- `logs: string` - The raw log content as a string
- `tool: Fuzzer` - The tool used (Fuzzer.MEDUSA | Fuzzer.ECHIDNA | Fuzzer.HALMOS)

#### Returns: `FuzzingResults`
```typescript
interface FuzzingResults {
  duration: string;
  coverage: number;
  failed: number;
  passed: number;
  results: any[];
  traces: any[];
  brokenProperties: any[];
  numberOfTests: number;
}
```

## Converting Logs to Foundry Tests

Medusa, Echidna and Halmos logs can be converted into Foundry test cases using the provided utility functions.

### Medusa & Echidna

```typescript
// Echidna -> Foundry test functions
import { echidnaLogsToFunctions } from '@recon-fuzz/log-parser';

const echidnaFoundryTests = echidnaLogsToFunctions(
  echidnaLogs,
  "test_identifier",
  "brokenProperty",           // the property name that failed
  { roll: true, time: true, prank: true } // vm helpers configuration
);

// Medusa -> Foundry test functions
import { medusaLogsToFunctions } from '@recon-fuzz/log-parser';

const medusaFoundryTests = medusaLogsToFunctions(
  medusaLogs,
  "test_identifier",
  { roll: true, time: true, prank: true }
);
```

### Halmos

Halmos produces counterexamples consisting of parameter assignments and a symbolic execution call sequence. These can be transformed into Foundry tests.

```typescript
import { halmosLogsToFunctions } from '@recon-fuzz/log-parser';

// Convert all broken properties (if any) to test functions
const halmosFoundryTests = halmosLogsToFunctions(halmosLogs, "test_identifier");
```

The conversion handles:
- VM state manipulation (block numbers, timestamps)
- Actor simulation (pranks for different senders)
- Function call sequences / symbolic traces
- Parameter reconstruction for Halmos counterexamples
- Special data types (addresses, bytes)

Generated tests include the exact sequence of calls that triggered the property violation, making it easy to reproduce and debug issues found during fuzzing or symbolic exploration.

## Development

### Requirements

- Node.js (>= 14.x)
- yarn or npm

### Setup

1. Clone the repository
2. Install dependencies:
```bash
yarn install
```

### Scripts

- `yarn build` - Build the package
- `yarn test` - Run tests
- `yarn lint` - Run linting

## License

https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt
