import { ChevronDown, Layers, Radio, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { priceText } from "@/lib/atlas";
import { cn } from "@/lib/utils";
import { ChartMenuItems } from "./chart-menu";

export function ChartHeader({
  desk,
  controller,
  actions,
  onMenuChange,
  reference,
}: any) {
  const status =
    desk.mode === "replay"
      ? "Captured replay - not live"
      : desk.readOnly
        ? "Another tab is collecting"
        : desk.protocolStatus;
  const healthy =
    desk.mode === "live" &&
    !desk.paused &&
    desk.state.decoder &&
    desk.protocolStatus === "Contract synced";
  return (
    <header
      aria-label="Paperscope header"
      className="z-10 flex h-10 shrink-0 items-center border-b bg-background px-2 sm:px-3"
    >
      <a
        href="./"
        aria-label="Paperscope"
        className="mr-2 flex shrink-0 items-center gap-2 pr-2 sm:mr-3 sm:border-r sm:pr-4"
      >
        <span
          aria-hidden="true"
          className="font-mono text-lg font-semibold text-long"
        >
          P<span className="text-xs">↗</span>
        </span>
        <span className="hidden text-[11px] font-semibold tracking-[0.12em] sm:inline">
          PAPERSCOPE
        </span>
      </a>
      <DropdownMenu onOpenChange={onMenuChange}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label="Chart menu"
            className="h-8 gap-2 px-1.5 text-xs sm:px-2"
          >
            <span className="font-medium">{desk.selected} / USD</span>
            <span className="font-mono text-muted-foreground">
              {desk.interval}m
            </span>
            <span className="ml-1 hidden font-mono md:inline">
              {reference !== null && Number.isFinite(reference)
                ? `$${priceText(reference)}`
                : "—"}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[85dvh] w-60 overflow-y-auto"
        >
          <ChartMenuItems
            kind="dropdown"
            desk={desk}
            controller={controller}
            actions={actions}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <nav
        aria-label="Desk tools"
        className="ml-auto flex shrink-0 items-center gap-0.5 pl-2"
      >
        <span
          className={cn(
            "mr-2 hidden font-mono text-[10px] tracking-wider md:inline",
            desk.mode === "replay" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {desk.mode === "replay" ? "REPLAY" : desk.paused ? "PAUSED" : "LIVE"}
        </span>
        <HeaderAction
          label="Wallets and traders"
          shortLabel="Wallets"
          icon={UsersRound}
          onClick={actions.wallets}
        />
        <HeaderAction
          label="Layers and filters"
          shortLabel="Overlays"
          icon={Layers}
          onClick={actions.layers}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={actions.sources}
              aria-label={`Data sources: ${status}`}
              className="h-8 w-8 gap-1.5 px-0 text-xs sm:w-auto sm:px-2"
            >
              <Radio
                className={cn(
                  "size-3.5",
                  healthy ? "text-long" : "text-warning",
                )}
              />
              <span className="hidden sm:inline">Sources</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{status}</TooltipContent>
        </Tooltip>
      </nav>
    </header>
  );
}

function HeaderAction({ label, shortLabel, icon: Icon, onClick }: any) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          aria-label={label}
          onClick={onClick}
          className="h-8 w-8 gap-1.5 px-0 text-xs sm:w-auto sm:px-2"
        >
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{shortLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
