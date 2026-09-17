import { Box, Button, Group } from "@mantine/core";
import { IconArrowLeft, IconEdit, IconSend } from "@tabler/icons-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  type ConfigurazioneDocumenti,
  type Preventivo,
} from "../../lib/tauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { portaFinestraInPrimoPiano } from "../../lib/finestreTauri";
import { NuovoPreventivoModal } from "./NuovoPreventivoModal";
import { PreventivoEditorModal } from "./PreventivoEditorModal";
import type { BozzaPreventivoDaZero } from "./bozzaPreventivo";
import {
  EVENTO_PREVENTIVO_BOZZA_CONSEGNA,
  EVENTO_PREVENTIVO_BOZZA_MONTATA,
  EVENTO_PREVENTIVO_BOZZA_PRONTA,
  type PreventivoBozzaConsegna,
} from "./apriFinestraPreventivo";
import { DocumentoPreviewModal } from "./DocumentoPreviewModal";
import {
  creaDocumentoPreventivo,
  type DocumentoA4,
} from "./rendererDocumenti";
import { avviaInvioRapidoPreventivo } from "./invioRapidoPreventivo";
import { PremiumAction } from "../../premium/PremiumAction";
import { confermaInvioManualeDopoEsportazione } from "./invioManualePreventivo";

export function PreventivoWindow() {
  const params = new URLSearchParams(window.location.search);
  const parametro = params.get("preventivo");
  const handoff = params.get("handoff");
  const numero = params.get("numero") ?? undefined;
  const soloAnteprima = params.get("vista") === "anteprima";
  const ritorno = params.get("ritorno");
  const ritornoLabel = params.get("ritornoLabel");
  const [ordineId, setOrdineId] = useState<string | null>(
    parametro && parametro !== "draft" && parametro !== "new"
      ? parametro
      : null,
  );
  const [nuovoAperto, setNuovoAperto] = useState(parametro === "new");
  const [editorAperto, setEditorAperto] = useState(
    parametro !== "new" && parametro !== "draft" && !soloAnteprima,
  );
  const [anteprimaSoloAperta, setAnteprimaSoloAperta] = useState(soloAnteprima);
  const [bozzaEditor, setBozzaEditor] =
    useState<BozzaPreventivoDaZero | null>(null);
  const [disponibili, setDisponibili] = useState<Preventivo[]>([]);
  const [config, setConfig] = useState<ConfigurazioneDocumenti | null>(null);
  const [documento, setDocumento] = useState<DocumentoA4 | null>(null);
  const [preventivoDocumento, setPreventivoDocumento] =
    useState<Preventivo | null>(null);
  const [inviando, setInviando] = useState(false);
  const documentoRef = useRef<DocumentoA4 | null>(null);
  useRicordaGeometria("preventivo");

  const chiudi = useCallback(async () => {
    // Non smonta prima il contenuto: se Windows impiega qualche istante a
    // distruggere la Webview, l'utente continua a vedere la schermata corrente
    // invece di un guscio bianco. `destroy` è appropriato perché ogni eventuale
    // conferma sulle modifiche è già stata gestita dall'editor.
    documentoRef.current = null;
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const finestra = getCurrentWebviewWindow();
    try {
      await finestra.destroy();
    } catch {
      await finestra.close();
    }
  }, []);

  const tornaAllOrdine = useCallback(async () => {
    if (!ritornoLabel) {
      await chiudi();
      return;
    }
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const origine = await WebviewWindow.getByLabel(ritornoLabel);
      if (origine) await portaFinestraInPrimoPiano(origine);
    } finally {
      await chiudi();
    }
  }, [chiudi, ritornoLabel]);

  const tornaAllaModifica = useCallback(() => {
    documentoRef.current = null;
    setDocumento(null);
    setAnteprimaSoloAperta(false);
    setEditorAperto(true);
  }, []);

  useEffect(
    () => () => {
      documentoRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!nuovoAperto) return;
    let attivo = true;
    void Promise.all([
      api.preventivoOrdiniDisponibili(),
      api.configurazioneDocumentiGet(),
    ])
      .then(([ordini, configurazione]) => {
        if (!attivo) return;
        setDisponibili(ordini);
        setConfig(configurazione);
      })
      .catch(() => {});
    return () => {
      attivo = false;
    };
  }, [nuovoAperto]);

  useEffect(() => {
    if (!handoff) return;
    let attivo = true;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(async ({ emit, listen }) => {
        off = await listen<PreventivoBozzaConsegna>(
          EVENTO_PREVENTIVO_BOZZA_CONSEGNA,
          ({ payload }) => {
            if (!attivo || payload?.token !== handoff) return;
            setOrdineId(null);
            setBozzaEditor(payload.bozza);
            setEditorAperto(true);
          },
        );
        if (!attivo) {
          off();
          off = undefined;
          return;
        }
        await emit(EVENTO_PREVENTIVO_BOZZA_PRONTA, { token: handoff });
      })
      .catch(() => void chiudi());
    return () => {
      attivo = false;
      off?.();
    };
  }, [chiudi, handoff]);

  // Conferma al chiamante soltanto dopo il commit React che contiene davvero
  // l'editor e la bozza. La finestra resta nascosta fino a questo momento, quindi
  // non espone più il guscio grigio durante il passaggio dalla view Preventivi.
  useLayoutEffect(() => {
    if (!handoff || !bozzaEditor || !editorAperto) return;
    void import("@tauri-apps/api/event")
      .then(({ emit }) => emit(EVENTO_PREVENTIVO_BOZZA_MONTATA, { token: handoff }))
      .catch(() => {});
  }, [bozzaEditor, editorAperto, handoff]);

  useEffect(() => {
    if (!editorAperto || nuovoAperto || soloAnteprima || config) return;
    let attivo = true;
    void api
      .configurazioneDocumentiGet()
      .then((configurazione) => {
        if (attivo) setConfig(configurazione);
      })
      .catch(() => {});
    return () => {
      attivo = false;
    };
  }, [config, editorAperto, nuovoAperto, soloAnteprima]);

  useEffect(() => {
    if (!soloAnteprima || !ordineId) return;
    let attivo = true;
    void Promise.all([
      api.preventivoGet(ordineId),
      api.configurazioneDocumentiGet(),
    ])
      .then(([preventivo, configurazione]) => {
        if (!attivo) return;
        setConfig(configurazione);
        const generato = creaDocumentoPreventivo(preventivo, configurazione);
        setPreventivoDocumento(preventivo);
        documentoRef.current = generato;
        setDocumento(generato);
      })
      .catch(() => void chiudi());
    return () => {
      attivo = false;
    };
  }, [chiudi, ordineId, soloAnteprima]);

  const mostraDocumento = useCallback(
    async (salvato: Preventivo) => {
      try {
        const configurazione =
          config ??
          (await api.configurazioneDocumentiGet().catch(() => null));
        if (configurazione) setConfig(configurazione);
        const generato = creaDocumentoPreventivo(
          salvato,
          configurazione ?? undefined,
        );
        setPreventivoDocumento(salvato);
        documentoRef.current = generato;
        setDocumento(generato);
        setEditorAperto(false);
      } catch {
        // L'editor resta visibile e utilizzabile: non lasciare una finestra vuota.
      }
    },
    [config],
  );

  const invia = useCallback(async () => {
    if (!preventivoDocumento || inviando) return;
    setInviando(true);
    try {
      await avviaInvioRapidoPreventivo(preventivoDocumento);
    } finally {
      setInviando(false);
    }
  }, [inviando, preventivoDocumento]);

  return (
    <Box
      style={{
        width: "100vw",
        height: "100vh",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      <NuovoPreventivoModal
        opened={nuovoAperto}
        disponibili={disponibili}
        dentroFinestra
        onClose={() => void chiudi()}
        onOrdinePreparato={(id) => {
          setNuovoAperto(false);
          setOrdineId(id);
          setEditorAperto(true);
        }}
        onBozzaPreparata={(bozza) => {
          setNuovoAperto(false);
          setBozzaEditor(bozza);
          setEditorAperto(true);
        }}
      />
      <PreventivoEditorModal
        ordineId={ordineId}
        numero={numero}
        bozzaIniziale={bozzaEditor}
        opened={editorAperto && (!!ordineId || !!bozzaEditor)}
        dentroFinestra
        onClose={() => void chiudi()}
        onSaved={(salvato) => void mostraDocumento(salvato)}
      />
      <DocumentoPreviewModal
        opened={anteprimaSoloAperta || !!documento}
        documento={documento}
        dentroFinestra
        azioniPremium
        azioniAffollate
        onFileEsportato={async () => {
          if (!preventivoDocumento) return;
          const aggiornato = await confermaInvioManualeDopoEsportazione(
            preventivoDocumento,
          );
          if (aggiornato) setPreventivoDocumento(aggiornato);
        }}
        onClose={() => void chiudi()}
        azioniExtra={
          <Group gap="sm">
            {ritorno === "ordine" && (
              <Button
                variant="default"
                leftSection={<IconArrowLeft size={16} />}
                onClick={() => void tornaAllOrdine()}
              >
                Torna all’ordine
              </Button>
            )}
            {soloAnteprima && ritorno !== "ordine" && anteprimaSoloAperta && (
              <Button
                variant="default"
                leftSection={<IconEdit size={16} />}
                onClick={tornaAllaModifica}
              >
                Modifica preventivo
              </Button>
            )}
            {documento && !anteprimaSoloAperta && ritorno !== "ordine" && (
              <Button
                variant="default"
                leftSection={<IconEdit size={16} />}
                onClick={tornaAllaModifica}
              >
                Modifica preventivo
              </Button>
            )}
            {preventivoDocumento && (
              <PremiumAction
                buttonVariant="default"
                leftSection={<IconSend size={16} />}
                title="Invia preventivo"
                message="Invia il preventivo direttamente al cliente via email o messaggio. Funzionalità disponibile con Premium."
                lockedPresentation="modal"
                loading={inviando}
                disabled={!!documento?.overflow.length}
                onAction={() => void invia()}
              >
                Invia preventivo
              </PremiumAction>
            )}
          </Group>
        }
      />
    </Box>
  );
}
