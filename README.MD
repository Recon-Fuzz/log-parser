# Log Parser

A TypeScript utility for parsing Medusa and Echidna fuzzing logs.

## Installation

```bash
yarn add @recon-fuzz/log-parser
```

NPM: https://www.npmjs.com/package/@recon-fuzz/log-parser

## Usage

```typescript
import { processLogs, Fuzzer } from '@recon-fuzz/log-parser';

// Process Medusa logs
const medusaResults = processLogs(medusaLogContent, Fuzzer.MEDUSA);

// Process Echidna logs
const echidnaResults = processLogs(echidnaLogContent, Fuzzer.ECHIDNA);
```

## API Reference

### `processLogs(logs: string, tool: Fuzzer): FuzzingResults`

Processes fuzzing logs and returns structured results.

#### Parameters
- `logs: string` - The raw log content as a string
- `tool: Fuzzer` - The fuzzer tool used (Fuzzer.MEDUSA or Fuzzer.ECHIDNA)

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

## Medusa and Echidna Conversion to Foundry

### Converting Fuzzer Logs to Foundry Tests

Both Medusa and Echidna logs can be converted into Foundry test cases using the provided utility functions:

```typescript
// For Echidna logs
import { echidnaLogsToFunctions } from '@recon-fuzz/log-parser';

const foundryTest = echidnaLogsToFunctions(
  echidnaLogs,
  "test_identifier",
  "brokenProperty",
  { roll: true, time: true, prank: true }
);

// For Medusa logs
import { medusaLogsToFunctions } from '@recon-fuzz/log-parser';

const foundryTest = medusaLogsToFunctions(
  medusaLogs,
  "test_identifier",
  { roll: true, time: true, prank: true }
);
```

The conversion handles:
- VM state manipulation (block numbers, timestamps)
- Actor simulation (pranks for different senders)
- Function call sequences
- Special data types (addresses, bytes)

Generated tests will include the exact sequence of calls that triggered the property violation, making it easy to reproduce and debug issues found during fuzzing. 

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