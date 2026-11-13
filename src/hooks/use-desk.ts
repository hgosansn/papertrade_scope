import { useEffect, useState, useSyncExternalStore } from "react";
import { DeskController } from "@/lib/desk-controller";

export function useDesk() {
  const [controller] = useState(() => new DeskController());
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);

  return { controller, snapshot };
}
