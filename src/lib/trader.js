// All summaries are local observed-cohort views, independent of chart filters.
export const walletAddress = (value) =>
  /^0x[0-9a-f]{40}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
export function pricePnl(position, reference) {
  const exit =
    position.status === "open" ? reference : position.exitEvent?.price;
  if (
    position.entry === null ||
    !(position.entry > 0) ||
    exit === null ||
    !Number.isFinite(exit) ||
    position.notionalWad == null ||
    typeof position.isLong !== "boolean"
  )
    return null;
  const result =
    (Number(position.notionalWad) / 1e18) *
    (exit / position.entry - 1) *
    (position.isLong ? 1 : -1);
  return Number.isFinite(result) ? result : null;
}
export const signedMoney = (value) =>
  value === null
    ? "Unavailable"
    : (value < 0 ? "−" : "+") +
      "$" +
      Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
export function traderSummary(model, address) {
  const owner = walletAddress(address);
  if (!owner) throw new Error("Enter a valid 0x wallet address");
  const positions = model.positions.filter(
    (p) => p.owner.toLowerCase() === owner,
  );
  const open = positions
    .filter((p) => p.status === "open")
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  const history = positions
    .filter((p) => p.status !== "open")
    .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  let wins = 0,
    losses = 0,
    flat = 0,
    unknown = 0;
  for (const p of history) {
    const pnl = pricePnl(p, null);
    if (pnl === null) unknown++;
    else if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
    else flat++;
  }
  return { owner, open, history, wins, losses, flat, unknown };
}
