// Contenitore pagina: header (titolo + azioni) + corpo, con entrata animata.
//
// **Fetch-then-render universale**: la pagina resta invisibile finché i caricamenti
// dati delle viste interne non sono finiti, poi fa il fade-in con i contenuti già
// pronti (niente "Nessun ordine"/campi vuoti che si vedono prima dei dati). Le viste
// segnalano il proprio stato con `usePaginaPronta(caricamento)`.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Box, Center, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { useIntersection } from "@mantine/hooks";
import { IconTools, type Icon } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { dur, easeOut, fadeSlide, useAnimazioniRidotte } from "../ui/motion";

/** Funzione fornita dalla Pagina: registra un caricamento in corso e restituisce la
 * callback da chiamare quando è finito. */
const RegistraCaricamento = createContext<null | (() => () => void)>(null);

/** Istante (ms, `Date.now`) in cui la Pagina si è RIVELATA (dati pronti + reveal), oppure
 * 0 se non ancora; `null` fuori da una Pagina. Lo consumano i componenti con entrata
 * animata (es. `Tabella`) per partire al reveal — non mentre la pagina è ancora nascosta —
 * e per NON animarsi se compaiono dopo (scrollando). */
export const RivelazionePagina = createContext<number | null>(null);

/** Le viste con caricamento dati lo dichiarano: la pagina aspetta che tutti i
 * caricamenti registrati finiscano prima di mostrarsi (al primo reveal). */
export function usePaginaPronta(caricamento: boolean) {
  const registra = useContext(RegistraCaricamento);
  const fineRef = useRef<null | (() => void)>(null);
  useEffect(() => {
    if (!registra) return;
    if (caricamento && !fineRef.current) {
      fineRef.current = registra();
    } else if (!caricamento && fineRef.current) {
      fineRef.current();
      fineRef.current = null;
    }
    return () => {
      if (fineRef.current) {
        fineRef.current();
        fineRef.current = null;
      }
    };
  }, [caricamento, registra]);
}

export function Pagina({
  titolo,
  azioni,
  children,
  differita = false,
  caricamento,
  azioniSticky = false,
  spazioDopoTitolo,
}: {
  titolo: string;
  azioni?: ReactNode;
  children?: ReactNode;
  /** Stato di caricamento della vista che possiede la Pagina. Passarlo direttamente
   *  evita che il corpo possa rivelarsi prima del primo snapshot dei dati. */
  caricamento?: boolean;
  /** Spazio locale tra la riga titolo/azioni e il contenuto della pagina. */
  spazioDopoTitolo?: number;
  /** Le `azioni` restano in alto a destra (accanto al titolo) ma — scorrendo — si
   *  «sganciano» e seguono in alto: solo i bottoni, senza barra, in modo non invasivo.
   *  Il titolo scorre via normalmente. (Overlay sticky ad altezza 0, contenuto a destra.) */
  azioniSticky?: boolean;
  /** Pagine pesanti (tabelle lunghe): il frame (titolo) entra subito con la
   *  transizione, poi — a animazione conclusa — si montano i contenuti e parte il loro
   *  caricamento; il corpo appare in dissolvenza quando i dati sono pronti. Così la
   *  logica pesante non «sfreggia» l'animazione di ingresso. */
  differita?: boolean;
}) {
  const pendingRef = useRef(0);
  const prontoRef = useRef(false);
  const [pronto, setPronto] = useState(false);
  // Con «Riduci animazioni» la pagina aspetta comunque i dati (niente flash di vuoto),
  // ma il reveal è istantaneo invece che in dissolvenza.
  const ridotte = useAnimazioniRidotte();

  // Rilevamento «agganciato»: un sentinello in cima si stacca (clip dal contenitore di scroll
  // della Shell) quando si scorre → le azioni sono in volo. Solo allora aggiungiamo lo sfondo
  // opaco (pillolo), così a riposo accanto al titolo restano bottoni nudi. root:null funziona
  // perché l'IntersectionObserver tiene conto del clipping del contenitore intermedio.
  const { ref: sentinelRef, entry: sentinelEntry } = useIntersection({ root: null, threshold: 0 });
  const azioniStuck = azioniSticky && !!sentinelEntry && !sentinelEntry.isIntersecting;
  const haAzioni = Boolean(azioni);
  const [azioniAssestate, setAzioniAssestate] = useState(false);
  useEffect(() => {
    if (!haAzioni || !azioniSticky || azioniStuck) {
      setAzioniAssestate(false);
      return;
    }
    if (ridotte) {
      setAzioniAssestate(true);
      return;
    }
    // Sia al primo ingresso sia tornando dallo sticky, l'azione secondaria entra
    // soltanto dopo che il blocchetto primario ha concluso la transizione.
    setAzioniAssestate(false);
    const timer = window.setTimeout(
      () => setAzioniAssestate(true),
      dur.base * 1000 + 20,
    );
    return () => window.clearTimeout(timer);
  }, [azioniSticky, azioniStuck, haAzioni, ridotte]);

  // Differita: monta il corpo (→ avvio del fetch) solo a transizione finita. Con
  // «Riduci animazioni» (o pagina non differita) il corpo è montato da subito.
  const corpoSubito = !differita || ridotte;
  const [montaCorpo, setMontaCorpo] = useState(corpoSubito);
  useEffect(() => {
    if (montaCorpo) return;
    // Timeout ≈ durata dell'entrata del frame, con un piccolo margine: deterministico
    // (niente dipendenza da onAnimationComplete, che Framer può non emettere se la
    // pagina viene smontata da una navigazione rapida).
    const t = window.setTimeout(() => setMontaCorpo(true), dur.base * 1000 + 40);
    return () => clearTimeout(t);
  }, [montaCorpo]);

  const mostra = useCallback(() => {
    if (!prontoRef.current) {
      prontoRef.current = true;
      setPronto(true);
    }
  }, []);

  // Timestamp del reveal: lo leggono i componenti animati (Tabella) per partire al momento
  // giusto (pagina visibile) e ignorare le tabelle che compaiono dopo, scrollando.
  // useLayoutEffect (non useEffect): così la catena reveal→classe-d'entrata si chiude PRIMA
  // del paint e le righe non vengono disegnate "piene" per un frame al reveal (niente scatto).
  const [rivelatoMs, setRivelatoMs] = useState(0);
  useLayoutEffect(() => {
    if (pronto && rivelatoMs === 0) setRivelatoMs(Date.now());
  }, [pronto, rivelatoMs]);

  const registra = useCallback(() => {
    pendingRef.current += 1;
    let chiuso = false;
    return () => {
      if (chiuso) return;
      chiuso = true;
      pendingRef.current -= 1;
      // Quando l'ultimo caricamento finisce, lascia assestare il layout un frame.
      // Al frame va ricontrollato il contatore: in StrictMode la pulizia simulata
      // dell'effect può arrivare a zero e registrare subito dopo un nuovo caricamento.
      if (pendingRef.current <= 0) {
        requestAnimationFrame(() => {
          if (pendingRef.current <= 0) mostra();
        });
      }
    };
  }, [mostra]);

  useEffect(() => {
    // Nelle pagine differite il reveal del corpo non deve poter scattare prima che il
    // corpo (e quindi le sue registrazioni di caricamento) sia montato: altrimenti
    // `pendingRef` è 0 e si rivelerebbe il vuoto.
    if (!montaCorpo || caricamento === true) return;
    // Se nessuna vista ha registrato un caricamento (pagina statica), mostra subito
    // al frame successivo (le viste si registrano nei loro effect, eseguiti prima).
    const r = requestAnimationFrame(() => {
      if (pendingRef.current === 0) mostra();
    });
    // Rete di sicurezza per le sole pagine che non hanno caricamenti registrati.
    // Non deve mai scavalcare una vista ancora in fetch: su archivi grandi questo
    // mostrerebbe per un attimo il corpo vuoto prima dell'arrivo dei dati reali.
    const t = window.setTimeout(() => {
      if (pendingRef.current === 0) mostra();
    }, 2500);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(t);
    };
  }, [caricamento, mostra, montaCorpo]);

  // Frame (titolo): nelle pagine differite entra SUBITO (è la transizione che piace);
  // nelle altre resta legato al reveal a dati pronti, come prima.
  const frameAnim = differita && !ridotte ? "animate" : pronto ? "animate" : "initial";

  return (
    <RegistraCaricamento.Provider value={registra}>
     <RivelazionePagina.Provider value={rivelatoMs}>
      <motion.div
        variants={fadeSlide}
        initial="initial"
        animate={frameAnim}
        transition={ridotte ? { duration: 0 } : undefined}
        style={{ padding: 20, minHeight: "100%", display: "flex", flexDirection: "column", position: "relative" }}
      >
        {/* Sentinello per capire quando le azioni si «agganciano» (scorrendo). */}
        {azioni && azioniSticky && <Box ref={sentinelRef} style={{ height: 1, marginBottom: -1 }} aria-hidden />}
        {/* Azioni «sticky»: overlay ad altezza 0 (non occupa spazio in flusso). A riposo i
            bottoni sono NUDI in linea col titolo; scorrendo l'overlay resta in alto (il titolo
            va via) e diventa una STRISCIA bianca a TUTTA LARGHEZZA (margini negativi per coprire
            il padding di pagina) con ombra/bordo sotto → copre la riga in modo pulito, senza
            sovrapposizioni «a bolla». pointer-events:none ovunque tranne i bottoni. */}
        {azioni && azioniSticky && (
          <Box style={{ position: "sticky", top: 12, zIndex: 5, height: 0 }}>
            <Box
              style={{
                display: "flex",
                justifyContent: "flex-end",
                pointerEvents: "none",
              }}
            >
              <Box
                className={`pt-pagina-azioni ${azioniStuck ? "pt-pagina-azioni-sticky" : ""} ${azioniAssestate ? "pt-pagina-azioni-assestate" : ""}`}
                style={{
                  pointerEvents: "none",
                  // La cornice di layout non cambia misura entrando/uscendo dallo sticky:
                  // così il bordo destro della pillola resta fermo e non "scappa" lateralmente.
                  width: "calc(100% - 220px)",
                  maxWidth: "calc(100% - 220px)",
                  minWidth: 0,
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <Box
                  className="pt-pagina-azioni-pill"
                  style={{
                    pointerEvents: "auto",
                    width: "100%",
                    maxWidth: "100%",
                    minWidth: 0,
                    boxSizing: "content-box",
                    paddingLeft: azioniStuck ? 16 : 0,
                    paddingRight: azioniStuck ? 16 : 0,
                    paddingTop: azioniStuck ? 6 : 0,
                    paddingBottom: azioniStuck ? 6 : 0,
                    background: azioniStuck ? "var(--surface)" : "transparent",
                    border: azioniStuck ? "1px solid var(--mantine-color-default-border)" : "1px solid transparent",
                    borderRadius: azioniStuck ? "100px" : "0",
                    boxShadow: azioniStuck ? "var(--mantine-shadow-md)" : "none",
                    transition: "background-color .15s ease, box-shadow .15s ease, border-color .15s ease, padding .15s ease, border-radius .15s ease",
                  }}
                >
                  {azioni}
                </Box>
              </Box>
            </Box>
          </Box>
        )}
        <Group
          justify="space-between"
          align="center"
          mb={spazioDopoTitolo ?? "md"}
          wrap="nowrap"
        >
          <Text component="h1" fw={700} fz={24} lh={1.2} truncate>
            {titolo}
          </Text>
          {azioni && !azioniSticky && azioni}
        </Group>
        <Box style={{ flex: 1, minHeight: 0 }}>
          {differita ? (
            // Corpo: montato a transizione finita, in dissolvenza quando i dati sono
            // pronti (passaggio caricato↔non caricato morbido). `min-height` riservato
            // così il frame non «balla» mentre il corpo è ancora vuoto.
            <motion.div
              initial={false}
              animate={{ opacity: pronto ? 1 : 0 }}
              transition={ridotte ? { duration: 0 } : { duration: dur.base, ease: easeOut }}
              style={{ height: "100%", minHeight: pronto ? undefined : 240 }}
            >
              {montaCorpo ? children : null}
            </motion.div>
          ) : (
            children
          )}
        </Box>
      </motion.div>
     </RivelazionePagina.Provider>
    </RegistraCaricamento.Provider>
  );
}

export function Segnaposto({
  titolo,
  fase,
  descrizione,
  Ico = IconTools,
}: {
  titolo: string;
  fase: string;
  descrizione: string;
  Ico?: Icon;
}) {
  return (
    <Pagina titolo={titolo}>
      <Center style={{ height: "100%", minHeight: 360 }}>
        <Stack align="center" gap="xs" maw={420} ta="center">
          <ThemeIcon size={56} radius="xl" variant="light" color="gray">
            <Ico size={28} />
          </ThemeIcon>
          <Text fw={600} mt="xs">
            In arrivo nella {fase}
          </Text>
          <Text c="dimmed" size="sm">
            {descrizione}
          </Text>
        </Stack>
      </Center>
    </Pagina>
  );
}
