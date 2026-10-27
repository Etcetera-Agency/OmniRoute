process.env.DATA_DIR = "/app/data";
console.log = (...args) => console.error(...args);

try {
  const [{ getAllActiveSyncedModels }, { reprocessModelBenchmarkSearchEvidence }] =
    await Promise.all([
      import("../../src/lib/db/models/activeSyncedCatalog"),
      import("../../src/lib/modelBenchmarkSearch"),
    ]);
  const activeCatalogs = await getAllActiveSyncedModels();
  const modelIds = [
    ...new Set(
      Object.values(activeCatalogs)
        .flat()
        .map((model) => model.id)
        .filter(Boolean)
    ),
  ];
  const result = await reprocessModelBenchmarkSearchEvidence(modelIds);
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
