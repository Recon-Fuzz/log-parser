// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readFileSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { join } = require("path");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateJobMD } = require("../lib/cjs/reportBuilder/reportBuilder.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Fuzzer } = require("../lib/cjs/types/types.js");

// Simple demo runner: prints Markdown recap for halmos-5.txt using markdownShell
const file = join(__dirname, "../tests/test_data/halmos-5.txt");
const logs = readFileSync(file, "utf8");

const out = generateJobMD(Fuzzer.HALMOS, logs, "halmos-5");
console.log(out);
