// Colonne configurabili della tabella Crediti (Contabilità → Crediti): definizioni
// + persistenza ordine/visibilità in localStorage, sullo stesso schema del Giornaliero
// (riusa ColonneMenu). La colonna "azione" (Salda / verifica) resta fissa a destra ed
// è gestita dalla vista, non qui.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Badge, Text } from "@mantine/core";
import type { PagamentoVista } from "../../lib/tauri";
import { oggiIso } from "../../lib/date";
import { centsToEurStr } from "../../lib/money";
import { tipoPagamentoLabel } from "./statiPagamento";
import type { MetaExport } from "../../ui/esporta/EsportaTabella";
import { resetLarghezzeTabella } from "../../ui/Tabella";
import { DataAdattiva } from "../../ui/DataAdattiva";
import { RiepilogoLink } from "../../shell/RiepilogoLink";

export interface ColDefCr {
  key: string;
  label: string;
  defaultVisible: boolean;
  align?: "right" | "center";
  render: (r: PagamentoVista) => ReactNode;
  sortAccessor?: (r: PagamentoVista) => string | number;
  /** Come la colonna finisce nell'export Excel (valore grezzo + tipo). */
  esporta?: MetaExport<PagamentoVista>;
}

/** Etichetta testuale dello stato (per l'export Excel). */
export function statoCreditoLabel(r: PagamentoVista): string {
  if (!r.saldato) return potenziale(r) ? "Potenziale" : scaduta(r) ? "Scaduto" : "Atteso";
  return r.verificato ? "Saldato" : "Da verificare";
}

// Un credito è "potenziale" finché l'ordine è un preventivo non accettato (Nuovo);
// diventa "atteso" reale quando l'ordine è impegnato (≥ Confermato: acconto dato o stato
// avanzato). I Rifiutati sono già esclusi dalla vista lato backend.
export function potenziale(r: PagamentoVista): boolean {
  return !r.saldato && r.ordineStato === "Nuovo";
}

// Scaduto solo per i crediti ATTESI reali: un preventivo (potenziale) non "scade".
export function scaduta(r: PagamentoVista): boolean {
  return !r.saldato && !potenziale(r) && !!r.scadenza && r.scadenza <= oggiIso();
}

/** Badge dello stato di un pagamento (potenziale / atteso / da verificare / saldato). */
export function StatoBadge({ r }: { r: PagamentoVista }) {
  if (!r.saldato) {
    if (potenziale(r)) {
      return (
        <Badge variant="light" color="gray">
          Potenziale
        </Badge>
      );
    }
    const sc = scaduta(r);
    return (
      <Badge variant="light" color={sc ? "red" : "blue"}>
        {sc ? "Scaduto" : "Atteso"}
      </Badge>
    );
  }
  if (!r.verificato) {
    return (
      <Badge variant="light" color="lime">
        Da verificare
      </Badge>
    );
  }
  return (
    <Badge variant="light" color="teal">
      Saldato
    </Badge>
  );
}

export const COLONNE_CREDITI: ColDefCr[] = [
  { key: "ordine", label: "N°", defaultVisible: true, sortAccessor: (r) => r.ordineNumero, esporta: { valore: (r) => r.ordineNumero }, render: (r) => <span className="tabular" style={{ fontWeight: 600 }}>{r.ordineNumero || "—"}</span> },
  {
    key: "scadenza",
    label: "Scadenza",
    defaultVisible: true,
    sortAccessor: (r) => r.scadenza || "9999",
    esporta: { tipo: "data", valore: (r) => r.scadenza },
    render: (r) =>
      r.scadenza ? (
        <Text size="sm" className="tabular" c={scaduta(r) ? "red" : undefined} fw={scaduta(r) ? 600 : undefined}>
          <DataAdattiva iso={r.scadenza} />
        </Text>
      ) : (
        <Text size="sm" c="dimmed">—</Text>
      ),
  },
  {
    key: "incasso",
    label: "Incasso",
    defaultVisible: false,
    sortAccessor: (r) => r.data || "",
    esporta: { tipo: "data", valore: (r) => r.data },
    render: (r) => <DataAdattiva iso={r.data} />,
  },
  { key: "cliente", label: "Cliente", defaultVisible: true, sortAccessor: (r) => r.clienteNome, esporta: { valore: (r) => r.clienteNome }, render: (r) => <RiepilogoLink tipo="cliente" id={r.clienteId} nome={r.clienteNome} /> },
  { key: "medico", label: "Medico", defaultVisible: false, sortAccessor: (r) => r.medicoNome, esporta: { valore: (r) => r.medicoNome }, render: (r) => <RiepilogoLink tipo="medico" id={r.medicoId} nome={r.medicoNome} /> },
  { key: "agente", label: "Agente", defaultVisible: false, sortAccessor: (r) => r.agenteNome, esporta: { valore: (r) => r.agenteNome }, render: (r) => <RiepilogoLink tipo="agente" id={r.agenteId} nome={r.agenteNome} /> },
  {
    key: "tipo",
    label: "Tipo",
    defaultVisible: true,
    sortAccessor: (r) => r.tipo,
    esporta: { valore: (r) => tipoPagamentoLabel(r.tipo) },
    render: (r) => (
      <Badge variant="light" color="gray">
        {tipoPagamentoLabel(r.tipo)}
      </Badge>
    ),
  },
  {
    key: "conto",
    label: "Conto",
    defaultVisible: false,
    sortAccessor: (r) => r.contoNome,
    esporta: { valore: (r) => (r.contoAccreditoNome ? `${r.contoNome} → ${r.contoAccreditoNome}` : r.contoNome) },
    // Per i contrassegni/assegni accreditati da una distinta mostra anche il conto
    // reale dove sono finiti i soldi (il "mezzo" resta, ma si vede la destinazione).
    render: (r) =>
      r.contoAccreditoNome ? (
        <Text size="sm">
          {r.contoNome} <Text span c="dimmed">→ {r.contoAccreditoNome}</Text>
        </Text>
      ) : (
        r.contoNome || "—"
      ),
  },
  {
    key: "importo",
    label: "Importo",
    defaultVisible: true,
    align: "right",
    sortAccessor: (r) => r.importo,
    esporta: { tipo: "euro", totale: true, valore: (r) => r.importo },
    render: (r) => <span className="tabular" style={{ fontWeight: 600 }}>€ {centsToEurStr(r.importo)}</span>,
  },
  {
    key: "stato",
    label: "Stato",
    align: "center",
    defaultVisible: true,
    // Ordine "da scaduto a saldato" (default Crediti): scaduto → atteso → potenziale →
    // da verificare → saldato. I più urgenti (scaduti) in cima.
    sortAccessor: (r) =>
      r.saldato ? (r.verificato ? 4 : 3) : scaduta(r) ? 0 : potenziale(r) ? 2 : 1,
    esporta: { valore: (r) => statoCreditoLabel(r) },
    render: (r) => <StatoBadge r={r} />,
  },
];

const DEFS = new Map(COLONNE_CREDITI.map((c) => [c.key, c]));
const STORAGE = "pt.crediti.colonne.v1";
const PRIME_DEFAULT = ["ordine", "stato"];

interface Salvato {
  ordine: string[];
  nascoste: string[];
}

function predefinito(): Salvato {
  const resto = COLONNE_CREDITI.map((c) => c.key).filter((k) => !PRIME_DEFAULT.includes(k));
  return {
    ordine: [...PRIME_DEFAULT, ...resto],
    nascoste: COLONNE_CREDITI.filter((c) => !c.defaultVisible).map((c) => c.key),
  };
}

function carica(): Salvato {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const s = JSON.parse(raw) as Salvato;
      const viste = new Set(s.ordine);
      // Colonne nuove (aggiunte dopo che l'utente ha salvato): in coda all'ordine e,
      // se non visibili di default (es. Medico), già nascoste — niente reset delle preferenze.
      const nuove = COLONNE_CREDITI.filter((c) => !viste.has(c.key));
      const ordine = [...s.ordine.filter((k) => DEFS.has(k)), ...nuove.map((c) => c.key)];
      const nascoste = [
        ...(s.nascoste || []).filter((k) => DEFS.has(k)),
        ...nuove.filter((c) => !c.defaultVisible).map((c) => c.key),
      ];
      return { ordine, nascoste };
    }
  } catch {
    /* fallback */
  }
  return predefinito();
}

export interface VoceColonnaCr {
  def: ColDefCr;
  visibile: boolean;
}

export function useColonneCrediti() {
  const [stato, setStato] = useState<Salvato>(carica);
  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify(stato));
  }, [stato]);

  const nascoste = useMemo(() => new Set(stato.nascoste), [stato.nascoste]);

  const visibili = useMemo<ColDefCr[]>(
    () => stato.ordine.map((k) => DEFS.get(k)).filter((c): c is ColDefCr => !!c && !nascoste.has(c.key)),
    [stato.ordine, nascoste]
  );

  const tutte = useMemo<VoceColonnaCr[]>(
    () =>
      stato.ordine
        .map((k) => DEFS.get(k))
        .filter((c): c is ColDefCr => !!c)
        .map((def) => ({ def, visibile: !nascoste.has(def.key) })),
    [stato.ordine, nascoste]
  );

  const riordina = useCallback((keys: string[]) => setStato((s) => ({ ...s, ordine: keys })), []);
  const toggle = useCallback(
    (key: string) =>
      setStato((s) => {
        const n = new Set(s.nascoste);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return { ...s, nascoste: [...n] };
      }),
    []
  );
  const reset = useCallback(() => {
    setStato(predefinito());
    resetLarghezzeTabella("contabilita-crediti");
    resetLarghezzeTabella("contabilita-crediti-v2");
    resetLarghezzeTabella("contabilita-crediti-v3");
  }, []);

  return { visibili, tutte, ordineKeys: stato.ordine, riordina, toggle, reset };
}
