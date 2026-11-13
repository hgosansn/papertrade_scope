import {
  Activity,
  CandlestickChart,
  ChartNoAxesCombined,
  Layers2,
  Radio,
  Scan,
  UserRound,
  ZoomIn,
  ZoomOut,
  ArrowRightToLine,
  MoveVertical,
} from "lucide-react";
import * as Context from "@/components/ui/context-menu";
import * as Dropdown from "@/components/ui/dropdown-menu";
import { AVERAGES, EVENT_LAYERS } from "@/lib/settings";

const contextParts = {
  Label: Context.ContextMenuLabel,
  Separator: Context.ContextMenuSeparator,
  Item: Context.ContextMenuItem,
  Checkbox: Context.ContextMenuCheckboxItem,
  RadioGroup: Context.ContextMenuRadioGroup,
  RadioItem: Context.ContextMenuRadioItem,
  Sub: Context.ContextMenuSub,
  SubTrigger: Context.ContextMenuSubTrigger,
  SubContent: Context.ContextMenuSubContent,
};

const dropdownParts = {
  Label: Dropdown.DropdownMenuLabel,
  Separator: Dropdown.DropdownMenuSeparator,
  Item: Dropdown.DropdownMenuItem,
  Checkbox: Dropdown.DropdownMenuCheckboxItem,
  RadioGroup: Dropdown.DropdownMenuRadioGroup,
  RadioItem: Dropdown.DropdownMenuRadioItem,
  Sub: Dropdown.DropdownMenuSub,
  SubTrigger: Dropdown.DropdownMenuSubTrigger,
  SubContent: Dropdown.DropdownMenuSubContent,
};

/** Context menu and touch/keyboard menu share one set of controls. */
export function ChartMenuItems({
  kind,
  desk,
  controller,
  actions,
  selection,
}: any) {
  const Menu: any = kind === "context" ? contextParts : dropdownParts;
  function keepOpen(event: Event) {
    event.preventDefault();
  }

  return (
    <>
      <Menu.Label>
        {desk.selected} / USD · {desk.interval}m
      </Menu.Label>
      {selection && (
        <>
          <Menu.Item
            onSelect={() => actions.inspect(selection.item, selection.overlaps)}
          >
            <Scan className="mr-2 size-4" />
            Inspect position #{selection.item.positionId}
          </Menu.Item>
          <Menu.Item onSelect={() => actions.trader(selection.item.owner)}>
            <UserRound className="mr-2 size-4" />
            Inspect this trader
          </Menu.Item>
          <Menu.Separator />
        </>
      )}
      <Menu.Sub>
        <Menu.SubTrigger>
          <CandlestickChart className="mr-2 size-4" />
          Market
        </Menu.SubTrigger>
        <Menu.SubContent>
          <Menu.RadioGroup
            value={desk.selected}
            onValueChange={controller.selectMarket}
          >
            <Menu.RadioItem value="BTC">BTC / USD</Menu.RadioItem>
            <Menu.RadioItem value="ETH">ETH / USD</Menu.RadioItem>
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Sub>
      <Menu.Sub>
        <Menu.SubTrigger>
          <ChartNoAxesCombined className="mr-2 size-4" />
          Candle interval
        </Menu.SubTrigger>
        <Menu.SubContent>
          <Menu.RadioGroup
            value={String(desk.interval)}
            onValueChange={(value: string) =>
              controller.selectInterval(Number(value))
            }
          >
            {[1, 5, 15].map((value) => (
              <Menu.RadioItem key={value} value={String(value)}>
                {value} minute{value > 1 ? "s" : ""}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Sub>
      <Menu.Sub>
        <Menu.SubTrigger>
          <Layers2 className="mr-2 size-4" />
          Event layers
        </Menu.SubTrigger>
        <Menu.SubContent>
          {EVENT_LAYERS.map((layer) => (
            <Menu.Checkbox
              key={layer.key}
              checked={desk.settings[layer.key]}
              onSelect={keepOpen}
              onCheckedChange={(value: boolean) =>
                controller.updateSettings({ [layer.key]: value })
              }
            >
              {layer.label}
            </Menu.Checkbox>
          ))}
        </Menu.SubContent>
      </Menu.Sub>
      <Menu.Sub>
        <Menu.SubTrigger>
          <ChartNoAxesCombined className="mr-2 size-4" />
          Moving averages
        </Menu.SubTrigger>
        <Menu.SubContent>
          {AVERAGES.map((average) => (
            <Menu.Checkbox
              key={average.key}
              checked={desk.settings[average.key]}
              onSelect={keepOpen}
              onCheckedChange={(value: boolean) =>
                controller.updateSettings({ [average.key]: value })
              }
            >
              SMA {average.period}
            </Menu.Checkbox>
          ))}
        </Menu.SubContent>
      </Menu.Sub>
      <Menu.Sub>
        <Menu.SubTrigger>
          <Scan className="mr-2 size-4" />
          Chart navigation
        </Menu.SubTrigger>
        <Menu.SubContent>
          <Menu.Item onSelect={actions.zoomIn}>
            <ZoomIn className="mr-2 size-4" />
            Zoom in
          </Menu.Item>
          <Menu.Item onSelect={actions.zoomOut}>
            <ZoomOut className="mr-2 size-4" />
            Zoom out
          </Menu.Item>
          <Menu.Item onSelect={actions.fit}>
            <Scan className="mr-2 size-4" />
            Fit view
          </Menu.Item>
          <Menu.Item onSelect={actions.autoPrice}>
            <MoveVertical className="mr-2 size-4" />
            Automatic price scale
          </Menu.Item>
          <Menu.Item onSelect={actions.live}>
            <ArrowRightToLine className="mr-2 size-4" />
            Follow latest candles
          </Menu.Item>
        </Menu.SubContent>
      </Menu.Sub>
      <Menu.Separator />
      <Menu.Item onSelect={actions.layers}>
        <Layers2 className="mr-2 size-4" />
        Layers and filters…
      </Menu.Item>
      <Menu.Item onSelect={actions.activity}>
        <Activity className="mr-2 size-4" />
        Position activity…
      </Menu.Item>
      <Menu.Item onSelect={actions.wallets}>
        <UserRound className="mr-2 size-4" />
        Wallets and traders…
      </Menu.Item>
      <Menu.Item onSelect={actions.sources}>
        <Radio className="mr-2 size-4" />
        Data sources…
      </Menu.Item>
    </>
  );
}
