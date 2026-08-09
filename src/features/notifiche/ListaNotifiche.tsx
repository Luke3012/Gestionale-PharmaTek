// Lista notifiche riusabile (FASE 6D): pop-over campanella + finestra «Notifiche».
// Modello stile smartphone:
//  • **click** su una notifica = leggerla (esce dal badge) e aprire ciò a cui punta;
//    la riga RESTA in lista, in stile «letta» (attenuata);
//  • **✗** = scartarla, con una piccola animazione di scorrimento (swipe);
//  • **Cancella tutte** = scarta tutte le visibili (stesso effetto, in blocco).
// Layout riga a **griglia** (icona · testo · ✗): la ✗ è SEMPRE visibile, niente
// scroll orizzontale (il testo va a capo dentro la colonna centrale).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Box, Button, Group, ScrollArea, Stack, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { IconMessagePlus, IconSparkles, IconTrash, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAnimazioniRidotte } from "../../ui/motion";
import { type Identity } from "../../lib/tauri";
import { apriFinestraOrdine } from "../giornaliero/apriFinestra";
import { apriFinestraPagamento } from "../contabilita/apriFinestraPagamento";
import { apriRiepilogo, type TipoRiepilogo } from "../../shell/apriRiepilogo";
import { apriFinestraPromemoria } from "../promemoria/apriFinestraPromemoria";
import { ComposerMessaggio, type RispostaA } from "./ComposerMessaggio";
import { COLORE_URGENZA, TIPO_NOTIFICA, type CollegamentoNotifica, type Notifica } from "./notifiche";
import { type NotificheState } from "./useNotifiche";
import { VirtualStack } from "../../ui/VirtualStack";
import { calcolaSogliaVirtualizzazione } from "../../ui/virtualizzazione";
import { apriCentroComunicazioniDaNotifica } from "../comunicazioni/apriComunicazione";
import { vaiAllaPrincipale } from "../../shell/navigazione";
import { deepLinkSuggerimento } from "../suggerimenti/collegamento";

const ALTEZZA_NOTIFICA_STIMATA = 72;
const GAP_NOTIFICHE = 4;
const DURATA_CANCELLA_TUTTE_MS = 220;

function pagamentoIdDaNotifica(n: Notifica): string | undefined {
  if (n.tipo !== "sollecito") return undefined;
  return /^sollecito:([^:]+)/.exec(n.id)?.[1];
}

export function ListaNotifiche({
  state,
  identity,
  onDopoApri,
  altezzaMax = 440,
  riempi = false,
  componiTarget,
}: {
  state: NotificheState;
  identity?: Identity;
  /** Chiamato dopo aver aperto qualcosa (il pop-over si chiude). */
  onDopoApri?: () => void;
  /** Altezza massima della lista scrollabile (modalità pop-over). */
  altezzaMax?: number;
  /** Riempi l'altezza del contenitore (modalità finestra): header fisso + lista che scrolla. */
  riempi?: boolean;
  /** Richiesta esterna di aprire il composer già indirizzato (es. box sincronizzazione).
   *  `nonce` cresce a ogni richiesta per riaprirlo anche sullo stesso destinatario. */
  componiTarget?: { destId: string; destNome: string; nonce: number };
}) {
  const {
    notifiche,
    viste,
    scartate,
    visteComunicazioniLocali,
    scartateComunicazioniLocali,
    caricando,
    segna,
    scarta,
    scartaTutte,
    segnaComunicazioneLocale,
    scartaComunicazioneLocale,
    scartaComunicazioniLocali,
  } = state;
  const ridotte = useAnimazioniRidotte();
  const [cancellaTutteInCorso, setCancellaTutteInCorso] = useState(false);
  const cancellaTutteTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (cancellaTutteTimerRef.current !== null) {
        window.clearTimeout(cancellaTutteTimerRef.current);
      }
    },
    [],
  );
  // Mostriamo tutte tranne le scartate; le lette restano (attenuate).
  const visibili = useMemo(
    () =>
      notifiche.filter(
        (n) =>
          !scartate.has(n.id) &&
          !(
            n.tipo === "comunicazione" &&
            scartateComunicazioniLocali.has(n.id)
          ),
      ),
    [notifiche, scartate, scartateComunicazioniLocali],
  );
  // Quando esce l'ultima riga conserviamo il suo spazio fino alla fine dello
  // swipe. In questo modo né il vuoto né i comandi dell'intestazione entrano
  // mentre la riga è ancora in movimento.
  const [mostraVuoto, setMostraVuoto] = useState(visibili.length === 0);
  useEffect(() => {
    if (visibili.length > 0) setMostraVuoto(false);
  }, [visibili.length]);
  const contenutoAncoraVisibile = visibili.length > 0 || !mostraVuoto;
  const nonLetteVisibili = useMemo(
    () =>
      visibili.filter(
        (n) =>
          !viste.has(n.id) &&
          !(
            n.tipo === "comunicazione" &&
            visteComunicazioniLocali.has(n.id)
          ),
      ).length,
    [visibili, viste, visteComunicazioniLocali],
  );

  // Composer 6E: `null` chiuso; `{}` nuovo messaggio; `{ rispostaA }` risposta; `{ destId }`
  // nuovo messaggio già indirizzato (dal box sincronizzazione, FASE 7C).
  const [compose, setCompose] = useState<{ rispostaA?: RispostaA; destId?: string; destNome?: string } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [altezzaComposer, setAltezzaComposer] = useState(0);

  useLayoutEffect(() => {
    if (riempi || !compose) return;
    const composer = composerRef.current;
    if (!composer) return;

    const misura = () => {
      // offsetHeight non risente della trasformazione `pop` del dropdown.
      const prossima = composer.offsetHeight;
      setAltezzaComposer((corrente) => corrente === prossima ? corrente : prossima);
    };

    misura();
    const observer = new ResizeObserver(misura);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [compose, riempi]);

  // Richiesta esterna «scrivi a questa persona»: apre il composer indirizzato.
  useEffect(() => {
    if (componiTarget) setCompose({ destId: componiTarget.destId, destNome: componiTarget.destNome });
  }, [componiTarget]);

  function apri(c: CollegamentoNotifica | null, n: Notifica) {
    if (!c) return;
    if (c.tipo === "ordine") {
      const pagamentoId = pagamentoIdDaNotifica(n);
      if (pagamentoId) {
        void apriFinestraPagamento(pagamentoId, identity);
      } else {
        void apriFinestraOrdine(c.id, c.nome, identity);
      }
    }
    else void apriRiepilogo(c.tipo as TipoRiepilogo, c.id, c.nome, identity);
  }

  function onRiga(n: Notifica) {
    if (n.tipo === "comunicazione" && n.comunicazioneId) {
      // Gli errori di invio sono personali e temporanei: non creiamo
      // `notifica_letta` condivise che finirebbero in sync o nei backup.
      segnaComunicazioneLocale(n.id);
      void apriCentroComunicazioniDaNotifica(n.comunicazioneId);
      onDopoApri?.();
    } else if (n.tipo === "messaggio") {
      void segna(n.id); // leggere ≠ cancellare: resta in lista
      // Click su un messaggio = rispondi (il pop-over resta aperto).
      setCompose({
        rispostaA: { mittenteId: n.mittenteId ?? "", mittenteNome: n.mittenteNome ?? "", parent: n.id },
      });
    } else if (n.promemoriaId) {
      void segna(n.id);
      // Dalle notifiche il promemoria si apre SEMPRE in finestra separata (scelta utente).
      void apriFinestraPromemoria(identity, undefined, n.promemoriaId);
      onDopoApri?.();
    } else if (n.suggerimento) {
      void segna(n.id);
      void vaiAllaPrincipale(deepLinkSuggerimento(n.suggerimento));
      onDopoApri?.();
    } else if (n.collegato) {
      void segna(n.id);
      apri(n.collegato, n);
      onDopoApri?.();
    } else {
      void segna(n.id);
    }
  }

  const renderRiga = (n: Notifica, virtuale = false) => (
    <motion.div
      key={virtuale ? undefined : n.id}
      // Questo involucro resta fermo sull'asse orizzontale e anima soltanto lo
      // spazio occupato. Lo swipe vive nel figlio, così non può ampliare
      // temporaneamente il viewport e spostare la schermata dietro al popover.
      initial={false}
      animate={
        cancellaTutteInCorso
          ? { height: 0, marginBottom: 0 }
          : { height: "auto", marginBottom: 4 }
      }
      exit={
        ridotte || cancellaTutteInCorso
          ? {
              height: 0,
              marginBottom: 0,
              transition: { duration: 0 },
            }
          : {
              height: 0,
              marginBottom: 0,
              transition: {
                // Prima la riga esce lateralmente, poi il solo involucro si
                // chiude: il contenuto non viene mai scalato o deformato.
                height: { duration: 0.2, delay: 0.12, ease: [0.22, 1, 0.36, 1] },
                marginBottom: { duration: 0.2, delay: 0.12, ease: [0.22, 1, 0.36, 1] },
              },
            }
      }
      transition={{
        duration: ridotte ? 0 : cancellaTutteInCorso ? 0.22 : 0.2,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={{ overflow: "hidden", width: "100%" }}
    >
      <motion.div
        initial={virtuale || ridotte ? false : { opacity: 0, y: 6 }}
        animate={
          cancellaTutteInCorso
            ? {
                opacity: 0,
                y: 0,
                clipPath: "inset(0% 0% 0% 100%)",
              }
            : {
                opacity: 1,
                y: 0,
                clipPath: "inset(0% 0% 0% 0%)",
              }
        }
        exit={
          ridotte || cancellaTutteInCorso
            ? { opacity: 0, transition: { duration: 0 } }
            : {
                opacity: 0,
                // La maschera si chiude da sinistra verso destra e replica lo
                // swipe senza spostare alcun box fuori dal pannello. WebView2
                // non può quindi estendere l'area orizzontale della pagina.
                clipPath: "inset(0% 0% 0% 100%)",
                transition: {
                  opacity: { duration: 0.16, ease: "easeOut" },
                  clipPath: { duration: 0.2, ease: "easeOut" },
                },
              }
        }
        transition={{
          duration: ridotte ? 0 : cancellaTutteInCorso ? 0.18 : 0.2,
          ease: "easeOut",
        }}
        style={{ width: "100%" }}
      >
        <RigaNotifica
          n={n}
          letta={
            viste.has(n.id) ||
            (n.tipo === "comunicazione" &&
              visteComunicazioniLocali.has(n.id))
          }
          onClick={() => onRiga(n)}
          onScarta={() => {
            if (n.tipo === "comunicazione") {
              scartaComunicazioneLocale(n.id);
            } else {
              void scarta(n.id);
            }
          }}
        />
      </motion.div>
    </motion.div>
  );

  const righeComplete = () => (
    <Stack gap={0} p={8} style={{ overflowX: "hidden" }}>
      <AnimatePresence
        initial={false}
        onExitComplete={() => {
          if (visibili.length === 0) setMostraVuoto(true);
        }}
      >
        {visibili.map((n) => renderRiga(n))}
      </AnimatePresence>
      {mostraVuoto && visibili.length === 0 && (
        <Vuoto caricando={caricando} />
      )}
    </Stack>
  );
  const altezzaLista = riempi
    ? altezzaMax
    : `max(120px, min(${altezzaMax}px, calc(100dvh - 116px - ${altezzaComposer}px)))`;
  const virtualizza =
    visibili.length >
    calcolaSogliaVirtualizzazione(
      altezzaMax,
      ALTEZZA_NOTIFICA_STIMATA,
      GAP_NOTIFICHE,
    );

  return (
    <Box
      style={
        riempi
          ? { width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }
          : { width: "100%", overflow: "hidden" }
      }
    >
      <Group justify="space-between" px="sm" py={8} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={700} size="sm">
              Notifiche
            </Text>
            <Box
              aria-hidden={nonLetteVisibili === 0}
              style={{
                background: "var(--mantine-color-red-6)",
                color: "#fff",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                minWidth: 18,
                padding: "2px 6px",
                textAlign: "center",
                visibility: nonLetteVisibili > 0 ? "visible" : "hidden",
              }}
            >
              {nonLetteVisibili || 0}
            </Box>
          </Group>
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Tooltip label="Invia messaggio" withArrow position="bottom">
              <ActionIcon
                variant="subtle"
                color="grape"
                size="sm"
                onClick={() => setCompose((c) => (c && !c.rispostaA ? null : {}))}
                aria-label="Invia messaggio"
              >
                <IconMessagePlus size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<IconTrash size={14} />}
              disabled={cancellaTutteInCorso || visibili.length === 0}
              aria-hidden={!contenutoAncoraVisibile}
              tabIndex={contenutoAncoraVisibile ? 0 : -1}
              style={{
                display: contenutoAncoraVisibile ? undefined : "none",
                pointerEvents: contenutoAncoraVisibile ? "auto" : "none",
                visibility: contenutoAncoraVisibile ? "visible" : "hidden",
              }}
              onClick={() => {
                const idsComunicazioni = visibili
                  .filter((n) => n.tipo === "comunicazione")
                  .map((n) => n.id);
                const idsCondivisibili = visibili
                  .filter((n) => n.tipo !== "comunicazione")
                  .map((n) => n.id);
                setCancellaTutteInCorso(true);
                cancellaTutteTimerRef.current = window.setTimeout(() => {
                  // Da una lista virtualizzata a zero non resta montato un
                  // AnimatePresence che possa segnalare il completamento.
                  setMostraVuoto(true);
                  scartaComunicazioniLocali(idsComunicazioni);
                  void scartaTutte(idsCondivisibili);
                  // Gli aggiornamenti sopra sono ottimistici e sincroni: al frame
                  // successivo le righe sono già uscite anche dal layout virtuale.
                  window.requestAnimationFrame(() =>
                    setCancellaTutteInCorso(false),
                  );
                  cancellaTutteTimerRef.current = null;
                }, ridotte ? 0 : DURATA_CANCELLA_TUTTE_MS);
              }}
            >
              Cancella tutte
            </Button>
          </Group>
      </Group>

      <AnimatePresence
        initial={false}
        onExitComplete={() => setAltezzaComposer(0)}
      >
        {compose && (
          <motion.div
            ref={composerRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: "hidden", flexShrink: 0 }}
            >
              <Box px="sm" py={8} style={{ borderBottom: "1px solid var(--border)" }}>
                <ComposerMessaggio
                  identity={identity}
                  rispostaA={compose.rispostaA}
                  destinatarioIniziale={compose.destId}
                  onInviato={() => setCompose(null)}
                  onAnnulla={() => setCompose(null)}
                />
              </Box>
            </motion.div>
          )}
      </AnimatePresence>

      {virtualizza ? (
        <VirtualStack
          items={visibili}
          getKey={(n) => n.id}
          fill={riempi}
          maxHeight={altezzaLista}
          gap={GAP_NOTIFICHE}
          padding={8}
          estimateHeight={ALTEZZA_NOTIFICA_STIMATA}
          overscan={3}
          renderItem={(n) => renderRiga(n, true)}
        />
      ) : riempi ? (
        <ScrollArea style={{ flex: 1, minHeight: 0 }} type="scroll" scrollbars="y" styles={{ viewport: { overflowX: "hidden" } }}>
          {righeComplete()}
        </ScrollArea>
      ) : (
        <ScrollArea.Autosize
          mah={altezzaLista}
          type="scroll"
          scrollbars="y"
          styles={{ viewport: { overflowX: "hidden" } }}
        >
          {righeComplete()}
        </ScrollArea.Autosize>
      )}
    </Box>
  );
}

function RigaNotifica({
  n,
  letta,
  onClick,
  onScarta,
}: {
  n: Notifica;
  letta: boolean;
  onClick: () => void;
  onScarta: () => void;
}) {
  const tipo = TIPO_NOTIFICA[n.tipo];
  const colore = COLORE_URGENZA[n.urgenza];
  return (
    <Box
      onClick={onClick}
      className="pt-pagamento-row"
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "start",
        columnGap: 10,
        cursor: "pointer",
        borderRadius: 8,
        padding: "8px 10px",
        minWidth: 0,
        overflow: "hidden",
        borderLeft: `3px solid var(--mantine-color-${letta ? "gray" : colore}-${letta ? 3 : 6})`,
        background: letta ? "transparent" : "var(--mantine-color-gray-0)",
        opacity: letta ? 0.65 : 1,
      }}
    >
      <ThemeIcon variant="light" color={letta ? "gray" : tipo.color} radius="md" size="md">
        <tipo.Ico size={15} />
      </ThemeIcon>
      <Box style={{ minWidth: 0 }}>
        <Text
          fw={letta ? 500 : 700}
          size="sm"
          style={{
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            lineHeight: 1.25,
          }}
        >
          {n.titolo}
        </Text>
        {n.dettaglio && (
          <Text
            size="xs"
            c="dimmed"
            style={{
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              lineHeight: 1.25,
            }}
          >
            {n.dettaglio}
          </Text>
        )}
      </Box>
      <Tooltip label="Cancella" withArrow position="left">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onScarta();
          }}
          aria-label="Cancella notifica"
          style={{ alignSelf: "center" }}
        >
          <IconX size={15} />
        </ActionIcon>
      </Tooltip>
    </Box>
  );
}

function Vuoto({ caricando }: { caricando: boolean }) {
  return (
    <Stack align="center" gap={6} py="xl" px="md">
      <ThemeIcon variant="light" color={caricando ? "gray" : "green"} radius="xl" size={44}>
        <IconSparkles size={22} />
      </ThemeIcon>
      <Text size="sm" c="dimmed" ta="center">
        {caricando ? "Carico le notifiche…" : "Nessuna notifica. Sei in pari! ✨"}
      </Text>
    </Stack>
  );
}
