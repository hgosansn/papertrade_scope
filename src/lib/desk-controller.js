import {
  candleRequest,
  historyComplete,
  PRICE_INTERVALS,
} from "./price-history.js";
import { mergeCandles } from "./core.js";
import {
  openStore,
  readStore,
  saveStore,
  readArchives,
  archiveAndSaveStore,
} from "./store.js";
import { HyperliquidFeed } from "./feed.js";
import { ProtocolCollector } from "./collector.js";
import {
  deriveProtocol,
  decodePosition,
  IMPLEMENTATION,
  IMPLEMENTATION_SHA256,
} from "./protocol.js";
import { walletAddress } from "./trader.js";
import { DEFAULT_SETTINGS } from "./settings.js";

const PREFERENCES = "papertrade-atlas-prefs-v2";
const WATCHLIST = "papertrade-watched-wallets";
const EMPTY_MODEL = {
  events: [],
  positions: [],
  liquidations: [],
  missingTimes: 0,
  unresolvedExits: 0,
  errors: [],
  unknownTopics: [],
};

function freshState() {
  return {
    schema: 2,
    start: Date.now(),
    lastSeen: Date.now(),
    candles: [],
    trades: [],
    gaps: [],
    raw: { logs: [] },
    headers: {},
    positionMetadata: {},
    contexts: {},
    bbos: {},
  };
}

function normalize(value) {
  return {
    ...freshState(),
    ...value,
    headers: value?.headers || {},
    positionMetadata: value?.positionMetadata || {},
    contexts: value?.contexts || {},
    bbos: value?.bbos || {},
  };
}

function readPreference(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Browser-local collection and persistence, independent of the React interface. */
export class DeskController {
  listeners = new Set();
  state = freshState();
  settings = { ...DEFAULT_SETTINGS, ...readPreference(PREFERENCES, {}) };
  watched = readPreference(WATCHLIST, [])
    .filter((value) => typeof value === "string" && walletAddress(value))
    .map((value) => value.toLowerCase());
  selected = "BTC";
  interval = 1;
  mode = "live";
  paused = false;
  leader = false;
  readOnly = false;
  referenceStatus = "Connecting";
  protocolStatus = "Starting public sources";
  storageStatus = "Opening local journal";
  modelKey = "";
  model = EMPTY_MODEL;
  saveQueue = Promise.resolve();
  saveVersion = 0;
  archives = [];
  snapshot = null;
  stopped = false;

  constructor() {
    this.emit();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  emit = () => {
    const key = [
      this.mode,
      this.state.raw.verifiedAt,
      Object.keys(this.state.headers).length,
      Object.keys(this.state.positionMetadata).length,
      this.state.decoder?.block,
    ].join(":");
    if (key !== this.modelKey) {
      this.modelKey = key;
      this.model = this.state.decoder
        ? deriveProtocol(
            this.state.raw.logs,
            this.state.headers,
            this.state.positionMetadata,
          )
        : EMPTY_MODEL;
    }
    this.snapshot = {
      state: this.state,
      model: this.model,
      settings: this.settings,
      watched: this.watched,
      selected: this.selected,
      interval: this.interval,
      mode: this.mode,
      paused: this.paused,
      leader: this.leader,
      readOnly: this.readOnly,
      referenceStatus: this.referenceStatus,
      protocolStatus: this.protocolStatus,
      storageStatus: this.storageStatus,
      archiveCount: this.archives.length,
      historyStatus: this.historyStatus,
      now: this.mode === "replay" ? this.replayNow : Date.now(),
    };
    for (const listener of this.listeners) listener();
  };

  recordGap(from, to) {
    if (this.mode !== "live" || to <= from) return;
    const last = this.state.gaps.at(-1);
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else
      this.state.gaps.push({
        from,
        to,
        reason: "Reference feed continuity unverified",
      });
  }

  commit = async () => {
    if (!this.leader || this.mode !== "live") return;
    const target = this.state,
      version = ++this.saveVersion;
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => saveStore(this.db, target));
    try {
      await this.saveQueue;
      if (version === this.saveVersion)
        this.storageStatus = "Saved locally · IndexedDB";
    } catch {
      this.storageStatus = "Save failed · export the journal";
    }
    this.modelKey = "";
    this.emit();
  };

  receive = (message) => {
    if (this.mode !== "live" || !this.leader) return;
    this.state.lastSeen = Date.now();
    if (message.channel === "candle")
      this.state.candles = mergeCandles(
        this.state.candles,
        Array.isArray(message.data) ? message.data : [message.data],
        0,
      );
    if (message.channel === "activeAssetCtx")
      this.state.contexts[message.data.coin] = {
        ...message.data.ctx,
        receivedAt: Date.now(),
      };
    this.emit();
  };

  historyStatus = "Waiting for reference connection";
  historyTarget = null;

  preloadCandles = async () => {
    const target = this.state,
      feed = this.feed;
    if (this.historyTarget === target || this.mode !== "live" || this.stopped)
      return;
    this.historyTarget = target;
    this.historyStatus = "Loading 48h price history";
    this.emit();
    let failed = false;
    try {
      const intervals = [
        this.interval,
        ...PRICE_INTERVALS.filter((i) => i !== this.interval),
      ];
      for (const minutes of intervals)
        for (const coin of ["BTC", "ETH"]) {
          try {
            const request = candleRequest(
              coin,
              minutes,
              Date.now(),
              target.candles,
            );
            const payload = await feed.postInfo(request);
            if (
              this.mode !== "live" ||
              this.state !== target ||
              this.stopped ||
              this.feed !== feed
            )
              return;
            const rows = Array.isArray(payload) ? payload : payload?.data;
            if (!Array.isArray(rows) || !rows.length)
              throw new Error("No history returned");
            target.candles = mergeCandles(target.candles, rows, 0);
            if (!historyComplete(target.candles, coin, minutes, Date.now()))
              failed = true;
            this.emit();
          } catch {
            failed = true;
          }
        }
      if (this.mode === "live" && this.state === target && !this.stopped) {
        this.historyStatus = failed
          ? "History incomplete - cached / live candles retained"
          : "48h price history loaded - SMA warmup included";
        this.emit();
      }
    } finally {
      if (this.historyTarget === target) this.historyTarget = null;
    }
  };

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      this.db = await openStore();
      this.state = normalize((await readStore(this.db)) || this.state);
      this.archives = await readArchives(this.db);
      if (this.stopped) return;
      if (!navigator.locks)
        throw new Error(
          "Current Chrome or Edge is required for collection coordination.",
        );
      navigator.locks
        .request(
          "papertrade-observer-collector",
          { ifAvailable: true },
          async (lock) => {
            if (this.stopped) return;
            if (!lock) {
              this.readOnly = true;
              this.protocolStatus = "Another tab is collecting";
              this.emit();
              return;
            }
            await this.becomeLeader();
            if (!this.stopped)
              await new Promise((resolve) => {
                this.releaseLock = resolve;
              });
          },
        )
        .catch((error) => {
          if (!this.stopped) {
            this.protocolStatus = error.message;
            this.emit();
          }
        });
      this.refreshTimer = setInterval(async () => {
        if (!this.leader && this.mode === "live")
          this.state = normalize((await readStore(this.db)) || this.state);
        this.emit();
      }, 1000);
      this.saveTimer = setInterval(this.commit, 5000);
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("pagehide", this.stop);
      this.emit();
    } catch (error) {
      this.protocolStatus = error.message;
      this.storageStatus = "Unavailable";
      this.emit();
    }
  }

  async becomeLeader() {
    this.leader = true;
    this.state = normalize((await readStore(this.db)) || this.state);
    if (this.stopped) return;
    this.recordGap(this.state.lastSeen, Date.now());
    this.feed = new HyperliquidFeed(
      this.receive,
      (status) => {
        this.referenceStatus = status;
        if (status === "Connected") queueMicrotask(this.preloadCandles);
        this.emit();
      },
      (from) => this.recordGap(from, Date.now()),
      ["BTC", "ETH"],
      ["candle", "activeAssetCtx"],
    );
    this.collector = new ProtocolCollector(
      () => this.state,
      this.commit,
      (status) => {
        this.protocolStatus = status;
        this.emit();
      },
    );
    this.endpoint = "https://rpc.hyperliquid.xyz/evm";
    this.feed.start();
    this.collector.start(this.endpoint);
    await this.commit();
  }

  onVisibility = () => {
    if (
      this.mode === "live" &&
      !document.hidden &&
      this.leader &&
      Date.now() - this.state.lastSeen > 45000
    ) {
      this.recordGap(this.state.lastSeen, Date.now());
      if (!this.paused) {
        this.feed.stop();
        this.feed.start();
      }
    }
  };

  stop = () => {
    if (this.stopped) return;
    this.stopped = true;
    this.collector?.stop();
    this.feed?.stop();
    this.commit().finally(() => this.releaseLock?.());
    clearInterval(this.refreshTimer);
    clearInterval(this.saveTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.stop);
  };

  updateSettings = (patch) => {
    this.settings = { ...this.settings, ...patch };
    localStorage.setItem(PREFERENCES, JSON.stringify(this.settings));
    this.emit();
  };

  resetSettings = () => this.updateSettings(DEFAULT_SETTINGS);
  selectMarket = (value) => {
    this.selected = value;
    this.emit();
  };
  selectInterval = (value) => {
    this.interval = value;
    this.emit();
  };

  toggleWatch = (address) => {
    const owner = walletAddress(address);
    if (!owner) return;
    this.watched = this.watched.includes(owner)
      ? this.watched.filter((value) => value !== owner)
      : [...this.watched, owner];
    localStorage.setItem(WATCHLIST, JSON.stringify(this.watched));
    this.emit();
  };

  applyEndpoint = (value) => {
    if (!this.leader || this.mode !== "live") return;
    if (new URL(value).protocol !== "https:")
      throw new Error("Enter an HTTPS RPC endpoint.");
    this.collector.stop();
    this.endpoint = value.trim();
    this.collector.start(this.endpoint);
  };

  togglePause = () => {
    if (!this.leader || this.mode !== "live") return;
    this.paused = !this.paused;
    this.recordGap(this.state.lastSeen, Date.now());
    if (this.paused) {
      this.collector.stop();
      this.feed.stop();
    } else {
      this.feed.start();
      this.collector.start(this.endpoint);
    }
    this.emit();
  };

  replay = async () => {
    if (this.mode === "replay") return;
    const response = await fetch(
      `${import.meta.env?.BASE_URL || "./"}sample-session.json`,
    );
    if (!response.ok) throw new Error("Captured sample unavailable");
    const sample = await response.json();
    if (this.leader) {
      this.collector.stop();
      this.feed.stop();
      await this.commit();
    }
    this.liveState = this.state;
    this.state = normalize(sample);
    this.mode = "replay";
    this.replayNow = sample.lastSeen;
    for (const [id, data] of Object.entries(sample.metadataResponses || {}))
      this.state.positionMetadata[id] = decodePosition(data, id);
    this.state.decoder = {
      implementation: IMPLEMENTATION,
      sha256: IMPLEMENTATION_SHA256,
      block: this.state.raw.cursor,
      replay: true,
    };
    this.modelKey = "";
    this.emit();
  };

  returnLive = () => {
    if (this.mode !== "replay") return;
    this.state = this.liveState;
    this.mode = "live";
    this.modelKey = "";
    if (this.leader && !this.paused) {
      this.recordGap(this.state.lastSeen, Date.now());
      this.feed.start();
      this.collector.start(this.endpoint);
    }
    this.emit();
  };

  newObservation = async () => {
    if (!this.leader || this.mode !== "live") return;
    this.collector.stop();
    this.feed.stop();
    await this.commit();
    const previous = this.state;
    const next = {
      ...freshState(),
      candles: previous.candles,
      contexts: previous.contexts,
    };
    try {
      const archive = await archiveAndSaveStore(this.db, previous, next);
      this.archives = [...this.archives, archive];
    } catch (error) {
      if (!this.paused) {
        this.feed.start();
        this.collector.start(this.endpoint);
      }
      throw error;
    }
    this.state = next;
    this.paused = false;
    this.modelKey = "";
    await this.commit();
    this.feed.start();
    this.collector.start(this.endpoint);
    this.emit();
  };

  exportJournal = () => {
    this.downloadJournal(this.state, this.mode);
  };

  exportArchive = async () => {
    const key = this.archives.at(-1);
    if (!key) return;
    const state = await readStore(this.db, key);
    if (!state) throw new Error("Archived observation unavailable");
    this.downloadJournal(state, "archived");
  };

  downloadJournal(state, mode) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...state,
            exportedAt: new Date().toISOString(),
            mode,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `papertrade-atlas-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
