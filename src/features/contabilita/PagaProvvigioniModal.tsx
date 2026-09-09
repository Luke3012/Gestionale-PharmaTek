// Modale «Paga provvigioni» di un singolo agente (FASE 6): elenca gli ordini la cui
// provvigione è pagabile (maturati, e — se attivato — anche quelli col solo acconto
// incassato non ancora spediti), con selezione riga-per-riga e totale che si aggiorna
// in tempo reale. Al conferma crea un record `provv_pagamento` con lo snapshot degli
// importi: quegli ordini spariscono dalla schermata Provvigioni e finiscono nello storico.
import { useDeferredValue, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconCircleDashed,
  IconCoin,
  IconInfoCircle,
  IconSearch,
} from "@tabler/icons-react";
import { api, type ProvvigioneAgente } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { centsToEurStr } from "../../lib/money";
import { setConToggle } from "../../lib/set";
import type { PagamentoProvv } from "./provvigioniExport";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { Tabella, type DataTableColumn } from "../../ui/Tabella";
import { modalTableHeight } from "../../ui/modalTableHeight";
import { formattaDataItaliana, oggiIso } from "../../lib/date";

/** Sopra questa soglia di righe pagabili mostriamo anche la casella di ricerca. */
const SOGLIA_RICERCA = 8;

type RigaProvvigione = ProvvigioneAgente["ordini"][number];

export function PagaProvvigioniModal({
  agente,
  onClose,
  onPagato,
}: {
  /** Agente da saldare (con i suoi ordini dal report). `null` = chiuso. */
  agente: ProvvigioneAgente | null;
  onClose: () => void;
  /** Chiamato dopo un pagamento andato a buon fine (ricarica + offerta di export/stampa). */
  onPagato: (pagato: PagamentoProvv) => void;
}) {
  // Snapshot dell'agente: lo teniamo finché il modale è montato così la chiusura
  // animata non mostra un corpo vuoto (fetch-then-render).
  const [mostrato, clearMostrato] = useModalSnapshot(agente);

  return (
    <Modal
      opened={!!agente}
      onClose={onClose}
      size="xl"
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconCoin size={18} />
          </ThemeIcon>
          <Text fw={700}>Paga provvigioni — {mostrato?.agenteNome}</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: clearMostrato }}
    >
      {mostrato && <Corpo agente={mostrato} onClose={onClose} onPagato={onPagato} />}
    </Modal>
  );
}

function Corpo({
  agente,
  onClose,
  onPagato,
}: {
  agente: ProvvigioneAgente;
  onClose: () => void;
  onPagato: (pagato: PagamentoProvv) => void;
}) {
  const [includiAcconto, setIncludiAcconto] = useState(false);
  const [finoA, setFinoA] = useState("");
  const [query, setQuery] = useState("");
  const queryDifferita = useDeferredValue(query);
  // Ordini esclusi dal saldo (deselezionati): di default tutto è incluso.
  const [escluse, setEscluse] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  // Pagabili = maturati (sempre) + col solo acconto incassato (se lo switch è ON).
  const pagabili = useMemo(() => {
    return agente.ordini.filter(
      (o) => o.maturato || (includiAcconto && o.accontoIncassato)
    );
  }, [agente.ordini, includiAcconto]);

  // Applica i filtri (data ordine ≤ finoA, ricerca testuale) alle pagabili.
  const visibili = useMemo(() => {
    const q = queryDifferita.trim().toLowerCase();
    return pagabili.filter((o) => {
      if (finoA && o.data > finoA) return false;
      if (q && !`${o.numero} ${o.clienteNome}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pagabili, finoA, queryDifferita]);

  // Selezionati = visibili non esclusi. Le righe nascoste da un filtro non si pagano.
  const selezionati = useMemo(
    () => visibili.filter((o) => !escluse.has(o.ordineId)),
    [visibili, escluse]
  );
  const totale = useMemo(
    () => selezionati.reduce((s, o) => s + o.provvigione, 0),
    [selezionati]
  );

  const tutteSel = visibili.length > 0 && selezionati.length === visibili.length;
  const alcuneSel = selezionati.length > 0 && !tutteSel;

  function toggleRiga(id: string) {
    setEscluse((corrente) => setConToggle(corrente, id));
  }

  function toggleTutte() {
    // Se tutte le visibili sono selezionate → escludile tutte; altrimenti includi tutte.
    setEscluse((prev) => {
      const next = new Set(prev);
      if (tutteSel) {
        for (const o of visibili) next.add(o.ordineId);
      } else {
        for (const o of visibili) next.delete(o.ordineId);
      }
      return next;
    });
  }

  const columns = useMemo<DataTableColumn<RigaProvvigione>[]>(
    () => [
      {
        accessor: "__selezione",
        title: (
          <Checkbox
            aria-label="Seleziona tutte"
            checked={tutteSel}
            indeterminate={alcuneSel}
            onChange={toggleTutte}
          />
        ),
        width: 42,
        render: (o) => {
          const incluso = !escluse.has(o.ordineId);
          return (
            <Checkbox
              aria-label={`Includi ${o.numero}`}
              checked={incluso}
              onChange={() => toggleRiga(o.ordineId)}
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
      },
      {
        accessor: "numero",
        title: "N°",
        cellsClassName: "tabular",
        render: (o) => <span style={{ fontWeight: 600 }}>{o.numero}</span>,
      },
      { accessor: "data", title: "Data", cellsClassName: "tabular", render: (o) => formattaDataItaliana(o.data) },
      { accessor: "clienteNome", title: "Cliente", render: (o) => o.clienteNome || "—" },
      {
        accessor: "stato",
        title: "Stato",
        textAlign: "center",
        render: (o) =>
          o.maturato ? (
            <Badge color="teal" variant="light" leftSection={<IconCircleCheck size={12} />}>
              Maturato
            </Badge>
          ) : (
            <Badge color="orange" variant="light" leftSection={<IconCircleDashed size={12} />}>
              Solo acconto
            </Badge>
          ),
      },
      {
        accessor: "provvigione",
        title: "Provvigione",
        textAlign: "right",
        cellsClassName: "tabular",
        render: (o) => <span style={{ fontWeight: 600 }}>€ {centsToEurStr(o.provvigione)}</span>,
      },
    ],
    [alcuneSel, escluse, tutteSel, visibili]
  );

  async function conferma() {
    if (selezionati.length === 0) return;
    setSalvando(true);
    try {
      const data = oggiIso();
      const righe = selezionati.map((o) => ({
        ordineId: o.ordineId,
        numero: o.numero,
        data: o.data,
        clienteNome: o.clienteNome,
        base: o.base,
        provvigione: o.provvigione,
      }));
      await api.recordCreate("provv_pagamento", {
        agente_id: agente.agenteId,
        agente_nome: agente.agenteNome,
        data,
        totale,
        righe,
      });
      toast.success(
        `Provvigioni saldate: ${selezionati.length} ${
          selezionati.length === 1 ? "ordine" : "ordini"
        } · € ${centsToEurStr(totale)}`
      );
      onClose();
      onPagato({ agenteId: agente.agenteId, agenteNome: agente.agenteNome, data, righe });
    } catch (e) {
      toast.error(`Pagamento non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Box className="pt-modal-shell pt-modal-shell-table">
      <Box className="pt-modal-scroll">
        <Stack gap="md">
          {/* Filtri: fino-a-data + switch acconto + ricerca (solo se molti) */}
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              label="Paga fino a data ordine"
              type="date"
              value={finoA}
              onChange={(e) => setFinoA(e.currentTarget.value)}
              w={190}
            />
            <Switch
              label="Includi solo acconto (non spediti)"
              checked={includiAcconto}
              onChange={(e) => setIncludiAcconto(e.currentTarget.checked)}
              mb={6}
            />
            {pagabili.length > SOGLIA_RICERCA && (
              <DebouncedInput
                label="Cerca"
                placeholder="N° o cliente…"
                leftSection={<IconSearch size={15} />}
                value={query}
                onChange={setQuery}
                style={{ flex: 1, minWidth: 160 }}
              />
            )}
          </Group>

          {includiAcconto && (
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />} py="xs">
              <Text size="sm">
                Stai includendo ordini con il solo <b>acconto incassato</b>, non ancora spediti: la
                provvigione viene anticipata.
              </Text>
            </Alert>
          )}

          {visibili.length === 0 ? (
            <Box py="xl" ta="center">
              <ThemeIcon size={44} radius="xl" variant="light" color="gray" mx="auto" mb="xs">
                <IconCoin size={22} />
              </ThemeIcon>
              <Text c="dimmed" size="sm">
                Nessuna provvigione pagabile con i filtri scelti.
              </Text>
            </Box>
          ) : (
            <Tabella<RigaProvvigione>
              columns={columns}
              records={visibili}
              idAccessor="ordineId"
              storeColumnsKey="contabilita-paga-provvigioni"
              height={modalTableHeight(visibili.length, { min: 80, max: 680, viewportOffset: 340, maxVisibleRows: 15 })}
              onRowClick={({ record }) => toggleRiga(record.ordineId)}
              rowStyle={(o) => ({ cursor: "pointer", opacity: escluse.has(o.ordineId) ? 0.45 : 1 })}
              emptyState={<Box />}
            />
          )}
        </Stack>
      </Box>

      <div className="pt-modal-footer">
        <Box>
          <Text size="xs" c="dimmed">
            Da pagare ({selezionati.length} {selezionati.length === 1 ? "ordine" : "ordini"})
          </Text>
          <Text fw={700} fz="xl" className="tabular">
            € {centsToEurStr(totale)}
          </Text>
        </Box>
        <Group gap="sm">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          <Button
            color="accent"
            leftSection={<IconCoin size={16} />}
            disabled={selezionati.length === 0}
            loading={salvando}
            onClick={conferma}
          >
            Segna come pagate
          </Button>
        </Group>
      </div>
    </Box>
  );
}
