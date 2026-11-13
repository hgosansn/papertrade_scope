import { EXCHANGE, hex } from "./core.js";
import { rpc, collectRange } from "./rpc.js";
import {
  APPROVED_IMPLEMENTATIONS,
  IMPLEMENTATION_SLOT,
  TOPICS,
  decodePosition,
  headerFromLog,
} from "./protocol.js";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class ProtocolCollector {
  constructor(getState, commit, onStatus) {
    Object.assign(this, {
      getState,
      commit,
      onStatus,
      running: false,
      lastCall: 0,
      generation: 0,
      failures: 0,
      metadataFailures: new Map(),
      verifiedCodes: new Map(),
    });
  }
  async request(url, method, params = []) {
    await wait(Math.max(0, 1100 - (Date.now() - this.lastCall)));
    this.lastCall = Date.now();
    return rpc(url, method, params);
  }
  start(url) {
    if (this.running) return;
    this.running = true;
    this.url = url;
    this.verifiedCodes.clear();
    this.failures = 0;
    const generation = ++this.generation;
    this.loop(generation);
  }
  stop() {
    this.running = false;
    this.generation++;
    this.onStatus("Paused");
  }
  active(generation) {
    return this.running && this.generation === generation;
  }
  async identity(raw) {
    const blocks = [...new Set([raw.rangeFrom, raw.cursor])];
    let implementation;
    for (const block of blocks) {
      const slot = await this.request(this.url, "eth_getStorageAt", [
        EXCHANGE,
        IMPLEMENTATION_SLOT,
        hex(block),
      ]);
      const address = "0x" + slot.slice(-40).toLowerCase();
      if (
        !/^0x[0-9a-fA-F]{64}$/.test(slot) ||
        !APPROVED_IMPLEMENTATIONS[address]
      )
        throw new Error(
          "Unrecognized implementation: semantic overlays paused",
        );
      if (implementation && implementation !== address)
        throw new Error("Implementation transition: semantic overlays paused");
      implementation = address;
    }
    const expectedHash = APPROVED_IMPLEMENTATIONS[implementation];
    if (!this.verifiedCodes.has(implementation)) {
      const code = await this.request(this.url, "eth_getCode", [
        implementation,
        hex(raw.cursor),
      ]);
      const bytes = Uint8Array.from(code.slice(2).match(/../g) || [], (b) =>
        parseInt(b, 16),
      );
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (hash !== expectedHash)
        throw new Error("Unrecognized bytecode: semantic overlays paused");
      this.verifiedCodes.set(implementation, hash);
    }
    return {
      implementation,
      sha256: expectedHash,
      checkedAt: Date.now(),
      block: raw.cursor,
    };
  }
  async loop(generation) {
    while (this.active(generation)) {
      const began = Date.now();
      let caughtUp = true;
      try {
        this.onStatus("Syncing contract logs");
        const current = this.getState();
        const raw = await collectRange(
          current.raw,
          this.url,
          async (boundary) => {
            if (this.active(generation)) {
              this.getState().raw = boundary;
              await this.commit();
            }
          },
          this.request.bind(this),
        );
        if (!this.active(generation)) return;
        let identity;
        try {
          identity = await this.identity(raw);
        } catch (e) {
          if (this.active(generation)) {
            const state = this.getState();
            state.decoder = null;
            state.quarantine = {
              from: raw.rangeFrom,
              to: raw.rangeTo,
              logs: raw.logs.filter(
                (l) => BigInt(l.blockNumber) >= BigInt(raw.rangeFrom),
              ),
              reason: "Implementation range could not be verified",
            };
            await this.commit();
          }
          throw e;
        }
        if (!this.active(generation)) return;
        const state = this.getState();
        state.raw = raw;
        state.decoder = identity;
        state.headers ??= {};
        state.positionMetadata ??= {};
        caughtUp = raw.cursor === raw.head;
        // HyperEVM's observed log extension was checked against all 99 sample headers.
        // Other providers can omit it; those logs use the bounded header-read fallback.
        for (const log of raw.logs) {
          const header = headerFromLog(log);
          if (header) state.headers[log.blockHash] = header;
        }
        await this.commit();
        const logs = [...raw.logs]
          .filter(
            (l) => l.canonical && Object.values(TOPICS).includes(l.topics[0]),
          )
          .reverse();
        const blocks = [
          ...new Map(
            logs
              .filter((l) => !state.headers[l.blockHash])
              .map((l) => [l.blockHash, l]),
          ).values(),
        ].slice(0, 8);
        this.onStatus(
          blocks.length
            ? "Resolving block times"
            : caughtUp
              ? "Contract synced"
              : "Recovering saved range",
        );
        for (const log of blocks) {
          const header = await this.request(this.url, "eth_getBlockByHash", [
            log.blockHash,
            false,
          ]);
          if (!this.active(generation)) return;
          if (
            !header ||
            header.hash !== log.blockHash ||
            header.number !== log.blockNumber
          )
            throw new Error("Canonical block header mismatch");
          state.headers[log.blockHash] = {
            hash: header.hash,
            number: header.number,
            time: Number(BigInt(header.timestamp)) * 1000,
          };
        }
        const opened = new Set(
          logs
            .filter((l) => l.topics[0] === TOPICS.open)
            .map((l) => BigInt(l.topics[1]).toString()),
        );
        const exits = logs
          .filter((l) =>
            [TOPICS.liquidation, TOPICS.close].includes(l.topics[0]),
          )
          .sort(
            (a, b) =>
              (a.topics[0] === TOPICS.liquidation ? -1 : 1) -
              (b.topics[0] === TOPICS.liquidation ? -1 : 1),
          );
        const ids = [
          ...new Set(exits.map((l) => BigInt(l.topics[1]).toString())),
        ]
          .filter(
            (id) =>
              !opened.has(id) &&
              !state.positionMetadata[id] &&
              (this.metadataFailures.get(id) || 0) < Date.now(),
          )
          .slice(0, 4);
        for (const id of ids) {
          try {
            const response = await this.request(this.url, "eth_call", [
              {
                to: EXCHANGE,
                data: "0x99fbab88" + BigInt(id).toString(16).padStart(64, "0"),
              },
              hex(raw.cursor),
            ]);
            if (!this.active(generation)) return;
            state.positionMetadata[id] = {
              ...decodePosition(response, id),
              readAt: Date.now(),
              readBlock: raw.cursor,
            };
          } catch {
            this.metadataFailures.set(id, Date.now() + 120000);
          }
        }
        if (!this.active(generation)) return;
        await this.commit();
        this.failures = 0;
        this.onStatus(
          raw.cursor === raw.head
            ? "Contract synced"
            : "Recovering saved range",
        );
      } catch (e) {
        if (!this.active(generation)) return;
        this.failures++;
        if (/implementation|bytecode/i.test(e.message)) {
          this.getState().decoder = null;
          await this.commit();
        }
        this.onStatus(
          /implementation|bytecode|journal/i.test(e.message)
            ? e.message
            : "RPC unavailable · cursor retained",
        );
      }
      await wait(
        Math.max(
          500,
          Math.min(
            120000,
            (caughtUp ? 15000 : 500) * 2 ** Math.min(this.failures, 3),
          ) -
            (Date.now() - began),
        ),
      );
    }
  }
}
