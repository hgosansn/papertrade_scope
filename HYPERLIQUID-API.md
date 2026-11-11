# What can run directly over Hyperliquid WSS?

Reviewed 11 November 2026. Mainnet endpoint: `wss://api.hyperliquid.xyz/ws`. This is the exchange API, not an EVM JSON-RPC socket. It cannot replace an HyperEVM RPC provider's `eth_subscribe` / `eth_getLogs` for Papertrade contract events.

| Direct capability | Documented feed / request | Useful application | Prototype status |
| --- | --- | --- | --- |
| Mid prices | `allMids` | Broad price watchlist, mark/reference separation | Available; not subscribed |
| Best quotes | `bbo` | Spread and best bid/ask reference | Live-tested on BTC/ETH/SOL |
| Book depth snapshots | `l2Book` subscription or info request | Depth view, explicit depth imbalance | Native WSS info request live-tested, 20 levels each side |
| Public trade prints | `trades` | Tape, observed size/volume, reported-side statistics, buyer/seller address inspection where supplied | Live-tested; raw strings/IDs retained |
| Live OHLCV | `candle` | Embedded chart, supported 1m–1M intervals | 1m live-tested; no history import |
| Perpetual context | `activeAssetCtx`, `allDexsAssetCtxs` | Mark/oracle prices, funding, OI and daily volume | Per-asset context live-tested |
| Known-address fills | `userFills`, `userEvents` | Observed account activity; fill fields include start position, direction, fees, closed PnL and optional liquidation details | Documented only, no address tracking implemented |
| Known-address positions/orders/balances | `clearinghouseState`, `allDexsClearinghouseState`, `openOrders`, `orderUpdates`, `spotState` | Address-specific exposure and order monitoring | Documented only |
| Known-address funding/transfers/TWAP | `userFundings`, `userNonFundingLedgerUpdates`, `twapStates`, `userTwapSliceFills`, `userTwapHistory` | Account monitoring and execution analysis | Documented only |
| Request/response info | `method: post`, `request.type: info` | Many normal HTTP info queries over the same socket | L2 example tested |
| Signed exchange actions | `method: post`, `request.type: action` | Orders/cancels and other signed exchange operations | Documented capability; not implemented/authorized here |

Market subscriptions need no API key or wallet connection. Documented user subscriptions take an account address; an address-specific feed is not platform-wide account coverage. Account state, liquidation distance and risk interpretation require the appropriate account/asset data and verified rules.

Public tape includes trade ID, time, price, size, side, hash and buyer/seller addresses in the documented schema. Use `(time, coin, tid)` for deduplication. A print has a buyer and seller; side alone is not an opening or closing position classifier. The prototype conservatively labels the raw side without claiming validated aggressor CVD. Public trade payloads do not carry the `startPosition`/`dir`/liquidation fields of user fills. A documented market-wide liquidation subscription is not listed; address-specific liquidation observations cannot be called a complete market liquidation map. OI alone cannot tell which side of the crowd is more exposed.

## Wire examples

Subscribe:

```json
{"method":"subscribe","subscription":{"type":"trades","coin":"BTC"}}
```

Live candle:

```json
{"method":"subscribe","subscription":{"type":"candle","coin":"BTC","interval":"1m"}}
```

Normal info query over the socket:

```json
{"method":"post","id":1,"request":{"type":"info","payload":{"type":"l2Book","coin":"BTC"}}}
```

The response uses `channel: post` and the same ID. Live test response envelope: `data.response.payload.type: l2Book`, with the book in `data.response.payload.data`. Explorer requests are explicitly unsupported over this WebSocket. Signed actions require proper signatures/nonces; using WSS does not bypass authentication or action limits.

## Operational limits

Official docs list IP-based limits of 10 simultaneous sockets, 30 new connections/minute, 1,000 subscriptions, 2,000 outbound messages/minute across sockets and 100 simultaneous in-flight post requests. User subscriptions also have a maximum of 10 unique users across sockets. These limits are not a grant of unlimited fan-out or a public-host suitability guarantee. Shared IPs can share allowances. Recheck official limits before deployment.

The documented idle timeout is 60 seconds without a server message. Send `{"method":"ping"}` and expect `channel: pong`; this app sends every 20s, detects 45s of silence, and backs off reconnects up to 30s plus jitter. Reconnect snapshots are feed-specific; never assume they replay an arbitrarily long outage. A server disconnect can occur without announcement.

The native exchange price feed avoids continuous HyperEVM RPC calls for price candles. Separate mapping and interpretation are still required before using its BBO/mark/oracle as a Papertrade reference. Sparse synthetic execution prices are not continuous exchange candles.

## Sources

- [Official WebSocket overview](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [Official subscription schemas](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Official post request envelopes](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/post-requests)
- [Official timeouts/heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats)
- [Official rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits)

Search-service copies of the official API docs were reviewed; some direct fetches returned unsupported content-type/403. Actual browser responses, rather than third-party summaries, establish the live-tested rows above. Other feeds remain documented, not connectivity-tested.
