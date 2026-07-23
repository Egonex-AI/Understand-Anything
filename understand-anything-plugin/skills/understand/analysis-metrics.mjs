/**
 * Return the UTF-8 byte size of the deterministic per-batch data passed to
 * file-analyzer agents. This is a workload signal, not a token estimate.
 * Keep this function shared by the production preflight planner and the
 * large-repository benchmark so both reports measure the same payload.
 */
export function estimatedAgentInputBytes(batches) {
  if (!Array.isArray(batches)) {
    throw new TypeError('batches must be an array');
  }
  return batches.reduce((sum, batch) => {
    if (!batch || typeof batch !== 'object' || !Array.isArray(batch.files)) {
      throw new TypeError('each batch must contain a files array');
    }
    return (
      sum +
      Buffer.byteLength(
        JSON.stringify({
          files: batch.files,
          batchImportData: batch.batchImportData ?? {},
          neighborMap: batch.neighborMap ?? {},
        }),
      )
    );
  }, 0);
}
