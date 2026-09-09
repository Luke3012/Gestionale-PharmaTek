// Finestra «Notifiche» (FASE 6D) — aperta dallo Spotlight. È praticamente il
// pop-over della campanella in una piccola finestra a sé: riusa `ListaNotifiche`
// (variante `riempi`). L'identità arriva dai parametri della query (per il
// read-state per-utente e l'apertura delle entità collegate).
import { Box } from "@mantine/core";
import { useEffect, useState } from "react";
import { inTauri } from "../lib/tauri";
import { identityDaParametri } from "../lib/identityParams";
import { useRicordaGeometria } from "../lib/geometriaFinestre";
import { ListaNotifiche } from "../features/notifiche/ListaNotifiche";
import { useNotifiche } from "../features/notifiche/useNotifiche";
import type { ComposeNotificaTarget } from "./apriPannelli";

export function NotificheWindow() {
  const params = new URLSearchParams(window.location.search);
  const composeDest = params.get("composeDest") ?? "";
  const composeNome = params.get("composeNome") ?? "";
  const identity = identityDaParametri(params);

  // Questa finestra consulta e modifica lo stato, ma il rilevatore Rust appartiene
  // esclusivamente alla campanella della Shell principale.
  const state = useNotifiche(identity, false);
  useRicordaGeometria("notifiche");
  const [componi, setComponi] = useState<{ destId: string; destNome: string; nonce: number } | undefined>(
    composeDest ? { destId: composeDest, destNome: composeNome || composeDest, nonce: 1 } : undefined
  );

  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ComposeNotificaTarget>("pt:notifiche-componi", ({ payload }) => {
        setComponi((c) => ({ destId: payload.destId, destNome: payload.destNome, nonce: (c?.nonce ?? 0) + 1 }));
      }).then((fn) => (off = fn));
    });
    return () => off?.();
  }, []);

  return (
    <Box style={{ height: "100vh", background: "var(--surface)" }}>
      <ListaNotifiche state={state} identity={identity} riempi componiTarget={componi} />
    </Box>
  );
}
