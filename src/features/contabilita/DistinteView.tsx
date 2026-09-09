// Tab "Distinte Corrieri" (FASE 3C): elenco dei bonifici cumulativi con cui i corrieri
// (o i versamenti assegni) accreditano i contrassegni/assegni sul conto reale. Da qui si
// crea una nuova distinta (spuntando i pagamenti coperti) e si apre il dettaglio di una
// distinta esistente (pagamenti coperti) con possibilità di eliminarla → i pagamenti
// tornano "in attesa di accredito".
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Group, Modal, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconPlus, IconSearch, IconTrash, IconTruckDelivery } from "@tabler/icons-react";
import { api, type ContrassegnoAperto, type Distinta } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { centsToEurStr } from "../../lib/money";
import { Tabella, type DataTableColumn, type DataTableSortStatus } from "../../ui/Tabella";
import { usePaginaPronta } from "../../pages/Pagina";
import { DistintaModal } from "./DistintaModal";
import { usePrefs } from "../../lib/prefs";
import { modalTableHeight } from "../../ui/modalTableHeight";
import { VistaTabellaParallela } from "../../ui/VistaTabellaParallela";
import { formattaDataItaliana } from "../../lib/date";
import { DataAdattiva } from "../../ui/DataAdattiva";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { ordinaCopia } from "../../ui/ordinamento";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { StatoVuotoContabilita, useListaContabilita } from "./listaContabilita";

const EVENTI_RICARICA = [
  "distinta:salvato",
  "pagamento:salvato",
  "corriere:salvato",
  "conto:salvato",
] as const;
const GETTER_ORDINAMENTO: Record<string, (distinta: Distinta) => string | number> = {
  importo: (distinta) => distinta.importo,
  corriereNome: (distinta) => distinta.corriereNome,
  contoNome: (distinta) => distinta.contoNome,
  dataDistinta: (distinta) => distinta.dataDistinta,
  dataAccredito: (distinta) => distinta.dataAccredito,
};

export interface FiltroDistinteIniziale {
  nonce: number;
  cerca: string;
}

export function DistinteView({
  filtroIniziale,
  apriNuova = 0,
  attiva = true,
}: {
  filtroIniziale?: FiltroDistinteIniziale;
  apriNuova?: number;
  attiva?: boolean;
}) {
  const { anno, ridurreAnimazioni } = usePrefs();
  const { righe, caricamento, carica } = useListaContabilita(api.distinteLista, "Caricamento distinte non riuscito");
  const [cerca, setCerca] = useState("");
  const [nuova, setNuova] = useState(false);
  const [dettaglio, setDettaglio] = useState<Distinta | null>(null);
  const [sort, setSort] = useState<DataTableSortStatus<Distinta>>({
    columnAccessor: "dataAccredito",
    direction: "desc",
  });
  const cercaDifferita = useDeferredValue(cerca);
  usePaginaPronta(caricamento);
  useRicaricaSuEventi(EVENTI_RICARICA, () => carica(true), 180);

  // Deep-link da Spotlight (ricerca corriere/distinta → filtra su quel corriere).
  useEffect(() => {
    if (filtroIniziale) setCerca(filtroIniziale.cerca);
  }, [filtroIniziale]);

  // Comando «Nuova distinta corriere» dalla ricerca globale → apre la modale.
  useEffect(() => {
    if (apriNuova > 0) setNuova(true);
  }, [apriNuova]);

  const filtrate = useMemo(() => {
    const termini = cercaDifferita.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return righe.filter((d) => {
      // Filtro anno sulla data di creazione della distinta
      if (anno !== 0 && Number(d.dataDistinta.slice(0, 4)) !== anno) return false;
      const blob = `${d.corriereNome} ${d.dataDistinta} ${formattaDataItaliana(d.dataDistinta, "")} ${d.dataAccredito} ${formattaDataItaliana(d.dataAccredito, "")}`.toLowerCase();
      if (!termini.every((termine) => blob.includes(termine))) return false;
      return true;
    });
  }, [righe, cercaDifferita, anno]);

  const totale = useMemo(() => filtrate.reduce((s, r) => s + r.importo, 0), [filtrate]);

  const ordinate = useMemo(() => {
    const get = GETTER_ORDINAMENTO[sort.columnAccessor] ?? GETTER_ORDINAMENTO.dataAccredito;
    return ordinaCopia(filtrate, get, sort.direction);
  }, [filtrate, sort]);

// Impaginazione: sostituita da Cluster Virtualization in Tabella.tsx


  const columns = useMemo<DataTableColumn<Distinta>[]>(
    () => [
      {
        accessor: "corriereNome",
        title: "Corriere",
        sortable: true,
        resizable: true,
        render: (d) =>
          d.corriereNome ? (
            d.corriereNome
          ) : (
            <Text c="dimmed" fs="italic" size="sm">
              Versamento assegni
            </Text>
          ),
      },
      { accessor: "dataDistinta", title: "Data distinta", sortable: true, resizable: true, render: (d) => <DataAdattiva iso={d.dataDistinta} /> },
      { accessor: "dataAccredito", title: "Data accredito", sortable: true, resizable: true, render: (d) => <DataAdattiva iso={d.dataAccredito} /> },
      { accessor: "contoNome", title: "Conto", sortable: true, resizable: true, render: (d) => d.contoNome || "—" },
      {
        accessor: "nPagamenti",
        title: "Pagamenti",
        textAlign: "center",
        resizable: true,
        render: (d) => (
          <Badge size="sm" variant="light" color="cyan">
            {d.nPagamenti}
          </Badge>
        ),
      },
      {
        accessor: "importo",
        title: "Importo",
        textAlign: "right",
        sortable: true,
        resizable: true,
        render: (d) => <span className="tabular">€ {centsToEurStr(d.importo)}</span>,
      },
    ],
    []
  );

  const tabella = useMemo(
    () => (
      <Tabella<Distinta>
        height="100%"
        columns={columns}
        records={ordinate}
        caricamentoIniziale={caricamento}
        ridimensionamentoSenzaSfumaturaKey={cercaDifferita}
        idAccessor="id"
        storeColumnsKey="contabilita-distinte"
        sortStatus={sort}
        onSortStatusChange={setSort}
        onRowClick={({ record }) => setDettaglio(record)}
        rowStyle={() => ({ cursor: "pointer" })}
        emptyState={
          caricamento ? (
            <Box />
          ) : (
            <StatoVuotoContabilita icona={<IconTruckDelivery size={24} />}>
              <Text c="dimmed" size="sm" fw={600}>
                Nessuna distinta presente.
              </Text>
              <Text c="dimmed" size="xs">
                Quando un corriere versa il bonifico cumulativo dei contrassegni, crea una distinta
                e spunta gli ordini coperti per accreditarli sul conto reale.
              </Text>
            </StatoVuotoContabilita>
          )
        }
      />
  ),
    [caricamento, cercaDifferita, columns, ordinate, sort]
  );

  return (
    <VistaTabellaParallela
      nascosta={!attiva || (caricamento && righe.length === 0)}
      ridurreAnimazioni={ridurreAnimazioni}
    >
      <Group justify="space-between" align="center">
        <Group gap="sm" wrap="nowrap">
          <Button leftSection={<IconPlus size={16} />} color="accent" onClick={() => setNuova(true)}>
            Nuova distinta
          </Button>
          <DebouncedInput
            placeholder="Cerca corriere o data…"
            leftSection={<IconSearch size={16} />}
            value={cerca}
            onChange={setCerca}
            w={260}
          />
        </Group>
        <Box>
          <Text size="xs" c="dimmed" ta="right">
            Totale accreditato
          </Text>
          <Text fw={700} c="teal" className="tabular" ta="right">
            € {centsToEurStr(totale)}
          </Text>
        </Box>
      </Group>

      <Box style={{ flex: 1, minHeight: 0 }}>
        {tabella}
      </Box>

      <DistintaModal
        opened={nuova}
        onClose={() => setNuova(false)}
        onSaved={() => {
          setNuova(false);
          carica();
        }}
      />

      <DettaglioModal
        distinta={dettaglio}
        onClose={() => setDettaglio(null)}
        onEliminata={() => {
          setDettaglio(null);
          carica();
        }}
      />
    </VistaTabellaParallela>
  );
}

function DettaglioModal({
  distinta,
  onClose,
  onEliminata,
}: {
  distinta: Distinta | null;
  onClose: () => void;
  onEliminata: () => void;
}) {
  const [righe, setRighe] = useState<ContrassegnoAperto[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [eliminando, setEliminando] = useState(false);
  const [mostrato] = useModalSnapshot(distinta);

  useEffect(() => {
    if (!distinta) return;
    setCaricamento(true);
    api
      .distintaRighe(distinta.id)
      .then(setRighe)
      .catch((e) => toast.error(`Caricamento dettaglio non riuscito: ${e}`))
      .finally(() => setCaricamento(false));
  }, [distinta]);

  async function elimina() {
    if (!mostrato) return;
    const ok = await dialog.confirmDanger(
      "Eliminare la distinta?",
      `I ${mostrato.nPagamenti} pagamenti coperti torneranno "in attesa di accredito" (il loro stato tornerà a contrassegno/assegno non ancora versato).`
    );
    if (!ok) return;
    setEliminando(true);
    try {
      await api.distintaElimina(mostrato.id);
      toast.success("Distinta eliminata.");
      onEliminata();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
    } finally {
      setEliminando(false);
    }
  }

  const columns = useMemo<DataTableColumn<ContrassegnoAperto>[]>(
    () => [
      { accessor: "ordineNumero", title: "Ordine", render: (r) => r.ordineNumero || "—" },
      { accessor: "clienteNome", title: "Cliente", render: (r) => r.clienteNome || "—" },
      {
        accessor: "contoTipo",
        title: "Mezzo",
        render: (r) => (
          <Badge size="xs" variant="light" color={r.contoTipo === "assegno" ? "grape" : "cyan"}>
            {r.contoTipo === "assegno" ? "Assegno" : "Contrassegno"}
          </Badge>
        ),
      },
      { accessor: "data", title: "Data", cellsClassName: "tabular", render: (r) => <DataAdattiva iso={r.data} /> },
      {
        accessor: "importo",
        title: "Importo",
        textAlign: "right",
        cellsClassName: "tabular",
        render: (r) => `€ ${centsToEurStr(r.importo)}`,
      },
    ],
    []
  );

  return (
    <Modal
      opened={!!distinta}
      onClose={onClose}
      size="lg"
      zIndex={1300}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconTruckDelivery size={18} />
          </ThemeIcon>
          <Text fw={700}>Distinta {mostrato?.corriereNome || "(versamento assegni)"}</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180 }}
    >
      {mostrato && (
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="sm">
              <Group gap="xl">
                <Info etichetta="Data distinta" valore={formattaDataItaliana(mostrato.dataDistinta)} />
                <Info etichetta="Data accredito" valore={formattaDataItaliana(mostrato.dataAccredito)} />
                <Info etichetta="Conto reale" valore={mostrato.contoNome || "—"} />
                <Info etichetta="Importo" valore={`€ ${centsToEurStr(mostrato.importo)}`} />
              </Group>

              <Box style={{ height: modalTableHeight(righe.length, { max: 360 }) }}>
                <Tabella<ContrassegnoAperto>
                  height="100%"
                  columns={columns}
                  records={caricamento ? [] : righe}
                  caricamentoIniziale={caricamento}
                  idAccessor="id"
                  storeColumnsKey="contabilita-distinta-dettaglio"
                  emptyState={caricamento ? <Box /> : <Text size="sm" c="dimmed" py="md" ta="center">Nessun pagamento nella distinta.</Text>}
                />
              </Box>
            </Stack>
          </Box>

          <div className="pt-modal-footer">
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={elimina}
              loading={eliminando}
            >
              Elimina distinta
            </Button>
            <Button variant="default" onClick={onClose}>
              Chiudi
            </Button>
          </div>
        </Box>
      )}
    </Modal>
  );
}

function Info({ etichetta, valore }: { etichetta: string; valore: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed">
        {etichetta}
      </Text>
      <Text fw={600} size="sm" className="tabular">
        {valore}
      </Text>
    </Box>
  );
}
