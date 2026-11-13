import { cn } from "@/lib/utils";
import { useState } from "react";
import { Pause, Play, Download, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { DeskProps } from "./types";

export function SourcesPanel({
  desk,
  controller,
  open,
  onOpenChange,
}: DeskProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [endpoint, setEndpoint] = useState("https://rpc.hyperliquid.xyz/evm");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const enabled = desk.leader && desk.mode === "live";
  const facts = [
    ["Observation started", new Date(desk.state.start).toLocaleString()],
    [
      "Reconciled block",
      desk.state.raw.cursor
        ? `#${Number(desk.state.raw.cursor).toLocaleString()}`
        : "First range pending",
    ],
    [
      "Decoded / unresolved",
      `${desk.model.events.length} / ${desk.model.unresolvedExits}`,
    ],
    ["Timestamp backlog", desk.model.missingTimes],
    ["Storage", desk.storageStatus],
    ["Archived observations", desk.archiveCount],
    [
      "Collection backlog",
      desk.state.raw.head && desk.state.raw.cursor
        ? `${Math.max(0, Number(desk.state.raw.head) - Number(desk.state.raw.cursor)).toLocaleString()} blocks`
        : "Starting",
    ],
    ["Reference feed interruptions", `${desk.state.gaps.length} recorded`],
    [
      "Price history",
      desk.mode === "replay" ? "Captured session only" : desk.historyStatus,
    ],
  ];

  function applyEndpoint() {
    try {
      controller.applyEndpoint(endpoint);
      setError("");
    } catch {
      setError("Enter a valid HTTPS RPC endpoint.");
    }
  }
  async function replay() {
    try {
      await controller.replay();
      onOpenChange(false);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Replay unavailable",
      );
    }
  }
  function returnLive() {
    controller.returnLive();
    onOpenChange(false);
  }
  async function replaceObservation() {
    try {
      await controller.newObservation();
      setConfirm(false);
    } catch {
      setError(
        "Could not archive and restart. Your saved journal is retained.",
      );
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-0 max-h-[85dvh] sm:max-w-[400px] w-[calc(100%-24px)] max-w-[calc(100vw-24px)] overflow-y-auto p-0">
          <div className="px-5 py-4">
            <DialogTitle>Data sources</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              Your browser-local observation.
            </DialogDescription>
          </div>
          <Separator />
          <div className="space-y-4 px-5 py-4">
            <SourceStatus
              name="Hyperliquid reference"
              status={
                desk.mode === "replay"
                  ? "Captured reference candles"
                  : desk.readOnly
                    ? "Collector tab snapshots"
                    : desk.referenceStatus
              }
              detail="Documented WebSocket · reference candles and mark"
            />
            <SourceStatus
              name="Papertrade on-chain"
              status={
                desk.mode === "replay"
                  ? "Captured raw logs and RPC metadata"
                  : desk.protocolStatus
              }
              detail="Public HyperEVM RPC · checked contract data"
            />
          </div>
          <Separator />
          <div className="space-y-3 px-5 py-4">
            <label
              htmlFor="rpc-endpoint"
              className="text-xs font-medium text-muted-foreground"
            >
              Public HTTPS RPC
            </label>
            <Input
              id="rpc-endpoint"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!enabled}
                onClick={applyEndpoint}
              >
                Apply endpoint
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!enabled}
                onClick={controller.togglePause}
              >
                {desk.paused ? (
                  <Play className="mr-1.5 size-3" />
                ) : (
                  <Pause className="mr-1.5 size-3" />
                )}
                {desk.paused ? "Resume" : "Pause"}
              </Button>
            </div>
          </div>
          <Separator />
          <dl className="space-y-3 px-5 py-4">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-6 text-xs">
                <dt className="shrink-0 text-muted-foreground">{label}</dt>
                <dd className="text-right font-mono text-[11px]">{value}</dd>
              </div>
            ))}
          </dl>
          <Separator />
          <div className="grid grid-cols-2 gap-2 px-5 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={desk.mode === "replay" ? returnLive : replay}
            >
              <History className="mr-1.5 size-3.5" />
              {desk.mode === "replay" ? "Return to live" : "Captured replay"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={controller.exportJournal}
            >
              <Download className="mr-1.5 size-3.5" />
              Export journal
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="col-span-2 text-muted-foreground"
              disabled={!enabled}
              onClick={() => setConfirm(true)}
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              New observation
            </Button>
            {!!desk.archiveCount && (
              <Button
                variant="outline"
                size="sm"
                className="col-span-2"
                onClick={async () => {
                  try {
                    await controller.exportArchive();
                    setError("");
                  } catch {
                    setError("Could not export the archived observation.");
                  }
                }}
              >
                Export previous observation
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="px-5 pb-4 text-xs text-short">
              {error}
            </p>
          )}
          <p className="border-t bg-muted/25 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Observed cohort, not every platform position. Missing metadata never
            creates guessed overlays. No wallet connection or undocumented app
            API.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a fresh observation?</DialogTitle>
            <DialogDescription>
              Your current journal will be archived locally and remains
              exportable. The new observation starts at the current block. Price
              history and display settings are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={replaceObservation}>Archive and restart</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SourceStatus({
  name,
  status,
  detail,
}: {
  name: string;
  status: string;
  detail: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "Connected" || status === "Contract synced"
              ? "bg-long"
              : "bg-warning",
          )}
        />
        {name}
      </div>
      <p className="mt-1.5 pl-3.5 text-xs">{status}</p>
      <p className="mt-1 pl-3.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}
