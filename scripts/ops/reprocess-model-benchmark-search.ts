const runtimeCheck = process.argv.includes("--check-runtime");
process.env.DATA_DIR = runtimeCheck ? "/tmp/model-benchmark-search-runtime-check" : "/app/data";
console.log = (...args) => console.error(...args);

try {
  const { reprocessModelBenchmarkSearchEvidence } =
    await import("../../src/lib/modelBenchmarkSearch");
  if (runtimeCheck) {
    process.stdout.write("runtime module graph loaded\n");
    process.exit(0);
  }
  const result = await reprocessModelBenchmarkSearchEvidence();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    result.receipts.some(
      (receipt) =>
        receipt.identityStatus === "missing" ||
        Object.values(receipt.sources).some((source) => !source.complete)
    )
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`
  );
  process.exitCode = 1;
}
