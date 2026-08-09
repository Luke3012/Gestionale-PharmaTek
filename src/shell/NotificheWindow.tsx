// Finestra «Notifiche» (FASE 6D) — aperta dallo Spotlight. È praticamente il
// pop-over della campanella in una piccola finestra a sé: riusa `ListaNotifiche`
// (variante `riempi`). L'identità arriva dai parametri della query (per il
// read-state per-utente e l'apertura delle entità collegate).
import { Box } from "@mantine/core";
import { useEffect, useState } from "react";
import { inTauri, type Identity } from "../lib/tauri";
import { useRicordaGeometria } from "../lib/geometriaFinestre";
import { ListaNotifiche } from "../features/notifiche/ListaNotifiche";
import { useNotifiche } from "../features/notifiche/useNotifiche";
import type { ComposeNotificaTarget } from "./apriPannelli";

export function NotificheWindow() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get("uid");
  const composeDest = params.get("composeDest") ?? "";
  const composeNome = params.get("composeNome") ?? "";
  const identity: Identity | undefined = uid
    ? {
        userId: uid,
        nome: params.get("nome") ?? "",
        deviceId: params.get("dev") ?? "",
        avatarTipo: "iniziali",
        avatarValore: "",
        deviceNome: "",
        dataDir: "",
      }
    : undefined;

  const state = useNotifiche(identity);
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
