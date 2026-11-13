import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { shortMoney } from "@/lib/atlas";
import { notionalPass } from "@/lib/protocol";
import { cn } from "@/lib/utils";

export function ActivityPanel({ desk, open, onOpenChange, onInspect }: any) {
  const { settings } = desk;
  const rows = desk.model.events
    .filter(
      (event: any) =>
        event.symbol === desk.selected &&
        event.time !== null &&
        event.time >= desk.now - settings.lookback &&
        event.time <= desk.now &&
        notionalPass(event.notionalWad, settings.minimum) &&
        (settings.side === "both" ||
          (event.isLong ? "long" : "short") === settings.side),
    )
    .sort((a: any, b: any) => b.time - a.time);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="overflow-y-auto sm:max-w-[380px]">
        <SheetHeader>
          <SheetTitle>Position activity</SheetTitle>
          <SheetDescription>
            Filtered on-chain events · {rows.length} matching
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5">
          {rows.slice(0, 100).map((event: any) => (
            <button
              key={event.id}
              onClick={() => onInspect(event)}
              className="flex w-full items-center justify-between gap-3 border-b py-4 text-left hover:bg-muted/40"
            >
              <span>
                <span
                  className={cn(
                    "text-sm",
                    event.isLong ? "text-long" : "text-short",
                  )}
                >
                  {event.kind === "liquidation"
                    ? "Liquidated"
                    : event.kind === "open"
                      ? "Opened"
                      : "Closed"}{" "}
                  {event.isLong ? "long" : "short"}
                </span>
                <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">
                  #{event.positionId} ·{" "}
                  {new Date(event.time).toLocaleTimeString()}
                </span>
              </span>
              <span className="font-mono text-xs">
                {shortMoney(Number(event.notionalWad) / 1e18)}
              </span>
            </button>
          ))}
          {!rows.length && (
            <p className="py-8 text-sm text-muted-foreground">
              No observations match these filters.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
