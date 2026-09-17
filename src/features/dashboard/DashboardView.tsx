// Dashboard operativa (FASE 6B): card KPI animate + grafici + pannelli «ultimi
// ordini»/«scaduti». I dati vengono dal comando backend `dashboard_stats` (un bundle
// per periodo, in cache). Il **periodo è globale** (selettore accanto al titolo, con
// range personalizzato da/a): tutti i widget si adattano. Click su card/fette/barre/
// punti → pagina filtrata corrispondente. La bacheca promemoria/note arriva con 6C/6D.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Anchor,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Paper,
  Popover,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { AreaChart, BarChart } from "@mantine/charts";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCashBanknote,
  IconChartArcs,
  IconChevronDown,
  IconClipboardList,
  IconHammer,
  IconReceipt2,
  type Icon,
} from "@tabler/icons-react";
import { Pagina, usePaginaPronta } from "../../pages/Pagina";
import { AnimatePresence, motion, Variants } from "framer-motion";
import { UnifiedBootScreen } from "../../ui/Brand";
import { usePrefs, type PeriodoDash } from "../../lib/prefs";
import { api, type DashboardPanels, type DashboardStats, type Identity } from "../../lib/tauri";
import { formattaDataItaliana, isoLocale } from "../../lib/date";
import { intervalloPeriodo, descrizionePeriodo, ETICHETTE_PERIODO } from "./periodo";
import { useAnimazioniRidotte } from "../../ui/motion";
import { CountUp } from "./CountUp";
import { STATI_ORDINE, statoDef } from "../giornaliero/stati";
import { apriFinestraOrdine } from "../giornaliero/apriFinestra";
import { OrdineEditor, type EditorTarget } from "../giornaliero/OrdineEditor";
import { vaiAllaPrincipale, type DeepLink } from "../../shell/navigazione";
import { BachecaPromemoria } from "../promemoria/BachecaPromemoria";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { consumaIntroOverlaySaltata, deveSaltareIntroOverlay } from "./introOverlay";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import { formattaEuro as euro } from "../../lib/money";
import { BadgeStato } from "../../ui/BadgeStato";
import { FiltroIntervalloDate } from "../../ui/FiltroIntervalloDate";

const SuggerimentiPanel = lazy(() =>
  import("../suggerimenti/SuggerimentiPanel").then((module) => ({
    default: module.SuggerimentiPanel,
  })),
);

const EVENTI_RICARICA = [
  "ordine:salvato",
  "pagamento:salvato",
  "spedizione:salvato",
  "distinta:salvato",
  "rimborso:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "conto:salvato",
  "prodotto:salvato",
  "corriere:salvato",
  "provv_pagamento:salvato",
  "parametri_globali:salvato",
  "suggerimento:salvato",
  "snapshot:salvato",
  "pt:comunicazione-stato-locale",
] as const;

const euro0 = (eur: number) =>
  eur.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type PeriodoSel = PeriodoDash | "personalizzato";

let primaVoltaDash = true;

const contenitore: Variants = {
  hidden: {},
  visibile: (firstBoot: boolean) => ({ transition: { staggerChildren: firstBoot ? 0.08 : 0.03, delayChildren: firstBoot ? 0.6 : 0 } }),
};
// Slide+fade (il `y` torna): `firstBoot` (propagato come `custom`) sceglie lo spring —
// morbido al primo avvio, più scattante nelle aperture normali. Il `translateY` rispetta
// «Riduci animazioni» tramite il MotionConfig globale (reducedMotion → niente transform).
// Il lag NON era il transform ma i grafici che si montavano DURANTE l'animazione: ora si
// montano dopo (vedi `pesantiPronti` + `GraficoLazy`).
const elemento: Variants = {
  hidden: { opacity: 0, y: 18 },
  visibile: (firstBoot: boolean) => ({
    opacity: 1,
    y: 0,
    transition: firstBoot
      ? { type: "spring", stiffness: 300, damping: 24 }
      : { type: "spring", stiffness: 360, damping: 28 },
  }),
};

/** Monta un grafico pesante (recharts/SVG) solo quando `pronto`: prima un segnaposto della
 *  stessa altezza (niente salto di layout), poi entra in dissolvenza. Così i grafici si
 *  caricano DOPO l'animazione d'ingresso, senza farla scattare. */
function GraficoLazy({ pronto, h, children }: { pronto: boolean; h: number; children: React.ReactNode }) {
  if (!pronto) return <Box h={h} />;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.div>
  );
}

/** Risolve il periodo selezionato (preset o custom) in `[dal, al]` per il backend. */
function risolvi(
  periodo: PeriodoSel,
  dalC: string,
  alC: string,
  anno = 0,
): { dal: string | null; al: string | null } {
  const limiteDal = anno === 0 ? null : `${anno}-01-01`;
  const limiteAl = anno === 0 ? null : `${anno}-12-31`;
  if (periodo === "personalizzato") {
    const dal = dalC || limiteDal;
    const al = alC || limiteAl;
    return {
      dal: limiteDal && dal && dal < limiteDal ? limiteDal : dal || null,
      al: limiteAl && al && al > limiteAl ? limiteAl : al || null,
    };
  }
  return intervalloPeriodo(periodo, new Date(), anno);
}

/** Etichetta dell'asse mese (`YYYY-MM`) → estremi del mese per il deep-link. */
function meseRange(iso: string): { dal: string; al: string } {
  if (iso.length === 7) {
    const [y, m] = iso.split("-").map(Number);
    const al = isoLocale(new Date(y, m, 0));
    return { dal: `${iso}-01`, al };
  }
  return { dal: iso, al: iso }; // bucket giornaliero
}

/** Stats per il periodo `[dal, al]`, con cache e mantenimento del valore precedente
 *  durante il refetch (niente flash al cambio periodo). */
function useStatsPeriodo(dal: string | null, al: string | null, nonce: number): DashboardStats | null {
  const [cache, setCache] = useState<Record<string, DashboardStats>>({});
  const inflight = useRef<Set<string>>(new Set());
  const key = `${dal ?? ""}|${al ?? ""}`;

  useEffect(() => {
    setCache({});
  }, [nonce]);

  useEffect(() => {
    if (cache[key] || inflight.current.has(key)) return;
    inflight.current.add(key);
    api
      .dashboardStats(dal, al)
      .then((s) => setCache((c) => ({ ...c, [key]: s })))
      .catch(() => {})
      .finally(() => inflight.current.delete(key));
  }, [key, dal, al, cache]);
  const last = useRef<DashboardStats | null>(null);
  if (cache[key]) last.current = cache[key];
  return last.current;
}

/** Pannelli piccoli della dashboard, caricati da un comando già limitato lato backend. */
function useDashboardPanels(nonce: number): DashboardPanels | null {
  const [panels, setPanels] = useState<DashboardPanels | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .dashboardPannelli()
      .then((p) => {
        if (vivo) setPanels(p);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [nonce]);

  return panels;
}

export function DashboardView({
  identity,
  forceIntro = false,
  testoIntro = "Preparo la tua dashboard…",
  saltaIntro = false,
}: {
  identity: Identity;
  forceIntro?: boolean;
  testoIntro?: string | null;
  saltaIntro?: boolean;
}) {
  const { anno, dashboardPeriodo, ordineFinestra } = usePrefs();
  const premium = usePremiumAccess();
  const [periodo, setPeriodo] = useState<PeriodoSel>(dashboardPeriodo);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [dalC, setDalC] = useState("");
  const [alC, setAlC] = useState("");
  const [donut, setDonut] = useState<"stato" | "saldare">("stato");
  const [classifica, setClassifica] = useState<"agenti" | "regioni">("agenti");

  useEffect(() => {
    if (premium.enabled) return;
    // Evita che una fotografia manuale Premium rimanga in memoria e ricompaia
    // dopo una disattivazione/riattivazione senza essere stata ricalcolata.
    void import("../suggerimenti/suggerimenti").then((modulo) =>
      modulo.invalidaControlloManualeSuggerimenti(),
    );
  }, [premium.enabled]);

  const ridotte = useAnimazioniRidotte();
  const primaVoltaRef = useRef(!saltaIntro && !ridotte && (forceIntro || primaVoltaDash));
  const skipIntroRef = useRef(saltaIntro || deveSaltareIntroOverlay());
  const mostraIntroVisiva = testoIntro !== null;
  const [introAttiva, setIntroAttiva] = useState(primaVoltaRef.current && !skipIntroRef.current && mostraIntroVisiva);
  const [splashGone, setSplashGone] = useState(!primaVoltaRef.current || skipIntroRef.current);
  // I grafici pesanti (recharts) si montano solo a animazione d'ingresso conclusa: era il
  // loro montaggio DURANTE l'animazione a farla scattare (vedi GraficoLazy).
  const [pesantiPronti, setPesantiPronti] = useState(false);

  useEffect(() => {
    primaVoltaDash = false;
    consumaIntroOverlaySaltata();
  }, []);

  useEffect(() => {
    if (introAttiva) {
      const t = setTimeout(() => setIntroAttiva(false), 2400);
      return () => clearTimeout(t);
    }
  }, [introAttiva]);

  const [nonce, setNonce] = useState(0); // ricarica i pannelli dopo un salvataggio ordine e in tempo reale

  useRicaricaSuEventi(EVENTI_RICARICA, () => setNonce((n) => n + 1), 180);

  const { dal, al } = risolvi(periodo, dalC, alC, anno);
  const stats = useStatsPeriodo(dal, al, nonce);
  const panels = useDashboardPanels(nonce);

  const ultimi = panels?.ultimiOrdini ?? null;
  const scaduti = panels?.pagamentiScaduti ?? null;

  const caricamento = !stats || ultimi === null || scaduti === null;
  usePaginaPronta(caricamento);

  useEffect(() => {
    if (!primaVoltaRef.current || skipIntroRef.current || splashGone) return;
    if (!caricamento && !introAttiva) setSplashGone(true);
  }, [caricamento, introAttiva, splashGone]);

  // Monta i grafici pesanti dopo l'entrata: attesa ≈ durata dell'animazione (al primo avvio
  // più lunga, ma lì lo splash la copre). Con «Riduci animazioni» subito. One-shot.
  useEffect(() => {
    if (pesantiPronti || caricamento) return;
    const ritardo = ridotte ? 0 : primaVoltaRef.current ? 1000 : 520;
    const t = setTimeout(() => setPesantiPronti(true), ritardo);
    return () => clearTimeout(t);
  }, [caricamento, pesantiPronti, ridotte]);

  // Navigazioni filtrate (il periodo corrente viaggia col deep-link dove ha senso).
  const vai = useCallback(
    (link: DeepLink) => void vaiAllaPrincipale(link),
    [],
  );

  // Apertura ordine come nel Giornaliero: rispetta la preferenza «Apri in finestra
  // separata» (mai/modifica/sempre) e ricade sul **modale** quando non usa la finestra
  // (prima la dashboard apriva SEMPRE una finestra esterna).
  const apriOrdine = async (id: string | null, numero?: string) => {
    const usaFinestra = ordineFinestra === "sempre" || (ordineFinestra === "modifica" && id !== null);
    if (usaFinestra && (await apriFinestraOrdine(id, numero, identity))) return;
    setEditor({ ordineId: id, numero });
  };
  const periodoLink = { dal: dal ?? undefined, al: al ?? undefined };

  const descr = periodo === "personalizzato" ? "periodo scelto" : descrizionePeriodo(periodo, anno);

  const overlayIntroVisibile = mostraIntroVisiva && primaVoltaRef.current && !skipIntroRef.current && !splashGone;

  return (
    <>
      <AnimatePresence>
        {overlayIntroVisibile && (
          <motion.div
            key="intro"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{ position: "fixed", inset: 0, zIndex: 9999 }}
          >
            <UnifiedBootScreen identity={identity} testoSottotitolo={testoIntro} />
          </motion.div>
        )}
      </AnimatePresence>

      <Pagina
      titolo="Dashboard"
      azioni={
        <PeriodoControl
          periodo={periodo}
          setPeriodo={setPeriodo}
          dalC={dalC}
          alC={alC}
          setDalC={setDalC}
          setAlC={setAlC}
        />
      }
    >
      {caricamento || !stats ? (
        <Box mih={420} />
      ) : (
        <Stack gap="lg">
          <motion.div
            variants={contenitore}
            initial="hidden"
            animate={primaVoltaRef.current ? (splashGone ? "visibile" : "hidden") : "visibile"}
            custom={primaVoltaRef.current}
          >
            <Stack gap="lg">
          {/* Card KPI */}
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
            <motion.div variants={elemento}>
            <KpiCard
              Ico={IconClipboardList}
              color="accent"
              label="Ordini"
              valore={<CountUp value={stats.ordiniN} />}
              sub={`${euro(stats.ordiniValore)} · ${descr}`}
              onClick={() => vai({ path: "/giornaliero", ...periodoLink })}
            />
            </motion.div>
            <motion.div variants={elemento}>
            <KpiCard
              Ico={IconCashBanknote}
              color="red"
              label="Da saldare"
              valore={<CountUp value={stats.daSaldareSpediti + stats.daSaldareNonSpediti} format={euro} />}
              sub={`${euro(stats.daSaldareSpediti)} spediti · ${euro(stats.daSaldareNonSpediti)} non spediti`}
              onClick={() => vai({ path: "/contabilita", tab: "pagamenti", statiPagamento: ["atteso"] })}
            />
            </motion.div>
            <motion.div variants={elemento}>
            <KpiCard
              Ico={IconHammer}
              color="yellow"
              label="In produzione"
              valore={<CountUp value={stats.inProduzione} />}
              sub={`${stats.inArrivo} in arrivo dall'estero`}
              onClick={() => vai({ path: "/produzione" })}
            />
            </motion.div>
            <motion.div variants={elemento}>
            <KpiCard
              Ico={IconReceipt2}
              color="teal"
              label="Provvigioni maturate"
              valore={<CountUp value={stats.provvMaturato} format={euro} />}
              sub={`di ${euro(stats.provvPotenziale)} potenziali · ${descr}`}
              onClick={() => vai({ path: "/contabilita", tab: "provvigioni", ...periodoLink })}
            />
            </motion.div>
          </SimpleGrid>

          {/* Bacheca del team: promemoria condivisi + to-do dei marcatori (FASE 6C),
              prioritaria subito sotto le KPI (UI-SPEC §7.2). */}
          <motion.div variants={elemento}><BachecaPromemoria identity={identity} onApriOrdine={apriOrdine} /></motion.div>

          {/* Motore FASE 14: card derivate, ordinate e collegate ai flussi già
              esistenti. Si carica separatamente dai KPI per non rallentare il reveal. */}
          {premium.enabled && (
            <motion.div variants={elemento}>
              <Suspense fallback={null}>
                <SuggerimentiPanel nonce={nonce} onApri={vai} />
              </Suspense>
            </motion.div>
          )}

          {/* Grafici */}
          <motion.div variants={elemento}>
          <Group gap={8}>
            <ThemeIcon variant="light" color="accent" radius="md">
              <IconChartArcs size={18} />
            </ThemeIcon>
            <Text fw={700} fz="lg">
              Andamento e distribuzioni
            </Text>
            <Text size="sm" c="dimmed">
              · {descr}
            </Text>
          </Group>

          <Pannello titolo="Andamento ordini & incassi">
            {stats.andamento.length === 0 ? (
              <Vuoto />
            ) : (
              <GraficoLazy pronto={pesantiPronti} h={260}>
                <AreaChart
                  h={260}
                  data={stats.andamento.map((p) => ({
                    x: p.etichetta,
                    iso: p.iso,
                    "Valore ordini": p.valore / 100,
                    Incassato: p.incassato / 100,
                  }))}
                  dataKey="x"
                  withLegend
                  curveType="monotone"
                  valueFormatter={euro0}
                  series={[
                    { name: "Valore ordini", color: "accent.6" },
                    { name: "Incassato", color: "teal.6" },
                  ]}
                  yAxisProps={{ width: 65 }}
                  areaChartProps={{
                    style: { cursor: "pointer" },
                    onClick: (s) => {
                      const index = Number(s.activeTooltipIndex);
                      const iso = Number.isInteger(index) ? stats.andamento[index]?.iso : undefined;
                      if (iso) vai({ path: "/giornaliero", ...meseRange(iso) });
                    },
                  }}
                />
              </GraficoLazy>
            )}
          </Pannello>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {/* Donut combinato: per stato / da saldare (toggle) + legenda leggibile */}
            <Pannello
              titolo="Distribuzione"
              azione={
                <SegmentedControl
                  size="xs"
                  value={donut}
                  onChange={(v) => setDonut(v as "stato" | "saldare")}
                  data={[
                    { value: "stato", label: "Per stato" },
                    { value: "saldare", label: "Da saldare" },
                  ]}
                />
              }
            >
              {donut === "stato" ? (
                stats.perStato.length === 0 ? (
                  <Vuoto />
                ) : (
                  <DonutConLegenda
                    chartLabel={`${stats.ordiniN} ordini`}
                    onPick={(name) => {
                      const v = STATI_ORDINE.find((s) => s.label === name)?.value;
                      if (v) vai({ path: "/giornaliero", stati: [v], ...periodoLink });
                    }}
                    data={stats.perStato.map((f) => ({
                      name: statoDef(f.chiave).label,
                      value: f.valore / 100,
                      n: f.n,
                      color: `${statoDef(f.chiave).color}.6`,
                    }))}
                  />
                )
              ) : stats.daSaldareSpediti + stats.daSaldareNonSpediti === 0 ? (
                <Vuoto testo="Tutto saldato 🎉" />
              ) : (
                <DonutConLegenda
                  chartLabel={euro0((stats.daSaldareSpediti + stats.daSaldareNonSpediti) / 100)}
                  onPick={(name) =>
                    vai({
                      path: "/contabilita",
                      tab: "pagamenti",
                      statiPagamento: ["atteso"],
                      spedito: name.startsWith("Spediti") ? "spediti" : "non",
                    })
                  }
                  data={[
                    { name: "Spediti (a rischio)", value: stats.daSaldareSpediti / 100, color: "red.6" },
                    { name: "Non spediti", value: stats.daSaldareNonSpediti / 100, color: "yellow.5" },
                  ]}
                />
              )}
            </Pannello>

            {/* Classifiche combinate: agenti / regioni (toggle), scrollabili */}
            <Pannello
              titolo="Classifiche"
              sub={classifica === "agenti" ? "per valore ordini · clic per i dettagli" : "clic per filtrare il giornaliero"}
              azione={
                <SegmentedControl
                  size="xs"
                  value={classifica}
                  onChange={(v) => setClassifica(v as "agenti" | "regioni")}
                  data={[
                    { value: "agenti", label: "Agenti" },
                    { value: "regioni", label: "Regioni" },
                  ]}
                />
              }
            >
              <GraficoLazy pronto={pesantiPronti} h={240}>
                {classifica === "agenti" ? (
                  stats.topAgenti.length === 0 ? (
                    <Vuoto />
                  ) : (
                    <BarChartScroll
                      altezza={240}
                      nDati={stats.topAgenti.length}
                      data={stats.topAgenti.map((a) => ({
                        etichetta: a.agenteNome || "—",
                        agenteId: a.agenteId,
                        Valore: a.valore / 100,
                      }))}
                      colore="accent.6"
                      onPick={(row) => vai({ path: "/contabilita", tab: "provvigioni", agenteId: row.agenteId, ...periodoLink })}
                    />
                  )
                ) : stats.perRegione.length === 0 ? (
                  <Vuoto />
                ) : (
                  <BarChartScroll
                    altezza={240}
                    nDati={stats.perRegione.length}
                    data={stats.perRegione.map((r) => ({
                      etichetta: r.chiave,
                      regione: r.chiave,
                      Valore: r.valore / 100,
                    }))}
                    colore="teal.6"
                    onPick={(row) => vai({ path: "/giornaliero", regione: row.regione, ...periodoLink })}
                  />
                )}
              </GraficoLazy>
            </Pannello>
          </SimpleGrid>
          </motion.div>

          {/* Pannelli operativi */}
          <motion.div variants={elemento}>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Pannello titolo="Ultimi ordini">
              {ultimi.length === 0 ? (
                <Vuoto testo="Nessun ordine." />
              ) : (
                <Stack gap={6}>
                  {ultimi.map((o) => {
                    const s = statoDef(o.stato);
                    return (
                      <RigaCliccabile key={o.id} onClick={() => apriOrdine(o.id, o.numero)}>
                        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                          <BadgeStato definizione={s} />
                          <Box style={{ minWidth: 0 }}>
                            <Text fw={600} size="sm" className="tabular" truncate>
                              {o.numero} · {o.clienteNome || "—"}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {formattaDataItaliana(o.data)}
                              {o.medicoNome ? ` · ${o.medicoNome}` : ""}
                            </Text>
                          </Box>
                        </Group>
                        <Text fw={600} size="sm" className="tabular" style={{ whiteSpace: "nowrap" }}>
                          {euro(o.totale)}
                        </Text>
                      </RigaCliccabile>
                    );
                  })}
                </Stack>
              )}
            </Pannello>

            <Pannello
              titolo="Scaduti da saldare"
              sub={scaduti.length > 0 ? "rate/saldi oltre la scadenza" : undefined}
              azione={
                scaduti.length > 0 ? (
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={() => vai({ path: "/contabilita", tab: "pagamenti", statiPagamento: ["scaduto"] })}
                  >
                    Vai ai crediti
                  </Anchor>
                ) : undefined
              }
            >
              {scaduti.length === 0 ? (
                <Vuoto testo="Nessuno scaduto. 👌" />
              ) : (
                <Stack gap={6}>
                  {scaduti.map((r) => (
                    <RigaCliccabile key={r.id} onClick={() => apriOrdine(r.ordineId, r.ordineNumero)}>
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <ThemeIcon variant="light" color="red" radius="md" size="md">
                          <IconAlertTriangle size={15} />
                        </ThemeIcon>
                        <Box style={{ minWidth: 0 }}>
                          <Text fw={600} size="sm" truncate>
                            {r.clienteNome || r.ordineNumero}
                          </Text>
                          <Text size="xs" c="dimmed">
                            scaduto il {formattaDataItaliana(r.scadenza)} · {r.ordineNumero}
                          </Text>
                        </Box>
                      </Group>
                      <Text fw={600} size="sm" c="red.7" className="tabular" style={{ whiteSpace: "nowrap" }}>
                        {euro(r.importo)}
                      </Text>
                    </RigaCliccabile>
                  ))}
                </Stack>
              )}
            </Pannello>
          </SimpleGrid>
            </motion.div>
            </Stack>
          </motion.div>
        </Stack>
      )}

      <OrdineEditor
        editor={editor}
        identity={identity}
        onClose={() => setEditor(null)}
        onSaved={() => {
          setEditor(null);
          setNonce((n) => n + 1);
        }}
      />
    </Pagina>
    </>
  );
}

/** Grafico a barre con scroll orizzontale: ogni barra ha una larghezza minima così
 *  con molti dati il grafico scorre invece di schiacciarsi (raddrizza i grafici). */
function BarChartScroll<T extends { etichetta: string; Valore: number }>({
  data,
  colore,
  altezza,
  nDati,
  onPick,
}: {
  data: T[];
  colore: string;
  altezza: number;
  nDati: number;
  onPick: (row: T) => void;
}) {
  const larghezza = Math.max(nDati * 112, 420);
  return (
    <ScrollArea type="hover" scrollbarSize={8} offsetScrollbars>
      <Box style={{ minWidth: larghezza }}>
        <BarChart
          h={altezza}
          data={data}
          dataKey="etichetta"
          valueFormatter={euro0}
          series={[{ name: "Valore", color: colore }]}
          yAxisProps={{ width: 65 }}
          xAxisProps={{ interval: 0, minTickGap: 0, height: 46, tickMargin: 12 }}
          barChartProps={{
            margin: { right: 18, bottom: 6 },
            style: { cursor: "pointer" },
            onClick: (s) => {
              const index = Number(s.activeTooltipIndex);
              const row = Number.isInteger(index) ? data[index] : undefined;
              if (row) onPick(row);
            },
          }}
        />
      </Box>
    </ScrollArea>
  );
}

/** Selettore di periodo come popup: tutte le opzioni a colpo d'occhio (preset +
 *  intervallo personalizzato). Scegliendo «Personalizzato» le date partono dal
 *  periodo attualmente risolto, così l'utente le ritocca invece di ripartire da zero. */
function PeriodoControl({
  periodo,
  setPeriodo,
  dalC,
  alC,
  setDalC,
  setAlC,
}: {
  periodo: PeriodoSel;
  setPeriodo: (p: PeriodoSel) => void;
  dalC: string;
  alC: string;
  setDalC: (v: string) => void;
  setAlC: (v: string) => void;
}) {
  const { anno } = usePrefs();
  const [open, setOpen] = useState(false);
  useCloseOnScroll(open, setOpen);
  const presets: PeriodoDash[] = ["giorno", "settimana", "mese", "anno", "tutto"];

  // L'intervallo mostrato riflette SEMPRE la selezione corrente: cliccando un preset i
  // campi Dal/Al si aggiornano col suo intervallo risolto; in «personalizzato» sono i
  // valori dell'utente.
  const r = risolvi(periodo, dalC, alC, anno);

  const scegliPreset = (p: PeriodoDash) => {
    setPeriodo(p);
    setOpen(false);
  };

  // «Personalizzato»: lascia l'intervallo com'è (eredita quello correntemente risolto).
  const seedCustom = () => {
    if (r.dal) setDalC(r.dal);
    if (r.al) setAlC(r.al);
    setPeriodo("personalizzato");
  };

  // Editare una data passa automaticamente a «personalizzato», seminando l'altro campo
  // con l'intervallo attuale così non si svuota.
  const modificaData = (campo: "dal" | "al", val: string) => {
    setDalC(campo === "dal" ? val : r.dal ?? "");
    setAlC(campo === "al" ? val : r.al ?? "");
    setPeriodo("personalizzato");
  };

  const etichetta =
    periodo === "personalizzato"
      ? dalC || alC
        ? `${fmtBreve(dalC)} – ${fmtBreve(alC)}`
        : "Personalizzato"
      : ETICHETTE_PERIODO[periodo];

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow shadow="md" width={264}>
      <Popover.Target>
        <Button
          variant="default"
          leftSection={<IconCalendarEvent size={16} />}
          rightSection={<IconChevronDown size={15} />}
          onClick={() => setOpen((o) => !o)}
        >
          {etichetta}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">
            Periodo
          </Text>
          <SimpleGrid cols={2} spacing={6}>
            {presets.map((p) => (
              <Button
                key={p}
                size="xs"
                variant={periodo === p ? "light" : "default"}
                color={periodo === p ? "accent" : "gray"}
                onClick={() => scegliPreset(p)}
              >
                {ETICHETTE_PERIODO[p]}
              </Button>
            ))}
            <Button
              size="xs"
              variant={periodo === "personalizzato" ? "light" : "default"}
              color={periodo === "personalizzato" ? "accent" : "gray"}
              onClick={seedCustom}
            >
              Personalizzato
            </Button>
          </SimpleGrid>
          <Divider label="Intervallo" labelPosition="center" />
          <FiltroIntervalloDate
            dal={r.dal ?? ""}
            al={r.al ?? ""}
            onDalChange={(value) => modificaData("dal", value)}
            onAlChange={(value) => modificaData("al", value)}
            gap={6}
            wrap="nowrap"
            size="xs"
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Donut disegnato a mano (archi SVG con stroke): resta un cerchio perfetto e liscio
 *  in ogni condizione (anche con lo `zoom` UI), al contrario del DonutChart Recharts
 *  che sotto zoom rasterizza gli archi rendendoli "spigolosi". */
function DonutSvg({
  data,
  label,
  onPick,
}: {
  data: { name: string; value: number; color: string }[];
  label: string;
  onPick: (name: string) => void;
}) {
  const PX = 172;
  const R = 42; // raggio nel viewBox 0..100
  const SW = 15; // spessore anello (outer = R + SW/2 = 49.5, dentro il viewBox)
  const GAP = 1.4; // spazio tra fette, in % di circonferenza
  const totale = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0;
  return (
    <Box style={{ width: PX, height: PX, flex: `0 0 ${PX}px`, position: "relative" }}>
      <svg viewBox="0 0 100 100" width={PX} height={PX} style={{ transform: "rotate(-90deg)" }}>
        {data.map((d) => {
          const frazione = (d.value / totale) * 100;
          const lung = Math.max(frazione - GAP, 0.3);
          const offset = -(acc / totale) * 100;
          acc += d.value;
          return (
            <circle
              key={d.name}
              cx={50}
              cy={50}
              r={R}
              fill="none"
              stroke={`var(--mantine-color-${d.color.replace(".", "-")})`}
              strokeWidth={SW}
              pathLength={100}
              strokeDasharray={`${lung} ${100 - lung}`}
              strokeDashoffset={offset}
              style={{ cursor: "pointer" }}
              onClick={() => onPick(d.name)}
            >
              <title>
                {d.name}: {euro0(d.value)}
              </title>
            </circle>
          );
        })}
      </svg>
      <Box style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Text fw={600} size="sm" c="dimmed">
          {label}
        </Text>
      </Box>
    </Box>
  );
}

/** Donut + legenda cliccabile a fianco: le fette diventano leggibili (etichetta +
 *  valore, ed eventuale conteggio) senza dover passare col mouse. */
function DonutConLegenda({
  data,
  chartLabel,
  onPick,
}: {
  data: { name: string; value: number; n?: number; color: string }[];
  chartLabel: string;
  onPick: (name: string) => void;
}) {
  return (
    <Group align="center" gap={48} wrap="nowrap" justify="center" h="100%">
      <DonutSvg data={data} label={chartLabel} onPick={onPick} />
      <Stack gap={10} style={{ minWidth: 0 }}>
        {data.map((d) => (
          <Group
            key={d.name}
            gap={8}
            wrap="nowrap"
            style={{ cursor: "pointer" }}
            onClick={() => onPick(d.name)}
          >
            <Box
              style={{
                width: 11,
                height: 11,
                borderRadius: 3,
                background: `var(--mantine-color-${d.color.replace(".", "-")})`,
                flex: "0 0 11px",
              }}
            />
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" truncate>
                {d.name}
              </Text>
              <Text size="xs" c="dimmed" className="tabular">
                {euro0(d.value)}
                {d.n != null ? ` · ${d.n} ord.` : ""}
              </Text>
            </Box>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}

/** ISO (YYYY-MM-DD) → «gg/mm» compatto per l'etichetta del selettore. */
function fmtBreve(iso: string): string {
  if (!iso || iso.length < 10) return "…";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function KpiCard({
  Ico,
  color,
  label,
  valore,
  sub,
  onClick,
}: {
  Ico: Icon;
  color: string;
  label: string;
  valore: React.ReactNode;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <Card className="pt-kpi-card" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <Group gap={8} wrap="nowrap" mb={6}>
        <ThemeIcon variant="light" color={color} radius="md" size="lg">
          <Ico size={20} />
        </ThemeIcon>
        <Text size="sm" c="dimmed" fw={600}>
          {label}
        </Text>
      </Group>
      <Text fw={800} fz={28} lh={1.1} className="tabular">
        {valore}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" mt={4} truncate>
          {sub}
        </Text>
      )}
    </Card>
  );
}

function Pannello({
  titolo,
  sub,
  azione,
  children,
}: {
  titolo: string;
  sub?: string;
  azione?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card style={{ display: "flex", flexDirection: "column" }}>
      <Group justify="space-between" align="center" mb="sm" wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          <Text fw={700} size="sm" truncate>
            {titolo}
          </Text>
          {sub && (
            <Text size="xs" c="dimmed" truncate>
              {sub}
            </Text>
          )}
        </Box>
        {azione}
      </Group>
      <Box style={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Card>
  );
}

function RigaCliccabile({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="md" p="xs" className="pt-pagamento-row" style={{ cursor: "pointer" }} onClick={onClick}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        {children}
      </Group>
    </Paper>
  );
}

function Vuoto({ testo = "Nessun dato nel periodo." }: { testo?: string }) {
  return (
    <Center mih={180}>
      <Text c="dimmed" size="sm">
        {testo}
      </Text>
    </Center>
  );
}
