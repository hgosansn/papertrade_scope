import { EXCHANGE, hex, reconcileLogs } from "./core.js";
export async function rpc(url, method, params = []) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Use an HTTPS RPC endpoint");
  const result = await fetch(u, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!result.ok) throw new Error(`RPC HTTP ${result.status}`);
  const body = await result.json();
  if (body.error)
    throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
  if (body.result === undefined) throw new Error("Missing RPC result");
  return body.result;
}
export async function collectRange(
  state,
  url,
  checkpoint = async () => {},
  request = rpc,
) {
  if (BigInt(await request(url, "eth_chainId")) !== 999n)
    throw new Error("Wrong chain: expected HyperEVM 999");
  const head = BigInt(await request(url, "eth_blockNumber"));
  const start =
    state.startBlock === undefined ? head : BigInt(state.startBlock);
  const cursor = state.cursor === undefined ? start - 1n : BigInt(state.cursor);
  if (state.startBlock === undefined)
    await checkpoint({
      ...state,
      startBlock: start.toString(),
      cursor: cursor.toString(),
      head: head.toString(),
      logs: state.logs || [],
    });
  if (head < cursor)
    throw new Error("Provider head is behind cursor; collection paused");
  const from = cursor - 7n > start ? cursor - 7n : start;
  const to = head < from + 199n ? head : from + 199n;
  const logs = await request(url, "eth_getLogs", [
    { address: EXCHANGE, fromBlock: hex(from), toBlock: hex(to) },
  ]);
  if (!Array.isArray(logs)) throw new Error("Invalid log response");
  const merged = reconcileLogs(state.logs || [], logs, from, to);
  // Stop at a bounded audit journal instead of silently deleting raw evidence.
  if (merged.length > 12000)
    throw new Error(
      "Raw journal reached 12,000 logs. Export it before starting a new dataset.",
    );
  return {
    ...state,
    startBlock: start.toString(),
    cursor: to.toString(),
    head: head.toString(),
    rangeFrom: from.toString(),
    rangeTo: to.toString(),
    verifiedAt: Date.now(),
    logs: merged,
  };
}
export async function verifyLogReceipt(log, url) {
  const receipt = await rpc(url, "eth_getTransactionReceipt", [
    log.transactionHash,
  ]);
  if (!receipt || receipt.blockHash !== log.blockHash)
    throw new Error("Receipt missing or block changed");
  const found = receipt.logs?.find(
    (l) =>
      l.logIndex === log.logIndex &&
      l.address.toLowerCase() === EXCHANGE.toLowerCase(),
  );
  if (
    !found ||
    found.data !== log.data ||
    JSON.stringify(found.topics) !== JSON.stringify(log.topics)
  )
    throw new Error("Receipt/log mismatch");
  return {
    verifiedAt: Date.now(),
    transactionHash: log.transactionHash,
    blockHash: log.blockHash,
    logIndex: log.logIndex,
    log: found,
    match: true,
  };
}
