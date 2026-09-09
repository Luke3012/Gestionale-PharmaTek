// Tab "Rimborsi" (FASE 3D): elenco dei rimborsi (denaro in uscita), con stato derivato
// richiesto/effettuato. Da qui si crea un nuovo rimborso (manuale o "extra" collegato a
// un ordine pagato in eccesso), si apre il dettaglio/modifica e si segna un rimborso come
// effettuato. Banda totali Richiesto/Effettuato in stile Provvigioni/Crediti.
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  Group,
  MultiSelect,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconCircleCheck, IconPlus, IconReceiptRefund } from "@tabler/icons-react";
import { api, type Rimborso } from "../../lib/tauri";
import { centsToEurStr } from "../../lib/money";
import { Tabella, type DataTableColumn, type DataTableSortStatus } from "../../ui/Tabella";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { usePaginaPronta } from "../../pages/Pagina";
import { usePrefs } from "../../lib/prefs";
import { EsportaTabella, type ColonnaExport } from "../../ui/esporta/EsportaTabella";
import { STATI_RIMBORSO, statoRimborsoDef, origineRimborsoLabel } from "./statiRimborso";
import { RimborsoModal, SegnaEffettuatoModal, type RimborsoModalTarget } from "./RimborsoModal";
import { VistaTabellaParallela } from "../../ui/VistaTabellaParallela";
import { DataAdattiva } from "../../ui/DataAdattiva";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { RiepilogoLink } from "../../shell/RiepilogoLink";
import { ordinaCopia } from "../../ui/ordinamento";
import { BadgeStatoAdattivo } from "../../ui/BadgeStato";
import { FiltroIntervalloDate } from "../../ui/FiltroIntervalloDate";
import { StatoVuotoContabilita, useListaContabilita } from "./listaContabilita";

const STATI_FILTRO = STATI_RIMBORSO.map((s) => ({ value: s.value, label: s.label }));
const ORIGINI_FILTRO = [
  { value: "manuale", label: "Manuali" },
  { value: "extra", label: "Eccesso (extra)" },
];
const EVENTI_RICARICA = [
  "rimborso:salvato",
  "ordine:salvato",
  "pagamento:salvato",
  "cliente:salvato",
  "conto:salvato",
] as const;
const GETTER_ORDINAMENTO: Record<string, (rimborso: Rimborso) => string | number> = {
  importo: (rimborso) => rimborso.importo,
  ragioneSociale: (rimborso) => rimborso.ragioneSociale,
  stato: (rimborso) => rimborso.stato,
  dataRimborso: (rimborso) => rimborso.dataRimborso,
  dataRichiesta: (rimborso) => rimborso.dataRichiesta,
};

/** Etichetta dell'origine per tabella/export (con n° ordine se "extra"). */
function origineTesto(r: Rimborso): string {
  if (r.origine === "extra") return r.ordineNumero ? `Eccesso · ${r.ordineNumero}` : "Eccesso";
  return origineRimborsoLabel(r.origine);
}

/** Colonne esportabili dei Rimborsi (fisse: questa vista non ha config colonne). */
const COLONNE_EXPORT: ColonnaExport<Rimborso>[] = [
  { key: "dataRichiesta", label: "Data richiesta", tipo: "data", valore: (r) => r.dataRichiesta },
  { key: "ragioneSociale", label: "Ragione sociale", valore: (r) => r.ragioneSociale },
  { key: "motivo", label: "Motivo", valore: (r) => r.motivo },
  { key: "origine", label: "Origine", valore: (r) => origineTesto(r) },
  { key: "importo", label: "Importo", tipo: "euro", totale: true, valore: (r) => r.importo },
  { key: "stato", label: "Stato", valore: (r) => statoRimborsoDef(r.stato).label },
  { key: "dataRimborso", label: "Data rimborso", tipo: "data", valore: (r) => r.dataRimborso },
  { key: "iban", label: "IBAN", valore: (r) => r.iban, preSel: false },
  { key: "conto", label: "Conto", valore: (r) => r.contoNome, preSel: false },
];

export interface FiltroRimborsiIniziale {
  nonce: number;
  stati?: string[];
  origini?: string[];
  dal?: string;
  al?: string;
}

export function RimborsiView({
  apriNuovo = 0,
  filtroIniziale,
  attiva = true,
}: {
  apriNuovo?: number;
  filtroIniziale?: FiltroRimborsiIniziale;
  attiva?: boolean;
} = {}) {
  const { anno, ridurreAnimazioni } = usePrefs();
  const { righe, caricamento, carica } = useListaContabilita(api.rimborsiLista, "Caricamento rimborsi non riuscito");
  const [statiSel, setStatiSel] = useState<string[]>([]);
  const [originiSel, setOriginiSel] = useState<string[]>([]);
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [target, setTarget] = useState<RimborsoModalTarget | null>(null);
  const [effettuaTarget, setEffettuaTarget] = useState<Rimborso | null>(null);
  const [sort, setSort] = useState<DataTableSortStatus<Rimborso>>({
    columnAccessor: "dataRichiesta",
    direction: "desc",
  });
  usePaginaPronta(caricamento);
  useRicaricaSuEventi(EVENTI_RICARICA, () => carica(true), 180);

  // Comando «Nuovo rimborso» dalla ricerca globale → apre la modale di creazione.
  useEffect(() => {
    if (apriNuovo > 0) setTarget({});
  }, [apriNuovo]);

  useEffect(() => {
    if (!filtroIniziale) return;
    setStatiSel(filtroIniziale.stati ?? []);
    setOriginiSel(filtroIniziale.origini ?? []);
    setDal(filtroIniziale.dal ?? "");
    setAl(filtroIniziale.al ?? "");
  }, [filtroIniziale]);

  const statiSet = useMemo(() => new Set(statiSel), [statiSel]);
  const originiSet = useMemo(() => new Set(originiSel), [originiSel]);

  // Filtri client-side: stato (multi), periodo sulla data richiesta.
  const filtrate = useMemo(
    () =>
      righe.filter((r) => {
        // Filtro anno sulla data di richiesta
        if (anno !== 0 && (!r.dataRichiesta || Number(r.dataRichiesta.slice(0, 4)) !== anno)) return false;
        
        if (statiSet.size > 0 && !statiSet.has(r.stato)) return false;
        if (originiSet.size > 0 && !originiSet.has(r.origine)) return false;
        if (dal && (!r.dataRichiesta || r.dataRichiesta < dal)) return false;
        if (al && (!r.dataRichiesta || r.dataRichiesta > al)) return false;
        return true;
      }),
    [righe, statiSet, originiSet, dal, al, anno]
  );

  const ordinate = useMemo(() => {
    const get = GETTER_ORDINAMENTO[sort.columnAccessor] ?? GETTER_ORDINAMENTO.dataRichiesta;
    return ordinaCopia(filtrate, get, sort.direction);
  }, [filtrate, sort]);

// Impaginazione: sostituita da Cluster Virtualization in Tabella.tsx


  const totali = useMemo(() => {
    let richiesto = 0;
    let effettuato = 0;
    for (const r of filtrate) {
      if (r.stato === "richiesto") richiesto += r.importo;
      else if (r.stato === "effettuato") effettuato += r.importo;
    }
    return { richiesto, effettuato };
  }, [filtrate]);

  // Filtri attivi (badge popover) + reset complessivo.
  const nFiltri =
    (statiSel.length > 0 ? 1 : 0) +
    (originiSel.length > 0 ? 1 : 0) +
    (dal ? 1 : 0) +
    (al ? 1 : 0);

  function azzeraFiltri() {
    setStatiSel([]);
    setOriginiSel([]);
    setDal("");
    setAl("");
  }

  const columns = useMemo<DataTableColumn<Rimborso>[]>(
    () => [
      {
        accessor: "dataRichiesta",
        title: "Data richiesta",
        sortable: true,
        resizable: true,
        render: (r) => <DataAdattiva iso={r.dataRichiesta} />,
      },
      {
        accessor: "ragioneSociale",
        title: "Ragione sociale",
        sortable: true,
        resizable: true,
        render: (r) => r.clienteId
          ? <RiepilogoLink tipo="cliente" id={r.clienteId} nome={r.ragioneSociale} />
          : r.ragioneSociale || "—",
      },
      { accessor: "motivo", title: "Motivo", resizable: true, render: (r) => r.motivo || "—" },
      {
        accessor: "importo",
        title: "Importo",
        textAlign: "right",
        sortable: true,
        resizable: true,
        render: (r) => <span className="tabular">€ {centsToEurStr(r.importo)}</span>,
      },
      {
        accessor: "stato",
        title: "Stato",
        textAlign: "center",
        sortable: true,
        resizable: true,
        render: (r) => {
          const d = statoRimborsoDef(r.stato);
          return <BadgeStatoAdattivo definizione={d} />;
        },
      },
      {
        accessor: "dataRimborso",
        title: "Data rimborso",
        sortable: true,
        resizable: true,
        render: (r) => <DataAdattiva iso={r.dataRimborso} />,
      },
      {
        accessor: "azione",
        title: "",
        width: 150,
        textAlign: "center",
        render: (r) =>
          r.stato === "richiesto" ? (
            <Group justify="center" gap={4} onClick={(e) => e.stopPropagation()}>
              <Button
                size="compact-xs"
                variant="light"
                color="teal"
                leftSection={<IconCircleCheck size={14} />}
                onClick={() => setEffettuaTarget(r)}
              >
                Effettuato
              </Button>
            </Group>
          ) : null,
      },
    ],
    []
  );

  const tabella = useMemo(
    () => (
      <Tabella<Rimborso>
        height="100%"
        columns={columns}
        records={ordinate}
        caricamentoIniziale={caricamento}
        idAccessor="id"
        storeColumnsKey="contabilita-rimborsi"
        sortStatus={sort}
        onSortStatusChange={setSort}
        onRowClick={({ record }) => setTarget({ rimborso: record })}
        rowStyle={() => ({ cursor: "pointer" })}
        emptyState={
          caricamento ? (
            <Box />
          ) : (
            <StatoVuotoContabilita icona={<IconReceiptRefund size={24} />}>
              <Text c="dimmed" size="sm">
                Nessun rimborso. Crea un rimborso manuale o, da un ordine pagato in eccesso, usa
                «Rimborsa extra» per generarlo con importo e dati già compilati.
              </Text>
            </StatoVuotoContabilita>
          )
        }
      />
  ),
    [caricamento, columns, ordinate, sort]
  );

  return (
    <VistaTabellaParallela
      nascosta={!attiva || (caricamento && righe.length === 0)}
      ridurreAnimazioni={ridurreAnimazioni}
    >
      <Group gap="sm" wrap="nowrap" align="flex-end">
        <Button leftSection={<IconPlus size={16} />} color="accent" onClick={() => setTarget({})}>
          Nuovo rimborso
        </Button>
        <FiltriPopover
          attivi={nFiltri}
          onAzzera={azzeraFiltri}
          width={300}
          filtri={[
            {
              chiave: "stato",
              larghezza: 180,
              nodo: (
                <MultiSelect
                  label="Stato"
                  placeholder={statiSel.length ? "" : "Tutti"}
                  data={STATI_FILTRO}
                  value={statiSel}
                  onChange={setStatiSel}
                  clearable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "origine",
              larghezza: 180,
              nodo: (
                <MultiSelect
                  label="Origine"
                  placeholder={originiSel.length ? "" : "Tutte"}
                  data={ORIGINI_FILTRO}
                  value={originiSel}
                  onChange={setOriginiSel}
                  clearable
                  comboboxProps={{ withinPortal: false }}
                />
              ),
            },
            {
              chiave: "periodo",
              larghezza: 260,
              nodo: (
                <FiltroIntervalloDate dal={dal} al={al} onDalChange={setDal} onAlChange={setAl} />
              ),
            },
          ]}
        />
        <EsportaTabella nomeBase="rimborsi" foglio="Rimborsi" titolo="Rimborsi" colonne={COLONNE_EXPORT} righe={ordinate} />
      </Group>

      <Card withBorder radius="md" p="md" bg="var(--bg)">
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <ThemeIcon size={40} radius="md" variant="light" color="orange">
              <IconReceiptRefund size={22} />
            </ThemeIcon>
            <Box>
              <Text size="xs" c="dimmed">
                Da rimborsare (richiesti)
              </Text>
              <Text fw={700} fz={24} c="orange" className="tabular">
                € {centsToEurStr(totali.richiesto)}
              </Text>
            </Box>
          </Group>
          <Box ta="right">
            <Text size="xs" c="dimmed">
              Rimborsato (effettuati)
            </Text>
            <Text fw={700} fz="lg" c="teal" className="tabular">
              € {centsToEurStr(totali.effettuato)}
            </Text>
          </Box>
        </Group>
      </Card>

      <Box style={{ flex: 1, minHeight: 0 }}>
        {tabella}
      </Box>

      <RimborsoModal
        target={target}
        onClose={() => setTarget(null)}
        onChanged={() => {
          setTarget(null);
          carica();
        }}
      />
      <SegnaEffettuatoModal
        rimborso={effettuaTarget}
        onClose={() => setEffettuaTarget(null)}
        onDone={() => {
          setEffettuaTarget(null);
          carica();
        }}
      />
    </VistaTabellaParallela>
  );
}
