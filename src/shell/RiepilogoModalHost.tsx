import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, Modal } from "@mantine/core";
import { usePrefs } from "../lib/prefs";
import { inTauri, type Identity, type RecordDto } from "../lib/tauri";
import { collegaDisiscrizioneAsincrona } from "../lib/disiscrizioneAsincrona";
import { useModalSnapshot } from "../ui/useModalSnapshot";
import type { EditorTarget } from "../features/giornaliero/OrdineEditor";
import { apriFinestraOrdine } from "../features/giornaliero/apriFinestra";
import {
  EVENTO_APRI_RIEPILOGO,
  type RiepilogoTarget,
} from "./apriRiepilogo";
import type { DeepLink } from "./navigazione";
import type { ApriOrdineDaRiepilogo } from "./RiepilogoWindow";
import { RiepilogoEditorCliente } from "./RiepilogoEditorCliente";

const RiepilogoContenuto = lazy(() =>
  import("./RiepilogoWindow").then((m) => ({ default: m.RiepilogoContenuto }))
);
const OrdineEditor = lazy(() =>
  import("../features/giornaliero/OrdineEditor").then((m) => ({ default: m.OrdineEditor }))
);

/** Host unico nella finestra principale per richieste provenienti anche da Spotlight/altre webview. */
export function RiepilogoModalHost({
  identity,
  onNaviga,
}: {
  identity: Identity;
  onNaviga: (link: DeepLink) => void;
}) {
  const { ordineFinestra } = usePrefs();
  const [target, setTarget] = useState<RiepilogoTarget | null>(null);
  const [mostrato, clearMostrato] = useModalSnapshot(target);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [clienteDaModificare, setClienteDaModificare] =
    useState<RecordDto | null>(null);
  const clienteInAttesaRef = useRef<RecordDto | null>(null);
  const entitaInAttesaRef = useRef<RiepilogoTarget | null>(null);
  const ordineInAttesaRef = useRef<ApriOrdineDaRiepilogo | null>(null);

  const riceviTarget = useCallback((next: RiepilogoTarget) => {
    if (!next?.id) return;
    // La richiesta locale e l'evento Tauri possono descrivere la stessa apertura:
    // conserva il riferimento corrente e non provoca un secondo render/fetch.
    setTarget((corrente) =>
      corrente?.tipo === next.tipo && corrente.id === next.id && corrente.nome === next.nome
        ? corrente
        : next
    );
  }, []);

  useEffect(() => {
    const locale = (event: Event) => {
      const next = (event as CustomEvent<RiepilogoTarget>).detail;
      if (next) riceviTarget(next);
    };
    window.addEventListener(EVENTO_APRI_RIEPILOGO, locale);

    if (!inTauri) {
      return () => window.removeEventListener(EVENTO_APRI_RIEPILOGO, locale);
    }

    const disiscriviTauri = collegaDisiscrizioneAsincrona(
      import("@tauri-apps/api/event")
      .then(({ listen }) => listen<RiepilogoTarget>(EVENTO_APRI_RIEPILOGO, (event) => {
        if (event.payload) riceviTarget(event.payload);
      })),
    );
    return () => {
      window.removeEventListener(EVENTO_APRI_RIEPILOGO, locale);
      disiscriviTauri();
    };
  }, [riceviTarget]);

  const apriOrdine = async (next: ApriOrdineDaRiepilogo) => {
    const usaFinestra = ordineFinestra === "sempre" || (ordineFinestra === "modifica" && next.ordineId !== null);
    if (
      usaFinestra &&
      (await apriFinestraOrdine(
        next.ordineId,
        next.numero,
        identity,
        undefined,
        next.ordineId ? undefined : { cliente: next.clientePre, medico: next.medicoPre }
      ))
    ) return;
    ordineInAttesaRef.current = next;
    setTarget(null);
  };

  const preparaModificaCliente = (record: RecordDto) => {
    // Il riepilogo modale deve uscire completamente prima che entri l'editor:
    // due focus trap sovrapposti renderebbero ambiguo anche il primo Escape.
    clienteInAttesaRef.current = record;
    setTarget(null);
  };

  const preparaApriEntita = (next: RiepilogoTarget) => {
    // Sostituisce il riepilogo corrente soltanto dopo la sua uscita: nessun
    // focus trap annidato e un singolo Escape agisce sempre sul modale visibile.
    entitaInAttesaRef.current = next;
    setTarget(null);
  };

  const riepilogoChiuso = () => {
    clearMostrato();
    const record = clienteInAttesaRef.current;
    clienteInAttesaRef.current = null;
    const entita = entitaInAttesaRef.current;
    entitaInAttesaRef.current = null;
    const ordine = ordineInAttesaRef.current;
    ordineInAttesaRef.current = null;
    if (record) setClienteDaModificare(record);
    else if (entita) setTarget(entita);
    else if (ordine) {
      setEditor({
        ordineId: ordine.ordineId,
        numero: ordine.numero,
        clientePre: ordine.clientePre,
        medicoPre: ordine.medicoPre,
      });
    }
  };

  return (
    <>
      <Modal
        opened={!!target}
        onClose={() => setTarget(null)}
        closeOnEscape
        closeOnClickOutside
        withCloseButton={false}
        size="min(980px, calc(100vw - 48px))"
        padding={0}
        centered
        title={null}
        transitionProps={{
          transition: "fade",
          duration: 170,
          onExited: riepilogoChiuso,
        }}
        styles={{ body: { overflow: "hidden" }, content: { overflow: "hidden" } }}
      >
        {mostrato && (
          <Suspense fallback={<Box mih={420} bg="var(--bg)" />}>
            <RiepilogoContenuto
              key={`${mostrato.tipo}:${mostrato.id}`}
              target={mostrato}
              identity={identity}
              onClose={() => setTarget(null)}
              primaAzione={() => setTarget(null)}
              onSoggettoEliminato={() => setTarget(null)}
              onApriOrdine={(next) => void apriOrdine(next)}
              onNaviga={onNaviga}
              onApriEntita={preparaApriEntita}
              onModificaCliente={preparaModificaCliente}
            />
          </Suspense>
        )}
      </Modal>

      <Suspense fallback={null}>
        <OrdineEditor
          editor={editor}
          identity={identity}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      </Suspense>

      <RiepilogoEditorCliente record={clienteDaModificare} onClose={() => setClienteDaModificare(null)} />
    </>
  );
}
