// Configurazione del menu a 6 voci (UI-SPEC §4).
import {
  IconAddressBook,
  IconClipboardList,
  IconFlask2,
  IconFileDollar,
  IconLayoutDashboard,
  IconSettings,
  IconTruck,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";

export interface VoceMenu {
  path: string;
  label: string;
  Icon: Icon;
}

export const MENU: VoceMenu[] = [
  { path: "/", label: "Dashboard", Icon: IconLayoutDashboard },
  { path: "/giornaliero", label: "Giornaliero", Icon: IconClipboardList },
  { path: "/preventivi", label: "Preventivi", Icon: IconFileDollar },
  { path: "/produzione", label: "Produzione", Icon: IconFlask2 },
  { path: "/evasione", label: "Spedizioni", Icon: IconTruck },
  { path: "/contabilita", label: "Contabilità", Icon: IconWallet },
  { path: "/anagrafiche", label: "Anagrafiche", Icon: IconAddressBook },
  { path: "/impostazioni", label: "Impostazioni", Icon: IconSettings },
];

export function titoloPerPath(pathname: string): string {
  const exact = MENU.find((m) => m.path === pathname);
  if (exact) return exact.label;
  const prefix = MENU.filter((m) => m.path !== "/").find((m) =>
    pathname.startsWith(m.path)
  );
  return prefix?.label ?? "Dashboard";
}
