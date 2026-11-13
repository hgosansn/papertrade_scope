import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayersPanel } from "@/components/desk/layers-panel";
import { SourcesPanel } from "@/components/desk/sources-panel";
import { TraderPanel } from "@/components/desk/trader-panel";
import { ActivityPanel } from "@/components/desk/activity-panel";
import { ObservationDialog } from "@/components/desk/observation-dialog";
import { ChartCanvas } from "@/components/desk/chart-canvas";
import { useDesk } from "@/hooks/use-desk";
import type { ObservationSelection } from "@/components/desk/types";

export function App() {
  const { controller, snapshot: desk } = useDesk();
  const [traderOpen, setTraderOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [owner, setOwner] = useState<string>(null);
  const [selection, setSelection] = useState<ObservationSelection>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  function inspect(item: any, overlaps: any[] = []) {
    setActivityOpen(false);
    setTraderOpen(false);
    setSelection({ item, overlaps });
  }
  function openTrader(address: string) {
    setSelection(null);
    setOwner(address);
    setTraderOpen(true);
  }
  function openWallets() {
    setTraderOpen(true);
  }

  return (
    <TooltipProvider delayDuration={350}>
      <main className="relative flex h-dvh min-w-[320px] flex-col overflow-hidden">
        <ChartCanvas
          desk={desk}
          controller={controller}
          onInspect={inspect}
          onTrader={openTrader}
          onActivity={() => setActivityOpen(true)}
          onLayers={() => setLayersOpen(true)}
          onSources={() => setSourcesOpen(true)}
          onWallets={openWallets}
        />
        <LayersPanel
          desk={desk}
          controller={controller}
          open={layersOpen}
          onOpenChange={setLayersOpen}
        />
        <SourcesPanel
          desk={desk}
          controller={controller}
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
        />
        <TraderPanel
          desk={desk}
          controller={controller}
          open={traderOpen}
          onOpenChange={setTraderOpen}
          owner={owner}
          onOwnerChange={setOwner}
          onInspect={inspect}
        />
        <ActivityPanel
          desk={desk}
          open={activityOpen}
          onOpenChange={setActivityOpen}
          onInspect={inspect}
        />
        <ObservationDialog
          selection={selection}
          onClose={() => setSelection(null)}
          onSelect={inspect}
          onTrader={openTrader}
        />
      </main>
    </TooltipProvider>
  );
}
