import { LabelledSwitchProps } from "./types";
import { Switch } from "@/components/ui/switch";

export function LabelledSwitch({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  swatch,
}: LabelledSwitchProps) {
  return (
    <div className="flex items-center justify-between gap-5 py-2.5">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-3 text-sm"
      >
        {swatch}
        <span>
          <span className="block">{label}</span>
          {description && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {description}
            </span>
          )}
        </span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
