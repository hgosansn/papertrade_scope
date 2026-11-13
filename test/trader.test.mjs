import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pricePnl, traderSummary, walletAddress } from "../src/lib/trader.js";
import { deriveProtocol, decodePosition } from "../src/lib/protocol.js";
test("gross price estimates respect direction, settlement and unknown inputs", () => {
  const p = {
    status: "open",
    entry: 100,
    notionalWad: "100000000000000000000000",
    isLong: true,
  };
  assert.ok(Math.abs(pricePnl(p, 110) - 10000) < 1e-8);
  assert.ok(Math.abs(pricePnl({ ...p, isLong: false }, 110) + 10000) < 1e-8);
  assert.equal(pricePnl(p, null), null);
  assert.equal(pricePnl({ ...p, entry: 0 }, 100), null);
  assert.equal(pricePnl({ ...p, notionalWad: null }, 100), null);
  assert.ok(
    Math.abs(
      pricePnl({ ...p, status: "closed", exitEvent: { price: 90 } }, 200) +
        10000,
    ) < 1e-8,
  );
});
test("trader summary uses all observed sizes and markets, never duplicates close summaries", () => {
  const sample = JSON.parse(
    readFileSync(new URL("../public/sample-session.json", import.meta.url)),
  );
  const meta = Object.fromEntries(
    Object.entries(sample.metadataResponses).map(([id, data]) => [
      id,
      decodePosition(data, id),
    ]),
  );
  const model = deriveProtocol(sample.raw.logs, sample.headers, meta),
    owner = model.positions.find((p) => p.status !== "open").owner;
  const result = traderSummary(model, owner.toUpperCase().replace("0X", "0x"));
  const all = model.positions.filter((p) => p.owner === owner);
  assert.equal(result.open.length + result.history.length, all.length);
  assert.equal(
    result.wins + result.losses + result.flat + result.unknown,
    result.history.length,
  );
  assert.ok(result.history.length > 0);
  assert.equal(
    new Set([...result.open, ...result.history].map((p) => p.positionId)).size,
    all.length,
  );
  assert.equal(traderSummary(model, "0x" + "f".repeat(40)).open.length, 0);
  assert.equal(walletAddress("bad"), null);
});
