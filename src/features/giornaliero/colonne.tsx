// Colonne configurabili del Giornaliero: definizioni + hook di persistenza
// (ordine + visibilità) in localStorage. N° e azioni (⋯) restano fissi ai bordi
// e non sono qui: questo riguarda solo le colonne "dati" in mezzo.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconEditCircle,
  IconMailOff,
  IconSend2,
  type Icon,
} from "@tabler/icons-react";
import type {
  IndicazioneInvioPreventivo,
  OrdineDto,
} from "../../lib/tauri";
import { CATEGORIE_PRODOTTO, categoriaDef } from "../anagrafiche/categorie";
import { centsToEurStr } from "../../lib/money";
import { STATI_ORDINE, statoDef } from "./stati";
import { marcatoreDef } from "./marcatori";
import { statoPagDef } from "../contabilita/statiPagamento";
import type { MetaExport } from "../../ui/esporta/EsportaTabella";
import { globalIsResizing, resetLarghezzeTabella } from "../../ui/Tabella";
import { DataAdattiva } from "../../ui/DataAdattiva";
import { RiepilogoLink } from "../../shell/RiepilogoLink";
import {
  useCompactColumnObserver,
  type LeggiColonnaCompatta,
} from "../../ui/useCompactColumnObserver";
import {
  type DefinizioneColonnaTabella,
  normalizzaStatoColonne,
  type StatoColonneConfigurabili,
  useColonneConfigurabili,
} from "../../ui/colonneConfigurabili";

/** Definizione della colonna con il metadato aggiuntivo per l'export Excel. */
export type ColDef = DefinizioneColonnaTabella<OrdineDto> & { esporta?: MetaExport<OrdineDto> };


// Colore badge per linea (categoria prodotto). Fonte unica: categoriaDef (registri).
export function coloreLinea(linea: string): string {
  return categoriaDef(linea).color;
}

// PERF (FASE 7A): la decisione "testo vs sola-icona" delle colonne Stato/Linea è UNIFORME
// per colonna (tutte le righe decidono uguale, in base all'etichetta più lunga presente).
// Quindi si misura **una sola volta per colonna** dentro `ColonneDominioProvider` (un solo
// ResizeObserver, due ghost misuratori), NON una volta per cella: prima ogni cella faceva
// getComputedStyle+offsetWidth (reflow forzato) + un ResizeObserver proprio → con 100 righe
// erano ~200 reflow al mount e ~200 observer che scattavano insieme all'animazione della
// sidebar (causa di lag e dei ~3s di caricamento). Ora le celle leggono solo un booleano.

const ghostStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "max-content",
  maxWidth: "none",
  visibility: "hidden",
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

const wrapStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  minWidth: 0,
  display: "flex",
  justifyContent: "center",
};

// Etichette PIÙ LUNGHE del dominio (fallback teorico): la decisione "testo o solo icona" si basa
// sull'etichetta più lunga, così è **uniforme su tutta la colonna** (tutte le righe decidono uguale)
// e nessuna etichetta più corta viene mai troncata.
/** Etichetta stato per il Giornaliero: breve dove definita (es. «Arrivato» al posto di
 * «Arrivato in Italia»). La Produzione continua a usare `statoDef(...).label` per esteso. */
const labelStato = (d: (typeof STATI_ORDINE)[number]) => d.labelBreve ?? d.label;

const STATO_PIU_LUNGO = STATI_ORDINE.reduce((a, b) => (labelStato(b).length > labelStato(a).length ? b : a));
const CATEGORIA_PIU_LUNGA = CATEGORIE_PRODOTTO.reduce((a, b) => (b.label.length > a.label.length ? b : a));

interface StatoInvioPreventivoDef {
  value: IndicazioneInvioPreventivo;
  label: string;
  color: string;
  Ico: Icon;
}

export const STATI_INVIO_PREVENTIVO: StatoInvioPreventivoDef[] = [
  {
    value: "mai_inviato",
    label: "Mai inviato",
    color: "gray",
    Ico: IconMailOff,
  },
  {
    value: "inviato",
    label: "Inviato",
    color: "teal",
    Ico: IconSend2,
  },
  {
    value: "modificato_dopo_invio",
    label: "Modificato dopo l’invio",
    color: "orange",
    Ico: IconEditCircle,
  },
];

export function statoInvioPreventivoDef(
  stato: IndicazioneInvioPreventivo,
): StatoInvioPreventivoDef {
  return (
    STATI_INVIO_PREVENTIVO.find((definizione) => definizione.value === stato) ??
    STATI_INVIO_PREVENTIVO[0]
  );
}

const STATO_INVIO_PIU_LUNGO = STATI_INVIO_PREVENTIVO.reduce((a, b) =>
  b.label.length > a.label.length ? b : a,
);

// Dominio EFFETTIVO: l'etichetta più lunga davvero presente tra le righe mostrate (non il massimo
// teorico). Calcolato una volta sulle righe visibili e condiviso via context: così se nei dati ci
// sono solo stati/linee corti, la colonna mostra il testo anche con meno spazio, restando comunque
// uniforme (tutte le righe usano la stessa etichetta-metro).
interface DominioColonne {
  /** Distingue le celle adattive dagli utilizzi normali in modali e riepiloghi. */
  dentroTabella: boolean;
  stato: (typeof STATI_ORDINE)[number];
  categoria: (typeof CATEGORIE_PRODOTTO)[number];
  /** Colonna Stato troppo stretta per il testo → tutte le righe a sola icona (deciso 1 volta). */
  compactStato: boolean;
  /** Idem per la colonna Linea. */
  compactLinea: boolean;
  /** Idem per la colonna Data. */
  compactData: boolean;
  /** Idem per lo stato d'invio dei Preventivi. */
  compactStatoInvio: boolean;
}

const DominioCtx = createContext<DominioColonne>({
  dentroTabella: false,
  stato: STATO_PIU_LUNGO,
  categoria: CATEGORIA_PIU_LUNGA,
  compactStato: false,
  compactLinea: false,
  compactData: false,
  compactStatoInvio: false,
});

// Contenitore a dimensione zero che ospita un ghost misuratore senza impattare il layout
// (offsetWidth/getBoundingClientRect del ghost restano la sua larghezza naturale anche se il
// genitore lo ritaglia).
const misuraStyle: CSSProperties = { position: "relative", width: 0, height: 0, overflow: "hidden" };
const ridimensionamentoTabellaAttivo = () => globalIsResizing;

export interface RigaDominioColonne {
  stato: string;
  linee: string[];
  statoInvio?: IndicazioneInvioPreventivo;
}

/** Fornisce alle celle Stato/Linea l'etichetta più lunga realmente presente tra `ordini`,
 *  e decide UNA volta per colonna se passare a sola-icona (misurazione hoistata qui). */
export function ColonneDominioProvider({
  ordini,
  children,
}: {
  ordini: RigaDominioColonne[];
  children: ReactNode;
}) {
  const dominio = useMemo(() => {
    let stato = STATI_ORDINE[0];
    let lenS = -1;
    for (const v of new Set(ordini.map((o) => o.stato))) {
      const d = statoDef(v);
      if (labelStato(d).length > lenS) {
        lenS = labelStato(d).length;
        stato = d;
      }
    }
    let categoria = CATEGORIE_PRODOTTO[0];
    let lenC = -1;
    const cats = new Set<string>();
    for (const o of ordini) for (const l of o.linee) cats.add(l);
    for (const v of cats) {
      const d = categoriaDef(v);
      if (d.label.length > lenC) {
        lenC = d.label.length;
        categoria = d;
      }
    }
    let statoInvio = STATI_INVIO_PREVENTIVO[0];
    let lenInvio = -1;
    for (const valore of new Set(ordini.map((o) => o.statoInvio).filter(Boolean))) {
      const d = statoInvioPreventivoDef(valore!);
      if (d.label.length > lenInvio) {
        lenInvio = d.label.length;
        statoInvio = d;
      }
    }
    return {
      stato: lenS < 0 ? STATO_PIU_LUNGO : stato,
      categoria: lenC < 0 ? CATEGORIA_PIU_LUNGA : categoria,
      statoInvio:
        lenInvio < 0 ? STATO_INVIO_PIU_LUNGO : statoInvio,
    };
  }, [ordini]);

  const rootRef = useRef<HTMLDivElement>(null);
  const ghostStato = useRef<HTMLSpanElement>(null);
  const ghostLinea = useRef<HTMLSpanElement>(null);
  const ghostData = useRef<HTMLSpanElement>(null);
  const ghostStatoInvio = useRef<HTMLSpanElement>(null);
  const [compactStato, setCompactStato] = useState(false);
  const [compactLinea, setCompactLinea] = useState(false);
  const [compactData, setCompactData] = useState(false);
  const [compactStatoInvio, setCompactStatoInvio] = useState(false);

  const misuraColonne = useCallback((leggi: LeggiColonnaCompatta) => {
    const stato = leggi('[data-ptcol="stato"]', ghostStato.current);
    if (stato !== null) setCompactStato(stato);
    const linea = leggi('[data-ptcol="linea"]', ghostLinea.current);
    if (linea !== null) setCompactLinea(linea);
    const data = leggi('[data-ptcol="data"]', ghostData.current, "data");
    if (data !== null) setCompactData(data);
    const statoInvio = leggi(
      '[data-ptcol="stato-invio"]',
      ghostStatoInvio.current,
      "ultimoInvioMs",
    );
    if (statoInvio !== null) setCompactStatoInvio(statoInvio);
  }, []);
  const refreshMisure = `${dominio.stato.value}:${dominio.categoria.value}:${dominio.statoInvio.value}:${ordini.length}`;
  useCompactColumnObserver(rootRef, misuraColonne, refreshMisure, ridimensionamentoTabellaAttivo);

  return (
    <DominioCtx.Provider
      value={{
        dentroTabella: true,
        ...dominio,
        compactStato,
        compactLinea,
        compactData,
        compactStatoInvio,
      }}
    >
      <div ref={rootRef} style={{ height: "100%" }}>
        <div style={misuraStyle} aria-hidden>
          <span ref={ghostStato} style={ghostStyle}>
            <Badge variant="light" leftSection={<dominio.stato.Ico size={12} />}>
              {labelStato(dominio.stato)}
            </Badge>
          </span>
          <span ref={ghostLinea} style={ghostStyle}>
            <Group gap={4} wrap="nowrap">
              <Badge size="sm" variant="light" leftSection={<dominio.categoria.Ico size={11} />}>
                {dominio.categoria.label}
              </Badge>
            </Group>
          </span>
          <span ref={ghostData} style={ghostStyle}>
            <span className="tabular">27/06/2026</span>
          </span>
          <span ref={ghostStatoInvio} style={ghostStyle}>
            <Badge
              variant="light"
              leftSection={<dominio.statoInvio.Ico size={12} />}
            >
              {dominio.statoInvio.label}
            </Badge>
          </span>
        </div>
        {children}
      </div>
    </DominioCtx.Provider>
  );
}

/** Cella «Data»: visualizzata one-line di default, split su 3 righe solo se non c'è spazio. */
export function DataColonnaAdattiva({ iso }: { iso?: string | null }) {
  return (
    <div data-ptcol="data" style={{ width: "100%" }}>
      <DataAdattiva iso={iso} />
    </div>
  );
}

/** Cella «Stato»: badge con icona + nome centrato; quando la colonna non basta per il nome
 * **più lungo presente** passa a **sola icona** per TUTTE le righe (con tooltip). */
export function StatoOrdineBadge({
  stato,
  motivoRifiuto = "",
}: {
  stato: string;
  motivoRifiuto?: string;
}) {
  const sd = statoDef(stato);
  const { compactStato: compact } = useContext(DominioCtx);
  const rifiutatoMotivo =
    stato === "Rifiutato" && motivoRifiuto ? motivoRifiuto : "";

  const testo = labelStato(sd);
  const badge = compact ? (
    <Badge variant="light" color={sd.color} px={6} aria-label={testo}>
      <sd.Ico size={14} style={{ display: "block" }} />
    </Badge>
  ) : (
    <Badge variant="light" color={sd.color} leftSection={<sd.Ico size={12} />}>
      {testo}
    </Badge>
  );

  const conTip = (
    <Tooltip label={rifiutatoMotivo ? `${testo} — ${rifiutatoMotivo}` : testo} withArrow multiline maw={260}>
      {badge}
    </Tooltip>
  );

  return (
    <div data-ptcol="stato" style={wrapStyle}>
      {conTip}
    </div>
  );
}

/** Cella «Linea»: badge categoria centrati; quando la colonna non basta passa a **sole icone**
 * per TUTTE le righe (decisione uniforme sulla categoria col nome più lungo presente). */
export function LineeOrdineBadge({ linee }: { linee: string[] }) {
  const { compactLinea: compact } = useContext(DominioCtx);
  if (linee.length === 0) return <Text ta="center">—</Text>;

  return (
    <div data-ptcol="linea" style={wrapStyle}>
      <Group gap={4} wrap="nowrap" justify="center">
        {linee.map((l) => {
          const cd = categoriaDef(l);
          return (
            <Tooltip key={l} label={cd.label} withArrow>
              <Badge
                size="sm"
                variant="light"
                color={cd.color}
                {...(compact
                  ? { px: 6, "aria-label": cd.label }
                  : { leftSection: <cd.Ico size={11} /> })}
              >
                {compact ? <cd.Ico size={12} style={{ display: "block" }} /> : cd.label}
              </Badge>
            </Tooltip>
          );
        })}
      </Group>
    </div>
  );
}

/** Stato d'invio di un Preventivo. Nella tabella passa uniformemente a sola icona
 * quando la colonna non contiene l'etichetta più lunga presente; negli altri
 * contesti, fuori dal provider della tabella, resta sempre completo. */
export function StatoInvioPreventivoBadge({
  stato,
  tooltip,
}: {
  stato: IndicazioneInvioPreventivo;
  tooltip?: ReactNode;
}) {
  const definizione = statoInvioPreventivoDef(stato);
  const { compactStatoInvio: compact, dentroTabella } = useContext(DominioCtx);
  const badge = compact ? (
    <Badge
      variant="light"
      color={definizione.color}
      px={6}
      aria-label={definizione.label}
    >
      <definizione.Ico size={14} style={{ display: "block" }} />
    </Badge>
  ) : (
    <Badge
      variant="light"
      color={definizione.color}
      leftSection={<definizione.Ico size={12} />}
    >
      {definizione.label}
    </Badge>
  );

  return (
    <div
      data-ptcol="stato-invio"
      style={
        dentroTabella
          ? wrapStyle
          : {
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }
      }
    >
      <Tooltip
        label={tooltip ?? definizione.label}
        withArrow
        multiline
        maw={340}
      >
        {badge}
      </Tooltip>
    </div>
  );
}

/** Sotto lo stato, la segnalazione di triage (FASE 4E). Niente se "ok". */
function MarcatoreBadge({ o }: { o: OrdineDto }) {
  const md = marcatoreDef(o.marcatore);
  const { compactStato: compact } = useContext(DominioCtx);
  if (!md) return null;
  const badge = compact ? (
    <Badge size="xs" variant="light" color={md.color} px={6} aria-label={md.label}>
      <md.Ico size={11} style={{ display: "block" }} />
    </Badge>
  ) : (
    <Badge size="xs" variant="light" color={md.color} leftSection={<md.Ico size={10} />}>
      {md.label}
    </Badge>
  );
  return (
    <Tooltip label={md.label} withArrow>
      {badge}
    </Tooltip>
  );
}

function clienteVisibileGiornaliero(o: OrdineDto): string {
  return o.linee.includes("Diagnostica") ? o.medicoNome : o.clienteNome;
}

export const COLONNE: ColDef[] = [
  {
    key: "data",
    label: "Data",
    // Spazio sufficiente per gg/mm/aaaa nella configurazione standard; se l'utente la
    // restringe manualmente, DataAdattiva continua a passare alla versione compatta.
    width: 96,
    defaultVisible: true,
    sortAccessor: (o) => o.data,
    esporta: { tipo: "data", valore: (o) => o.data },
    render: (o) => <DataColonnaAdattiva iso={o.data} />,
  },
  {
    key: "cliente",
    label: "Cliente",
    defaultVisible: true,
    sortAccessor: clienteVisibileGiornaliero,
    esporta: { valore: clienteVisibileGiornaliero },
    render: (o) => o.linee.includes("Diagnostica")
      ? <RiepilogoLink tipo="medico" id={o.medicoId} nome={o.medicoNome} />
      : <RiepilogoLink tipo="cliente" id={o.clienteId} nome={o.clienteNome} />,
  },
  { key: "numero", label: "N°", defaultVisible: false, sortAccessor: (o) => o.numero, esporta: { valore: (o) => o.numero }, render: (o) => <span className="tabular" style={{ fontWeight: 600 }}>{o.numero}</span> },
  {
    key: "stato",
    label: "Stato",
    width: 86,
    defaultVisible: true,
    align: "center",
    sortAccessor: (o) => o.stato,
    esporta: { valore: (o) => labelStato(statoDef(o.stato)) },
    render: (o) => (
      <Stack gap={3} align="center" style={{ minWidth: 0, width: "100%" }}>
        <StatoOrdineBadge stato={o.stato} motivoRifiuto={o.motivoRifiuto} />
        <MarcatoreBadge o={o} />
      </Stack>
    ),
  },
  { key: "medico", label: "Medico", defaultVisible: true, sortAccessor: (o) => o.medicoNome, esporta: { valore: (o) => o.medicoNome }, render: (o) => <RiepilogoLink tipo="medico" id={o.medicoId} nome={o.medicoNome} /> },
  { key: "agente", label: "Agente", defaultVisible: false, sortAccessor: (o) => o.agenteNome, esporta: { valore: (o) => o.agenteNome }, render: (o) => <RiepilogoLink tipo="agente" id={o.agenteId} nome={o.agenteNome} /> },
  { key: "citta", label: "Città", defaultVisible: false, sortAccessor: (o) => o.clienteCitta, esporta: { valore: (o) => o.clienteCitta }, render: (o) => o.clienteCitta || "—" },
  { key: "regione", label: "Regione", defaultVisible: true, sortAccessor: (o) => o.clienteRegione, esporta: { valore: (o) => o.clienteRegione }, render: (o) => o.clienteRegione || "—" },
  {
    key: "linea",
    label: "Linea",
    width: 84,
    defaultVisible: true,
    align: "center",
    sortAccessor: (o) => o.linee.join(", "),
    esporta: { valore: (o) => o.linee.join(", ") },
    render: (o) => <LineeOrdineBadge linee={o.linee} />,
  },
  {
    key: "importo",
    label: "Importo",
    defaultVisible: true,
    align: "right",
    sortAccessor: (o) => o.totale,
    esporta: { tipo: "euro", totale: true, valore: (o) => o.totale },
    render: (o) => <span className="tabular">€ {centsToEurStr(o.totale)}</span>,
  },
  {
    key: "acconto",
    label: "Acconto prev.",
    defaultVisible: false,
    align: "right",
    sortAccessor: (o) => o.acconto,
    esporta: { tipo: "euro", valore: (o) => o.acconto },
    render: (o) => <span className="tabular">€ {centsToEurStr(o.acconto)}</span>,
  },
  {
    key: "incassato",
    label: "Incassato",
    defaultVisible: true,
    align: "right",
    sortAccessor: (o) => o.incassato,
    esporta: { tipo: "euro", totale: true, valore: (o) => o.incassato },
    render: (o) => <span className="tabular">€ {centsToEurStr(o.incassato)}</span>,
  },
  {
    key: "residuo",
    label: "Residuo",
    defaultVisible: true,
    align: "right",
    sortAccessor: (o) => o.residuo,
    esporta: { tipo: "euro", totale: true, valore: (o) => o.residuo },
    render: (o) =>
      o.residuo < 0 ? (
        // Ordine pagato in eccesso: l'eccedenza (residuo negativo) è candidabile a un
        // rimborso "extra". La evidenziamo con un badge dedicato.
        <Tooltip label={`Pagato in eccesso di € ${centsToEurStr(-o.residuo)}: rimborsabile dal menu ⋯`} withArrow>
          <Badge variant="light" color="grape" className="tabular">
            Extra € {centsToEurStr(-o.residuo)}
          </Badge>
        </Tooltip>
      ) : (
        <Text size="sm" c={o.residuo > 0 ? "red" : "dimmed"} fw={o.residuo > 0 ? 600 : 400} className="tabular">
          € {centsToEurStr(o.residuo)}
        </Text>
      ),
  },
  {
    key: "statoPagamento",
    label: "Pagamento",
    width: 124,
    defaultVisible: false,
    sortAccessor: (o) => o.statoPagamento,
    esporta: { valore: (o) => statoPagDef(o.statoPagamento).label },
    render: (o) => {
      const d = statoPagDef(o.statoPagamento);
      return (
        <Tooltip label={d.label} withArrow>
          <span className="pt-pagamento-adattivo">
            <Badge variant="light" color={d.color} leftSection={<d.Ico size={12} />} aria-label={d.label}>
              <span className="pt-pagamento-adattivo-label">{d.label}</span>
            </Badge>
          </span>
        </Tooltip>
      );
    },
  },
  {
    key: "note",
    label: "Note",
    defaultVisible: false,
    sortAccessor: (o) => o.note,
    esporta: { valore: (o) => o.note },
    render: (o) =>
      o.note ? (
        <Text size="sm" truncate maw={200}>
          {o.note}
        </Text>
      ) : (
        "—"
      ),
  },
];

const STORAGE = "pt.giornaliero.colonne.v7";

type Salvato = StatoColonneConfigurabili;

function normalizzaColonneGiornaliero(salvato?: {
  ordine?: string[];
  nascoste?: string[];
}): Salvato {
  return normalizzaStatoColonne(COLONNE, salvato);
}

function resetColonneGiornaliero(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("giornaliero-v3-") && key.endsWith("-columns-width")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => {
    localStorage.removeItem(key);
  });
  resetLarghezzeTabella("giornaliero-v4");
  resetLarghezzeTabella("giornaliero-v5");
}

export function useColonneGiornaliero() {
  return useColonneConfigurabili(COLONNE, {
    storage: STORAGE,
    normalizza: normalizzaColonneGiornaliero,
    richiedeOrdineSalvato: true,
    onReset: resetColonneGiornaliero,
  });
}
