import { useEffect, useState } from "react";
import { ExternalLink, Star, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  traderSummary,
  pricePnl,
  signedMoney,
  walletAddress,
} from "@/lib/trader";
import { shortMoney, priceText } from "@/lib/atlas";
import { cn } from "@/lib/utils";

export function TraderPanel({
  desk,
  controller,
  open,
  onOpenChange,
  owner,
  onOwnerChange,
  onInspect,
}: any) {
  const [input, setInput] = useState(owner || "");
  const [error, setError] = useState("");
  useEffect(() => {
    setInput(owner || "");
    setError("");
  }, [owner]);
  const summary = owner ? traderSummary(desk.model, owner) : null;
  const following = owner && desk.watched.includes(owner);

  function search(event: React.FormEvent) {
    event.preventDefault();
    const address = walletAddress(input);
    if (!address) {
      setError("Enter a valid 0x address with 40 hexadecimal characters.");
      return;
    }
    setError("");
    onOwnerChange(address);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>Trader scope</SheetTitle>
          <SheetDescription>
            Open positions and outcomes in your observed journal.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={search} className="mt-6 space-y-2">
          <label
            htmlFor="wallet-address"
            className="text-xs font-medium text-muted-foreground"
          >
            Wallet address
          </label>
          <div className="flex gap-2">
            <Input
              id="wallet-address"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="0x…"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Button type="submit" size="icon" aria-label="Inspect wallet">
              <Search className="size-4" />
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-short">
              {error}
            </p>
          )}
        </form>
        {!!desk.watched.length && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {desk.watched.map((address: string) => (
              <Button
                key={address}
                variant="secondary"
                size="sm"
                className="h-7 font-mono text-[11px]"
                onClick={() => onOwnerChange(address)}
              >
                <Star className="mr-1.5 size-3" />
                {address.slice(0, 8)}…{address.slice(-4)}
              </Button>
            ))}
          </div>
        )}
        <div className="my-5 rounded-none border bg-muted/25 p-3 text-xs leading-relaxed text-muted-foreground">
          {desk.mode === "replay" && (
            <Badge variant="outline" className="mb-2">
              Captured replay
            </Badge>
          )}
          <p>
            Observed since {new Date(desk.state.start).toLocaleString()}. All
            markets and sizes; chart filters do not apply.
          </p>
          <p className="mt-2">
            Open means no exit observed. Inventory and history may be
            incomplete. Wins/losses use gross entry/exit price moves, excluding
            fees and funding.
          </p>
        </div>
        {!summary ? (
          <p className="py-4 text-sm leading-relaxed text-muted-foreground">
            Enter an address or inspect a position’s profile. Following saves a
            wallet locally for future observations; historical backfill and
            background alerts are not available yet.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => controller.toggleWatch(owner)}
              >
                <Star
                  className={cn("mr-2 size-3.5", following && "fill-current")}
                />
                {following ? "Following · Unfollow" : "Follow locally"}
              </Button>
              <a
                href={`https://hyperevmscan.io/address/${owner}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Explorer
                <ExternalLink className="size-3" />
              </a>
            </div>
            <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">
              {owner}
            </p>
            <div className="my-5 grid grid-cols-4 gap-2">
              {[
                ["Open", summary.open.length],
                ["Wins*", summary.wins],
                ["Losses*", summary.losses],
                ["Flat / ? ", `${summary.flat} / ${summary.unknown}`],
              ].map(([label, count]) => (
                <div
                  key={label}
                  className="rounded-none border bg-muted/25 p-2.5"
                >
                  <p className="font-mono text-xl">{count}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>
            <TraderPositions
              title="Open observed"
              rows={summary.open}
              onInspect={onInspect}
            />
            <TraderPositions
              title="Closed / liquidated history"
              rows={summary.history}
              onInspect={onInspect}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TraderPositions({ title, rows, onInspect }: any) {
  return (
    <section className="mt-5">
      <h3 className="mb-3 text-sm font-medium">
        {title}
        <span className="ml-2 text-muted-foreground">{rows.length}</span>
      </h3>
      <Separator />
      {!rows.length && (
        <p className="py-5 text-xs text-muted-foreground">
          No positions observed in this journal.
        </p>
      )}
      {rows.map((position: any) => {
        const pnl = pricePnl(position, null);
        return (
          <button
            key={position.positionId}
            className="w-full border-b py-4 text-left transition-colors hover:bg-muted/40"
            onClick={() => onInspect(position)}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span>
                {position.symbol || "Unknown"}{" "}
                <span className={position.isLong ? "text-long" : "text-short"}>
                  {position.isLong ? "Long" : "Short"}
                </span>{" "}
                · {position.leverage}×
              </span>
              <span className="font-mono">
                {position.notionalWad
                  ? shortMoney(Number(position.notionalWad) / 1e18)
                  : "Size unknown"}
              </span>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              #{position.positionId} ·{" "}
              {position.entry ? priceText(position.entry) : "Unknown entry"}
              {position.exitEvent?.price != null &&
                ` → ${priceText(position.exitEvent.price)}`}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {position.status} ·{" "}
              {new Date(position.endTime || position.openedAt).toLocaleString()}
            </p>
            <p
              className={cn(
                "mt-2 text-xs",
                pnl > 0
                  ? "text-long"
                  : pnl < 0
                    ? "text-short"
                    : "text-muted-foreground",
              )}
            >
              {position.status === "open"
                ? "No exit observed"
                : pnl === null
                  ? "Outcome unknown"
                  : `${pnl > 0 ? "Win*" : pnl < 0 ? "Loss*" : "Flat*"} · ≈${signedMoney(pnl)}`}
            </p>
          </button>
        );
      })}
    </section>
  );
}
