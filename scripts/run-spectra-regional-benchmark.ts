import { readFileSync } from 'node:fs';
import { evaluateSpectraRegionalBenchmark, type SpectraRegionalBenchmarkCase } from '../server/services/spectra/SpectraRegionalBenchmark';

const path = process.argv[2];
if (!path) {
  process.stderr.write('Usage: node --import tsx scripts/run-spectra-regional-benchmark.ts <withheld-answer-cases.json>\n');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(readFileSync(path, 'utf8')) as {
      asOf?: string; cases?: SpectraRegionalBenchmarkCase[];
    };
    if (!Array.isArray(input.cases) || !input.asOf || !Number.isFinite(Date.parse(input.asOf))) {
      throw new TypeError('Expected { asOf: ISO date, cases: [...] }.');
    }
    // Do not print names, source excerpts, individual predictions, or ground truth.
    process.stdout.write(`${JSON.stringify(evaluateSpectraRegionalBenchmark(input.cases, new Date(input.asOf)), null, 2)}\n`);
  } catch {
    process.stderr.write('Regional benchmark input could not be evaluated. Check its format and bounds.\n');
    process.exitCode = 1;
  }
}
