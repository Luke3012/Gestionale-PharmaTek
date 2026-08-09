// Finestra dedicata promemoria (FASE 6C/6D): «Nuovo» (anche pre-collegato) o la
// MODIFICA di un promemoria esistente (parametro `pid` → carica il record). Riusa
// lo stesso PromemoriaForm della modale e si chiude al salvataggio. L'evento di
// invalidazione viene emesso dal backend insieme alla scrittura.
//
// Layout FISSO come la finestra Ordine (`height: 100vh; overflow: auto`): niente
// auto-ridimensionamento al contenuto. L'auto-fit precedente (ResizeObserver +
// setSize) faceva «collassare» la finestra durante il caricamento → sembrava
// «aprirsi e chiudersi subito». Vedi storia FASE 6.
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Group, Loader, Text, ThemeIcon } from "@mantine/core";
import { IconBellPlus, IconPencil } from "@tabler/icons-react";
import { api, inTauri, type Identity } from "../../lib/tauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { PromemoriaForm, type PromemoriaTarget } from "./PromemoriaModal";
import { leggiPromemoria, type CollegatoTipo } from "./promemoria";
import { chiudiFinestraCorrente as chiudiFinestra } from "../../lib/finestreTauri";

export function PromemoriaWindow() {
  const params = new URLSearchParams(window.location.search);

  const uid = params.get("uid");
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

  const pid = params.get("pid");
  const isEdit = !!pid;
  const unsubRef = useRef<(() => void) | null>(null);

  useRicordaGeometria("promemoria");

  // In modifica: carica il record prima di mostrare il form (fetch-then-render).
  const [target, setTarget] = useState<PromemoriaTarget | null>(() => {
    if (pid) return null; // si popola dopo il caricamento
    const ctipo = params.get("ctipo") as CollegatoTipo | null;
    const cid = params.get("cid");
    const cnome = params.get("cnome");
    return ctipo && cid ? { collegatoPre: { tipo: ctipo, id: cid, nome: cnome ?? "" } } : {};
  });
  const [errore, setErrore] = useState(false);

  const caricaPromemoria = useCallback(async () => {
    if (!pid) return;
    try {
      const rec = await api.recordGet("promemoria", pid);
      if (rec && !rec.deleted) {
        setErrore(false);
        setTarget({ promemoria: leggiPromemoria(rec) });
      } else {
        setErrore(true);
      }
    } catch {
      setErrore(true);
    }
  }, [pid]);

  useEffect(() => {
    void caricaPromemoria();
  }, [caricaPromemoria]);

  // Chiude la finestra se il promemoria viene eliminato altrove
  useEffect(() => {
    if (!pid || !inTauri) return;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("promemoria:salvato", async () => {
        if ((window as any).eliminatoDaMe) return;
        try {
          const rec = await api.recordGet("promemoria", pid);
          if (!rec || rec.deleted) {
            const { dialog } = await import("../../ui/dialog/store");
            await dialog.alert(
              "Promemoria eliminato",
              "Questo promemoria è stato eliminato da un'altra postazione. Questa finestra verrà chiusa.",
              "warning"
            );
            chiudiFinestra();
          } else {
            await caricaPromemoria();
          }
        } catch {}
      }).then((fn) => {
        unsubRef.current = fn;
      });
    });
    return () => {
      unsubRef.current?.();
    };
  }, [pid, caricaPromemoria]);

  return (
    <Box style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--surface)" }}>
      <Group p="md" gap="sm" wrap="nowrap" style={{ borderBottom: "1px solid var(--border)", flex: "0 0 auto" }}>
        <ThemeIcon size={38} radius="md" variant="light" color="accent">
          {isEdit ? <IconPencil size={20} /> : <IconBellPlus size={20} />}
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text fw={700}>{isEdit ? "Modifica promemoria" : "Nuovo promemoria"}</Text>
          <Text size="xs" c="dimmed">
            Condiviso con il team
          </Text>
        </Box>
      </Group>
      <Box className="pt-window-form" style={{ padding: 16 }}>
        {errore ? (
          <Text c="dimmed" size="sm" ta="center" py="xl">
            Promemoria non trovato (forse è stato eliminato).
          </Text>
        ) : target === null ? (
          <Group justify="center" py="xl">
            <Loader size="sm" color="accent" />
          </Group>
        ) : (
          <PromemoriaForm
            target={target}
            identity={identity}
            onClose={() => void chiudiFinestra()}
            onSaved={async () => {
              unsubRef.current?.();
              await chiudiFinestra();
            }}
            dentroFinestra={true}
          />
        )}
      </Box>
    </Box>
  );
}
