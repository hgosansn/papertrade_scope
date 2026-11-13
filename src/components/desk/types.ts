import type { ReactNode } from "react";

export type DeskProps = { desk: any; controller: any };
export type ObservationSelection = { item: any; overlaps: any[] } | null;
export type LabelledSwitchProps = {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  swatch?: ReactNode;
};
