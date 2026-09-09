import { LoadingOverlay } from "@mantine/core";

/** Overlay uniforme durante il salvataggio dei form aperti in una finestra autonoma. */
export function OverlaySalvataggioFinestra({ visibile }: { visibile: boolean }) {
  return <LoadingOverlay visible={visibile} zIndex={1400}
    overlayProps={{ radius: "sm", backgroundOpacity: 0.4 }}
    loaderProps={{ color: "yellow", type: "bars" }} />;
}
