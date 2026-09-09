import type { ReactNode } from "react";
import { Stack } from "@mantine/core";
import { stileVistaTabellaParallela } from "./motion";

/** Contenitore comune delle viste mantenute montate durante il cambio scheda. */
export function VistaTabellaParallela({
  nascosta,
  ridurreAnimazioni,
  children,
}: {
  nascosta: boolean;
  ridurreAnimazioni: boolean;
  children: ReactNode;
}) {
  return (
    <Stack gap="md" style={stileVistaTabellaParallela(nascosta, ridurreAnimazioni)}>
      {children}
    </Stack>
  );
}
