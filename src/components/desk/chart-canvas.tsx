import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserRound, Activity } from "lucide-react";
import {
  AtlasChart,
  aggregateCandles,
  shortMoney,
  priceText,
} from "@/lib/atlas";
import { filterOverlays } from "@/lib/protocol";
import { pricePnl, signedMoney } from "@/lib/trader";
import { cn } from "@/lib/utils";

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
} from "@/components/ui/context-menu";
import { ChartHeader } from "./chart-header";
import { ChartMenuItems } from "./chart-menu";

export function referenceFor(desk: any, symbol: string) {
  const context = desk.state.contexts[symbol];
  if (
    desk.mode === "live" &&
    context &&
    Date.now() - context.receivedAt < 15000
  )
    return Number(context.markPx);
  const last = desk.state.candles
    .filter((candle: any) => candle.s === symbol)
    .at(-1);
  return last &&
    (desk.mode === "replay" || Date.now() - Number(last.T) < 120000)
    ? Number(last.c)
    : null;
}

export function ChartCanvas({
  desk,
  controller,
  onInspect,
  onTrader,
  onActivity,
  onLayers,
  onSources,
  onWallets,
}: any) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<AtlasChart>(null);
  const latest = useRef({ desk, onInspect });
  latest.current = { desk, onInspect };
  const [hover, setHover] = useState<any>(null);
  const [crosshair, setCrosshair] = useState<any>(null);
  const [counts, setCounts] = useState({ lines: 0, closes: 0, bubbles: 0 });
  const hoverCard = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const holdHover = useRef(false);
  const identity = useRef("");
  const [contextSelection, setContextSelection] = useState<any>(null);

  const overlays = useMemo(
    () =>
      filterOverlays(desk.model, {
        ...desk.settings,
        symbol: desk.selected,
        from: desk.now - desk.settings.lookback,
        to: desk.now,
      }),
    [desk.model, desk.settings, desk.selected, desk.now],
  );
  const candles = useMemo(
    () =>
      desk.state.candles.filter((candle: any) => candle.s === desk.selected),
    [desk.state.candles, desk.selected],
  );

  const receiveHover = useCallback((hit: any) => {
    setCrosshair(hit?.crosshair || null);
    clearTimeout(hideTimer.current);
    if (hit?.item) setHover(hit);
    else if (!holdHover.current)
      hideTimer.current = setTimeout(() => setHover(null), 120);
  }, []);

  useEffect(() => {
    chart.current = new AtlasChart(canvas.current, {
      onHover: receiveHover,
      onInspect: (item: any, overlaps: any[]) => {
        setHover(null);
        latest.current.onInspect(item, overlaps);
      },
      onStats: (next: any) =>
        setCounts((previous) => {
          const value = {
            lines: next.lines || 0,
            closes: next.closes || 0,
            bubbles: next.bubbles || 0,
          };
          return JSON.stringify(previous) === JSON.stringify(value)
            ? previous
            : value;
        }),
    });
    return () => {
      clearTimeout(hideTimer.current);
      chart.current?.destroy();
    };
  }, [receiveHover]);

  useEffect(() => {
    const nextIdentity = `${desk.selected}:${desk.mode}:${desk.state.start}`;
    if (identity.current !== nextIdentity) {
      identity.current = nextIdentity;
      chart.current.view = null;
      setHover(null);
    }
    chart.current.interval = desk.interval;
    chart.current.setData({
      candles,
      overlays,
      now: desk.now,
      reference: referenceFor(desk, desk.selected),
      start: desk.state.start,
      lookback: desk.settings.lookback,
      priceHistory:
        desk.mode === "replay"
          ? Math.max(
              900000,
              Math.min(172800000, desk.now - (candles[0]?.t ?? desk.now)),
            )
          : 172800000,
      movingAverages: Object.fromEntries(
        [9, 21, 50, 200].map((period) => [
          period,
          desk.settings[`sma${period}`],
        ]),
      ),
    });
  }, [desk, candles, overlays]);

  useEffect(() => {
    holdHover.current = false;
    setHover(null);
  }, [desk.settings]);

  useEffect(() => {
    const node = hoverCard.current;
    if (!node || !hover || !canvas.current) return;
    const box = canvas.current.getBoundingClientRect();
    node.style.setProperty(
      "--hover-x",
      `${Math.max(8, Math.min(hover.x + 12, box.width - node.offsetWidth - 8))}px`,
    );
    node.style.setProperty(
      "--hover-y",
      `${Math.max(8, Math.min(hover.y - 15, box.height - 40))}px`,
    );
  }, [hover]);

  const item = hover?.item;
  const position = item
    ? item.status
      ? item
      : desk.model.positions.find(
          (row: any) => row.positionId === item.positionId,
        )
    : null;
  const pnl = position
    ? pricePnl(position, referenceFor(desk, position.symbol))
    : null;
  const bar = crosshair?.bar || aggregateCandles(candles, desk.interval).at(-1);
  function inspectHover() {
    if (item) {
      setHover(null);
      onInspect(item);
    }
  }
  function inspectTrader() {
    if (item) {
      setHover(null);
      holdHover.current = false;
      onTrader(item.owner);
    }
  }
  function holdDetails() {
    holdHover.current = true;
    clearTimeout(hideTimer.current);
  }
  function releaseDetails() {
    holdHover.current = false;
    setHover(null);
  }

  const actions = {
    inspect: onInspect,
    trader: onTrader,
    activity: onActivity,
    layers: onLayers,
    sources: onSources,
    wallets: onWallets,
    zoomIn: () => chart.current?.zoom(1 / 1.4),
    zoomOut: () => chart.current?.zoom(1.4),
    fit: () => chart.current?.fit(true),
    autoPrice: () => chart.current?.resetPriceScale(),
    live: () => chart.current?.live(),
  };
  function captureContext(event: React.MouseEvent) {
    const hits = chart.current?.hitAll(chart.current.coords(event)) || [];
    setContextSelection(
      hits.length
        ? { item: hits[0].item, overlaps: hits.map((hit: any) => hit.item) }
        : null,
    );
    setHover(null);
  }
  function openMenu(open: boolean) {
    if (open) {
      chart.current.drag = null;
      holdHover.current = false;
      setHover(null);
    }
  }

  return (
    <>
      <ChartHeader
        desk={desk}
        controller={controller}
        actions={actions}
        onMenuChange={openMenu}
        reference={referenceFor(desk, desk.selected)}
      />
      <ContextMenu onOpenChange={openMenu}>
        <ContextMenuTrigger asChild onContextMenu={captureContext}>
          <section
            className="relative min-h-0 flex-1 overflow-hidden bg-background"
            aria-label="Interactive market chart"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
            >
              <span className="text-8xl font-semibold tracking-tighter text-watermark">
                {desk.selected}
              </span>
            </div>
            <canvas
              ref={canvas}
              className="relative block size-full touch-none"
              tabIndex={0}
              aria-describedby="chart-access-help"
              aria-label="Reference candles, moving averages, positions, closes and liquidations"
            />
            <p id="chart-access-help" className="sr-only">
              Right-click for chart options. Use the Chart menu button for touch
              or keyboard access. Drag to pan; drag or scroll the right price
              axis to zoom vertically.
            </p>
            {crosshair && (
              <div className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-110px)] rounded-none bg-background/90 px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
                <p>
                  {new Date(crosshair.time).toLocaleString()} ·{" "}
                  {priceText(crosshair.price)}
                </p>
                {bar && (
                  <p className="mt-0.5 truncate">
                    O {priceText(bar.o)} H {priceText(bar.h)} L{" "}
                    {priceText(bar.l)} C {priceText(bar.c)}
                  </p>
                )}
              </div>
            )}
            {!candles.length && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="max-w-sm px-6 text-center">
                  <Activity className="mx-auto mb-4 size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">Listening to the market</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Reference candles load from Hyperliquid. Position overlays
                    begin with your collected on-chain observations.
                  </p>
                </div>
              </div>
            )}
            {item && (
              <div
                ref={hoverCard}
                role="group"
                data-side={item.isLong ? "long" : "short"}
                aria-label={`Position ${item.positionId} hover details`}
                className={cn(
                  "position-hover z-20 flex h-8 max-w-[calc(100%-16px)] overflow-hidden rounded-none border bg-popover font-mono text-[11px] ",
                  position?.status !== "open" && "border-dashed",
                )}
                onPointerEnter={holdDetails}
                onPointerLeave={releaseDetails}
                onFocus={holdDetails}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    releaseDetails();
                }}
              >
                <button
                  className="px-2.5 hover:bg-accent"
                  onClick={inspectHover}
                  aria-label="Position notional; inspect evidence"
                >
                  {item.isLong ? "L" : "S"}{" "}
                  {shortMoney(Number(item.notionalWad) / 1e18)}
                </button>
                <button
                  className="px-2.5 hover:bg-accent"
                  onClick={inspectHover}
                  aria-label="Leverage; inspect evidence"
                >
                  {position?.leverage != null
                    ? `${position.leverage}×`
                    : "Lev —"}
                </button>
                <button
                  className="px-2.5 hover:bg-accent"
                  onClick={inspectHover}
                  aria-label="Estimated gross P&L; inspect evidence"
                  title="Gross price estimate; excludes fees and funding"
                >
                  {pnl === null ? "P&L —" : `≈${signedMoney(pnl)}`}
                </button>
                <button
                  className="px-2.5 hover:bg-accent"
                  onClick={inspectTrader}
                  aria-label="Inspect trader"
                >
                  <UserRound className="size-3.5" />
                </button>
              </div>
            )}
            <output className="sr-only" aria-label="Visible chart layers">
              {counts.lines} lines, {counts.closes} closes, {counts.bubbles}{" "}
              liquidations
            </output>
          </section>
        </ContextMenuTrigger>
        <ContextMenuContent className="max-h-[85dvh] w-60 overflow-y-auto">
          <ChartMenuItems
            kind="context"
            desk={desk}
            controller={controller}
            actions={actions}
            selection={contextSelection}
          />
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}
