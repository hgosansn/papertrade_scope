# Position Atlas 0.3.2 — on-chain decoder contract

The POC now enables a checked subset of the reconstructed Papertrade interface. Collection uses public HyperEVM JSON-RPC only. Hyperliquid's documented exchange WebSocket supplies reference prices/candles. The undocumented Papertrade app API is not a runtime dependency.

## Source and code identity

- ABI/topic leads: [Hypermate fixture](https://github.com/jihanwi/hypermate-bot/blob/98a4480caaebd29a2b33500818a2b9cf2662e330/tests/fixtures/papertrade_exchange_abi.json), linked upstream; the full fixture is not redistributed here.
- Storage and semantic cross-checks: [Papertrade Recomp](https://github.com/aaronjmars/papertrade-recomp/tree/a671e1aa10406ffbb2cd60e7c353e75dc1a625da), especially its observed event paths, position layout, unit-scaling analysis and post-upgrade runtime. Its authors describe it as independent reconstruction, not verified original source. No decompiler-generated code was copied into the app.
- Additional independent evidence: our four on-chain transaction/log correspondence tests; live getter matching an observed open; current `collateralScale()` = 10^12; exact SHA256 equality of the deployed 23,959-byte implementation with the captured post-upgrade runtime.
- Known implementation: `0x0a44049dbbb6b4762a6ba37aa0f7548c0b4a3723`; SHA256 `fc7374f3969381160732fe98c5e3145e00c3f167f168d61d65bb4972e9a6b268`.

The collector checks the EIP-1967 implementation slot at both boundaries of each reconciled range and hashes the implementation code once per collector/endpoint session. A failed identity check disables semantic overlays, preserves the staged range in quarantine, and leaves the accepted cursor unchanged. Boundary checks cannot detect an upgrade and rollback entirely inside a single range. Unknown topics remain in raw storage; malformed known layouts produce decoder warnings and no marker for that record.

## Accepted layouts

| Event | Indexed fields | Data words |
| --- | --- | --- |
| PositionOpened | position ID, owner | instrument ID, isLong, useDebt, entry price, margin, leverage |
| PositionClosed | position ID, owner | exit price, signed raw PnL, signed adjusted PnL, unclassified boolean, raw fee |
| Liquidated | position ID, owner | liquidation price, bust price, unclassified boolean, raw fee A, raw fee B |
| PositionsClosed summary | owner | Preserved raw, excluded from individual exits and bubbles |

Each known event requires exact topic and payload widths, canonical membership and valid encoded types. Signed PnL uses two's complement; integer fields and flags are bounds checked. Event economic fee meanings are not used by the UI. Unknown flag meanings remain unclassified.

`positions(uint256)` returns the retained position row even after settlement in the checked samples: owner, instrument ID, entry, margin, leverage, openedAt, side, debt flag and active flag. It is used to resolve **observed exits** whose opens predate collection; it does not enumerate or import all platform positions. Getter owner must match the event owner. Getter failures keep notional/market/side unknown and filtered out. Every getter read is tied to a block.

Markets currently mapped are instrument 0 → BTC, priceScale 10; instrument 1 → ETH, priceScale 100, based on first-party deployment metadata and reconstructed contract evidence. Other instrument IDs remain unavailable. Mapping/admin changes without a runtime change are not automatically discovered in this POC.

Internal margin uses 18-decimal dollar units. Entry notional = raw margin × leverage, retained as a decimal integer string in WAD. The whole-USD display threshold is converted to WAD and compared with BigInt, inclusive of equality. The default is **100,000 USD**. This is frozen entry notional, not current marked inventory or notional liquidated on Hyperliquid's order book. Papertrade events represent synthetic positions against its LP.

## Time, lifecycle and display

The official RPC includes a `blockTimestamp` extension on logs. All 200 saved logs match the 99 independently fetched block headers. The collector uses this field when present and falls back to bounded `eth_getBlockByHash` reads when absent. Receipt/browser arrival times are never substituted for missing chain timestamps.

Canonical events are sorted by block/transaction/log index and deduplicated. Derived positions are rebuilt from the retained canonical journal after reconciliation. A decoded close or liquidation removes the entire entry-price line and opening dot. Individual close events leave an X at actual exit price/time; liquidations leave only bubbles, never close X markers. Historical records remain in the journal and trader history. An active line stops at the latest canonical observation timestamp, rather than implying knowledge across a recovery gap. A pre-session exit resolved from a getter supplies metadata for its exit marker and trader history; it does not create an entry line. Multiple partial closes or position amendments are not implemented; no unrecognized event is silently treated as an adjustment.

Liquidation bubbles sit at actual event time and liquidation price. Color identifies the liquidated side: coral for longs, mint for shorts. Bubble area grows with entry notional up to a 30px radius cap. It is an observed liquidation marker, not a predicted liquidation level/heatmap. Unresolved notional, side, market or timestamps suppress the bubble.

Filters apply to lines, bubbles and activity: whole-USD entry notional, side and lookback. Layer switches and caps affect rendering only; collection continues independently. When caps bind, the largest notionals are selected first. Some eligible overlays can still be outside the visible price/time viewport; visible counts come from the renderer. Candle/context prices are not filtered by participant size. Chart tools support crosshair/inspection, horizontal pan, zoom, time/price measurement, interval aggregation, fit and return to live time.

## Transport, persistence and limits

HTTP collection starts at the current head on a new dataset and resumes a saved cursor on reload. There is no protocol-wide historical import. Ranges are at most 200 blocks with eight prior reconciled blocks of overlap. Code/log/header/getter requests share a minimum 1.1s spacing (roughly 55 requests/minute before network time); errors back off. This is not a dedicated provider quota, and other apps on the IP can share limits. Recovery loops advance immediately while behind, subject to that spacing.

The chart can request two hours of **reference candle context** through Hyperliquid's documented `candleSnapshot` WSS info request. This is separate from the forward-only Papertrade activity dataset. Missing candles are not interpolated. 5m/15m views aggregate retained 1m reference candles and mark incomplete aggregates with reduced opacity. The current candle remains provisional.

IndexedDB retains the existing origin's journal and raw evidence. All logs and accepted cursor are saved atomically. Headers/getter metadata are saved with the journal. One tab holds the collector lock; other tabs consume saved snapshots. Full deep-reorg recovery, automatic secondary-tab takeover and production retention are still out of scope. The raw journal stops at 12,000 records rather than silently deleting evidence; export and use **New observation** to replace it explicitly. Saves occur approximately every five seconds plus range commits; abrupt termination can lose an unsaved tail.

## Real-data replay and verification

**Data sources → Replay captured session** uses the immutable earlier observation, enriched with real block headers and 14 public position getters. It is labelled CAPTURED REPLAY and pauses the live collector; it does not overwrite the live IndexedDB dataset. Returning to live resumes the original cursor. No synthetic trade/position fixtures are shown as live observations.

The small replay contains 58 opens, 42 individual closes and 24 liquidations. All 24 liquidation notionals can be resolved from observed opens or the extra getters. Its BTC/ETH liquidations are below $100k, so the default deliberately shows no replay bubbles; lowering the threshold provides a rendering check. Do not weaken the requested default to make the chart look busier.

Tests cover exact notional boundaries, original event/getter agreement, lifecycle replay, orphan removal, duplicate delivery, unknown metadata, timestamp provenance, malformed known layouts, signed PnL, filtering/caps, sparse candle aggregation and code-identity guards. Browser QA covers live reference/public RPC access, the labelled replay, actual lines/bubbles, overlay controls, side filtering, interval selection, inspection and chart navigation. Evidence is under `evidence/chart-upgrade/`.

## Hover details, trader inspection and wallet follows (0.3.1)

Only positions with no observed exit have entry-price lines. Settled positions have no line or opening dot. The earlier permanent badges, overflow labels and display connectors have been removed. Hovering a line or liquidation reveals exactly one compact interactive label: side/notional, leverage, approximate gross price P&L, and trader handle. Every section uses the same full-height divider as the profile handle. Leverage comes from the matched decoded position; unavailable metadata stays unknown. Moving onto the label preserves access to its buttons; moving away dismisses it. Overlapping line hits remain selectable through the click-to-inspect chooser. Keyboard/touch users can continue to inspect through Activity and the trader panel.

P&L is an estimate: entry notional × (reference / entry − 1) × direction. Settled estimates use the observed exit price. Open estimates use a fresh Hyperliquid mark or recent reference candle; stale/missing reference data is unavailable. This is not Papertrade's realized account settlement: fees, funding, debt effects and other protocol adjustments are excluded. Wins/losses describe the sign of this gross exit-price result; flat and unknown outcomes are counted separately. Raw contract P&L fields remain available in the evidence inspector.

Trader summaries include all matching-owner positions in the accepted journal, irrespective of chart market, minimum size, lookback and layer caps. “Open observed” means an open with no observed exit, not a freshly verified complete inventory. The panel states the observation start and replay mode; it cannot infer unobserved earlier positions, missing exits or complete wallet history. Summaries rebuild after journal reconciliation, so orphaned outcomes do not persist in a separate score cache.

Wallet inspection and follows use the same local model. Followed public addresses persist in browser-local preferences; no wallet is connected and no signing occurs. This foundation does not add an address indexer, historical backfill, wallet-only collection, notification delivery or collection while the browser is closed. A later complete tracker needs explicit historical coverage and current-state reconciliation.

Version 0.3.2 replaces the settled-position switch with a separate Close markers (X) switch. It cannot re-enable historical entry lines, including when an old browser preference still contains showClosed. Close markers share the exact minimum entry-notional, market, side and lookback filters; the Maximum lines / closes cap is applied independently to open lines and close markers. The position-line toggle does not hide close markers. Liquidation visibility/caps remain separate.
