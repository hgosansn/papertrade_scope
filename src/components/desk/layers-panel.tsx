import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AVERAGES, EVENT_LAYERS, LOOKBACKS } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { LabelledSwitch } from "./controls";
import type { DeskProps } from "./types";

export function LayerSwatch({ icon }: { icon: string }) {
  if (icon === "bubble")
    return (
      <span className="size-2.5 shrink-0 rounded-none border border-short bg-short/15" />
    );
  if (icon === "close")
    return (
      <span className="w-3 text-center font-mono text-muted-foreground">×</span>
    );
  return <span className="h-px w-3 shrink-0 bg-long" />;
}

export function LayersPanel({
  desk,
  controller,
  open,
  onOpenChange,
}: DeskProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { settings } = desk;
  function updateMinimum(event: React.ChangeEvent<HTMLInputElement>) {
    controller.updateSettings({
      minimum: Math.max(0, Math.ceil(Number(event.target.value) || 0)),
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 max-h-[85dvh] sm:max-w-[380px] w-[calc(100%-24px)] max-w-[calc(100vw-24px)] overflow-y-auto p-0">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <DialogTitle>Chart layers</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              Choose what stays in view.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mr-7"
            aria-label="Reset layer settings"
            onClick={controller.resetSettings}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
        <Separator />
        <div className="space-y-3 px-5 py-4">
          <label
            htmlFor="minimum-notional"
            className="text-xs font-medium text-muted-foreground"
          >
            Minimum entry notional · USD
          </label>
          <Input
            id="minimum-notional"
            type="number"
            min="0"
            step="10000"
            className="font-mono"
            value={settings.minimum}
            onChange={updateMinimum}
          />
          <div className="grid grid-cols-4 gap-1.5">
            {[100000, 250000, 1000000, 5000000].map((value, i) => (
              <Button
                key={value}
                size="sm"
                variant={settings.minimum === value ? "secondary" : "outline"}
                aria-pressed={settings.minimum === value}
                className="h-7 text-xs aria-pressed:ring-1 aria-pressed:ring-ring"
                onClick={() => controller.updateSettings({ minimum: value })}
              >
                {["100k", "250k", "1m", "5m"][i]}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Lookback</p>
              <Select
                value={String(settings.lookback)}
                onValueChange={(value) =>
                  controller.updateSettings({ lookback: Number(value) })
                }
              >
                <SelectTrigger aria-label="Lookback">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOOKBACKS.map((item) => (
                    <SelectItem key={item.value} value={String(item.value)}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Position side</p>
              <Select
                value={settings.side}
                onValueChange={(side) => controller.updateSettings({ side })}
              >
                <SelectTrigger aria-label="Position side">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both sides</SelectItem>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <Separator />
        <div className="px-5 py-3">
          {EVENT_LAYERS.map((layer) => (
            <LabelledSwitch
              key={layer.key}
              id={layer.key}
              label={layer.label}
              description={layer.description}
              swatch={<LayerSwatch icon={layer.icon} />}
              checked={settings[layer.key]}
              onCheckedChange={(checked) =>
                controller.updateSettings({ [layer.key]: checked })
              }
            />
          ))}
        </div>
        <Separator />
        <div className="space-y-5 px-5 py-4">
          {[
            { key: "maxPositions", label: "Maximum lines / close markers" },
            { key: "maxBubbles", label: "Maximum liquidation bubbles" },
          ].map((item) => (
            <div key={item.key} className="space-y-3">
              <div className="flex justify-between text-xs">
                <label htmlFor={item.key}>{item.label}</label>
                <output className="font-mono text-muted-foreground">
                  {settings[item.key]}
                </output>
              </div>
              <Slider
                id={item.key}
                aria-label={item.label}
                value={[settings[item.key]]}
                onValueChange={([value]) =>
                  controller.updateSettings({ [item.key]: value })
                }
                max={200}
                step={5}
              />
            </div>
          ))}
        </div>
        <Separator />
        <div className="px-5 py-4">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            SIMPLE MOVING AVERAGES
          </h3>
          {AVERAGES.map((average) => (
            <LabelledSwitch
              key={average.key}
              id={average.key}
              label={`SMA ${average.period}`}
              checked={settings[average.key]}
              onCheckedChange={(checked) =>
                controller.updateSettings({ [average.key]: checked })
              }
              swatch={<span className={cn("h-px w-3", average.color)} />}
            />
          ))}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Selected candle interval. Lines need enough consecutive candles; the
            current candle is provisional.
          </p>
        </div>
        <div className="border-t bg-muted/25 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Entry margin × leverage. Filters affect display, never collection.
          Largest notionals first.
        </div>
      </DialogContent>
    </Dialog>
  );
}
