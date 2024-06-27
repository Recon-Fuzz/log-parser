// TODO 0XSI
// Set up basic regression tests
import fs from "fs";
import { processLogs } from "../src/index";
import { Fuzzer } from "../src/types/types";

const dataMedusa = fs.readFileSync("./tests/test_data/medusa.txt", "utf8");

const jobStatsMedusa = processLogs(dataMedusa, Fuzzer.MEDUSA);
console.log(jobStatsMedusa)


const dataEchidna = fs.readFileSync("./tests/test_data/echidna.txt", "utf8");

const jobStatsEchidna = processLogs(dataEchidna, Fuzzer.ECHIDNA);
console.log(jobStatsEchidna)
