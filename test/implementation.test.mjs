import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  decodeLog,
  decodePosition,
  headerFromLog,
  deriveProtocol,
  TOPICS,
  CURRENT_IMPLEMENTATION,
  APPROVED_IMPLEMENTATIONS,
  IMPLEMENTATION,
} from "../src/lib/protocol.js";
import { DeskController } from "../src/lib/desk-controller.js";
import { ProtocolCollector } from "../src/lib/collector.js";
const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../evidence/implementation-4e2a/${name}`, import.meta.url),
      "utf8",
    ),
  );
const logs = read("logs.json"),
  samples = read("samples.json");
const runtime = readFileSync(
  new URL("../evidence/implementation-4e2a/runtime.hex", import.meta.url),
  "utf8",
).trim();
if (!globalThis.crypto) globalThis.crypto = webcrypto;
function collector() {
  return new ProtocolCollector(
    () => ({}),
    async () => {},
    () => {},
  );
}
test("new runtime is pinned by exact hash and code is cached separately per implementation", async () => {
  const c = collector();
  let codeReads = 0,
    address = CURRENT_IMPLEMENTATION;
  c.request = async (_u, method) =>
    method === "eth_getStorageAt"
      ? "0x" + address.slice(2).padStart(64, "0")
      : (++codeReads, runtime);
  const identity = await c.identity({ rangeFrom: "100", cursor: "200" });
  assert.equal(identity.implementation, CURRENT_IMPLEMENTATION);
  assert.equal(
    identity.sha256,
    APPROVED_IMPLEMENTATIONS[CURRENT_IMPLEMENTATION],
  );
  await c.identity({ rangeFrom: "200", cursor: "300" });
  assert.equal(codeReads, 1);
  address = IMPLEMENTATION;
  await assert.rejects(
    c.identity({ rangeFrom: "300", cursor: "400" }),
    /bytecode/,
  );
  address = "0x" + "1".repeat(40);
  await assert.rejects(
    c.identity({ rangeFrom: "400", cursor: "500" }),
    /implementation/,
  );
});
test("known upgrade transitions and changed code are rejected rather than globally disabling the guard", async () => {
  const c = collector();
  let i = 0;
  c.request = async () =>
    "0x" +
    [IMPLEMENTATION, CURRENT_IMPLEMENTATION][i++].slice(2).padStart(64, "0");
  await assert.rejects(
    c.identity({ rangeFrom: "100", cursor: "200" }),
    /transition/,
  );
  const wrong = collector();
  wrong.request = async (_u, method) =>
    method === "eth_getStorageAt"
      ? "0x" + CURRENT_IMPLEMENTATION.slice(2).padStart(64, "0")
      : "0x6000";
  await assert.rejects(
    wrong.identity({ rangeFrom: "100", cursor: "200" }),
    /bytecode/,
  );
});
test("all captured current open/close/liquidation payloads decode without layout errors", () => {
  const headers = Object.fromEntries(
    logs.map((l) => [l.blockHash, headerFromLog(l)]),
  );
  const model = deriveProtocol(
    logs.map((l) => ({ ...l, canonical: true })),
    headers,
  );
  assert.equal(model.errors.length, 0);
  assert.equal(model.events.length, 207);
  assert.equal(model.events.filter((e) => e.kind === "open").length, 99);
  assert.equal(model.events.filter((e) => e.kind === "close").length, 97);
  assert.equal(model.liquidations.length, 11);
  assert.equal(model.missingTimes, 0);
});
test("receipt-matched opens agree with retained getter fields; close/liquidation getters are inactive", () => {
  const receipts = read("receipts.json"),
    markets = new Set();
  for (const sample of samples) {
    const log = sample.log,
      receipt = receipts[log.transactionHash];
    const match = receipt.logs.find((l) => l.logIndex === log.logIndex);
    assert.equal(match.data, log.data);
    assert.deepEqual(match.topics, log.topics);
    assert.equal(
      sample.implementationSlot.slice(-40),
      CURRENT_IMPLEMENTATION.slice(2),
    );
    assert.equal(
      headerFromLog(log).time,
      Number(BigInt(sample.block.timestamp)) * 1000,
    );
    const position = decodePosition(sample.positionResponse, sample.positionId);
    markets.add(position.symbol);
    const event = decodeLog(
      { ...log, canonical: true },
      { [log.blockHash]: headerFromLog(log) },
    );
    assert.equal(position.owner, event.owner);
    assert.equal(position.activeAtRead, event.kind === "open");
    if (event.kind === "open") {
      for (const field of [
        "marketId",
        "isLong",
        "useDebt",
        "entryRaw",
        "marginRaw",
        "leverage",
        "notionalWad",
      ])
        assert.equal(position[field], event[field]);
      assert.equal(position.openedAt, event.time);
    }
  }
  assert.deepEqual([...markets].sort(), ["BTC", "ETH"]);
  const getters = read("getters.json");
  assert.equal(BigInt(getters.collateralScale), 10n ** 12n);
  for (const id of [0, 1])
    assert.equal(
      BigInt("0x" + getters[`instrument${id}`].slice(2 + 2 * 64, 2 + 3 * 64)),
      BigInt(id),
    );
});

test("archive failure keeps the active journal and resumes its collector", async () => {
  const c = new DeskController();
  c.leader = true;
  c.endpoint = "https://example.com";
  const state = c.state;
  let starts = 0;
  c.commit = async () => {};
  c.feed = {
    stop() {},
    start() {
      starts++;
    },
  };
  c.collector = {
    stop() {},
    start() {
      starts++;
    },
  };
  c.db = {
    transaction() {
      throw new Error("quota");
    },
  };
  await assert.rejects(c.newObservation(), /quota/);
  assert.equal(c.state, state);
  assert.equal(c.archives.length, 0);
  assert.equal(starts, 2);
});
test("fresh observation retains prices/settings and archives the old raw journal", async () => {
  const c = new DeskController();
  c.leader = true;
  c.state.raw.logs = [{ id: "retained-evidence" }];
  c.state.candles = [{ id: "price-history" }];
  const previous = c.state,
    settings = c.settings,
    writes = new Map();
  c.commit = async () => {};
  c.feed = { stop() {}, start() {} };
  c.collector = { stop() {}, start() {} };
  c.db = {
    transaction() {
      const tx = {
        objectStore: () => ({
          put(value, key) {
            writes.set(key, structuredClone(value));
          },
        }),
      };
      queueMicrotask(() => tx.oncomplete());
      return tx;
    },
  };
  await c.newObservation();
  assert.equal(c.archives.length, 1);
  assert.deepEqual(writes.get(c.archives[0]).raw.logs, previous.raw.logs);
  assert.deepEqual(writes.get("journal").raw.logs, []);
  assert.equal(c.state.candles, previous.candles);
  assert.equal(c.settings, settings);
});
