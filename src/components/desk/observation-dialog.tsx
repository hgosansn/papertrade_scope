import { ExternalLink, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { shortMoney, priceText } from "@/lib/atlas";
import type { ObservationSelection } from "./types";

export function ObservationDialog({
  selection,
  onClose,
  onSelect,
  onTrader,
}: {
  selection: ObservationSelection;
  onClose: () => void;
  onSelect: (item: any, overlaps: any[]) => void;
  onTrader: (owner: string) => void;
}) {
  const item = selection?.item;
  const choices = [
    ...new Map(
      (selection?.overlaps || []).map((item) => [item.positionId, item]),
    ).values(),
  ];
  const tx = item?.transactionHash || item?.exitEvent?.transactionHash;
  return (
    <Dialog open={!!selection} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>On-chain observation</DialogTitle>
          <DialogDescription>
            Original decoded evidence and position details.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <>
            {choices.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {choices.length} overlapping positions — choose one
                </p>
                <div className="flex flex-wrap gap-2">
                  {choices.map((choice: any) => (
                    <Button
                      key={choice.positionId}
                      size="sm"
                      variant={
                        choice.positionId === item.positionId
                          ? "secondary"
                          : "outline"
                      }
                      onClick={() => onSelect(choice, choices)}
                    >
                      #{choice.positionId} · {choice.isLong ? "Long" : "Short"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{item.symbol || "Unknown market"}</Badge>
              <Badge variant="secondary">{item.status || item.kind}</Badge>
              <span className="font-mono text-sm">#{item.positionId}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-none border p-4 text-xs">
              <div>
                <p className="text-muted-foreground">Entry notional</p>
                <p className="mt-1 font-mono">
                  {item.notionalWad
                    ? shortMoney(Number(item.notionalWad) / 1e18)
                    : "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Entry price</p>
                <p className="mt-1 font-mono">
                  {item.entry ? priceText(item.entry) : "Unknown"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTrader(item.owner)}
              >
                <UserRound className="mr-2 size-3.5" />
                Inspect trader
              </Button>
              {tx && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={`https://hyperevmscan.io/tx/${tx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Transaction
                    <ExternalLink className="ml-2 size-3.5" />
                  </a>
                </Button>
              )}
            </div>
            <details className="rounded-none border">
              <summary className="cursor-pointer px-4 py-3 text-xs text-muted-foreground">
                Raw decoded evidence
              </summary>
              <pre className="max-h-72 overflow-auto border-t p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                {JSON.stringify(item, null, 2)}
              </pre>
            </details>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
