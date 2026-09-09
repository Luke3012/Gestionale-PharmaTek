// Modale «Storico provvigioni» di un agente (FASE 6): elenca i pagamenti provvigione
// già registrati (record `provv_pagamento`), dal più recente. Ogni voce è espandibile
// per vedere gli ordini saldati con gli importi **congelati** al momento del pagamento,
// e può essere annullata: gli ordini tornano allora pagabili nella schermata Provvigioni.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconCoin,
  IconFileExport,
  IconTrash,
} from "@tabler/icons-react";
import { api, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { centsToEurStr } from "../../lib/money";
import type { PagamentoProvv } from "./provvigioniExport";
import { usePrefs } from "../../lib/prefs";
import { VirtualStack } from "../../ui/VirtualStack";
import { Tabella, type DataTableColumn } from "../../ui/Tabella";
import { modalTableHeight } from "../../ui/modalTableHeight";
import { formattaDataItaliana } from "../../lib/date";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { FooterAzioniModale } from "../../ui/FooterAzioniModale";

const EVENTI_RICARICA = ["provv_pagamento:salvato"] as const;

interface RigaPag {
  ordineId: string;
  numero: string;
  data: string;
  clienteNome: string;
  base: number;
  provvigione: number;
}

interface Pagamento {
  id: string;
  data: string;
  totale: number;
  righe: RigaPag[];
}

function n(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Estrae i pagamenti di un agente dai record grezzi, dal più recente. */
function parse(records: RecordDto[], agenteId: string): Pagamento[] {
  return records
    .filter((r) => s(r.data.agente_id) === agenteId)
    .map((r) => {
      const righeRaw = Array.isArray(r.data.righe) ? (r.data.righe as Record<string, unknown>[]) : [];
      return {
        id: r.id,
        data: s(r.data.data),
        totale: n(r.data.totale),
        righe: righeRaw.map((rg) => ({
          ordineId: s(rg.ordineId),
          numero: s(rg.numero),
          data: s(rg.data),
          clienteNome: s(rg.clienteNome),
          base: n(rg.base),
          provvigione: n(rg.provvigione),
        })),
      };
    })
    .sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id));
}

export function StoricoProvvigioniModal({
  agenteId,
  agenteNome,
  onClose,
  onAnnullato,
  onEsporta,
  bloccaChiusura,
}: {
  /** Agente di cui mostrare lo storico. `null` = chiuso. */
  agenteId: string | null;
  agenteNome: string;
  onClose: () => void;
  /** Chiamato dopo l'annullamento di un pagamento (per ricaricare il report). */
  onAnnullato: () => void;
  /** Apre l'export/stampa di un pagamento (le righe congelate di quella voce). */
  onEsporta: (pagato: PagamentoProvv) => void;
  bloccaChiusura?: boolean;
}) {
  const { anno } = usePrefs();
  const [pagamenti, setPagamenti] = useState<Pagamento[] | null>(null);
  const [aperto, setAperto] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!agenteId) return;
    try {
      const records = await api.recordsList("provv_pagamento");
      const completi = parse(records, agenteId);
      setPagamenti(completi.filter((p) => anno === 0 || p.data.startsWith(anno.toString())));
    } catch (e) {
      toast.error(`Storico non disponibile: ${e}`);
      setPagamenti([]);
    }
  }, [agenteId, anno]);

  useEffect(() => {
    setPagamenti(null);
    setAperto(null);
    if (agenteId) carica();
  }, [agenteId, carica]);

  useRicaricaSuEventi(EVENTI_RICARICA, carica, 180);

  async function annulla(p: Pagamento) {
    try {
      await api.recordDelete("provv_pagamento", p.id);
      toast.success("Pagamento annullato: gli ordini tornano pagabili.");
      onAnnullato();
      carica();
    } catch (e) {
      toast.error(`Annullamento non riuscito: ${e}`);
    }
  }

  const totaleStorico = (pagamenti ?? []).reduce((acc, p) => acc + p.totale, 0);
  const keyPagamento = useCallback((p: Pagamento) => p.id, []);

  return (
    <Modal
      opened={!!agenteId}
      onClose={onClose}
      closeOnEscape={!bloccaChiusura}
      closeOnClickOutside={!bloccaChiusura}
      size="lg"
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="gray" radius="md">
            <IconCoin size={18} />
          </ThemeIcon>
          <Text fw={700}>Storico provvigioni — {agenteNome}</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180 }}
    >
      <Box className="pt-modal-shell">
        <Box className="pt-modal-scroll">
          {pagamenti === null ? (
            <Center p="xl">
              <Loader />
            </Center>
          ) : pagamenti.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              Nessun pagamento registrato per questo agente.
            </Text>
          ) : (
            <Stack gap="sm">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {pagamenti.length} {pagamenti.length === 1 ? "pagamento" : "pagamenti"}
            </Text>
            <Text size="sm" c="dimmed">
              Totale pagato:{" "}
              <Text span fw={700} className="tabular">
                € {centsToEurStr(totaleStorico)}
              </Text>
            </Text>
          </Group>

          <VirtualStack
            items={pagamenti}
            getKey={keyPagamento}
            maxHeight="min(520px, calc(100dvh - 260px))"
            estimateHeight={78}
            gap={8}
            renderItem={(p) => {
              const espanso = aperto === p.id;
              return (
                <Paper key={p.id} withBorder radius="md" p="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Group
                      gap="sm"
                      wrap="nowrap"
                      style={{ minWidth: 0, cursor: "pointer", flex: 1 }}
                      onClick={() => setAperto(espanso ? null : p.id)}
                    >
                      <ThemeIcon variant="subtle" color="gray" size="sm">
                        {espanso ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      </ThemeIcon>
                      <Box style={{ minWidth: 0 }}>
                        <Text fw={600} size="sm">
                          {formattaDataItaliana(p.data)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {p.righe.length} {p.righe.length === 1 ? "ordine" : "ordini"}
                        </Text>
                      </Box>
                    </Group>
                    <Group gap="sm" wrap="nowrap">
                      <Badge variant="light" color="teal" className="tabular">
                        € {centsToEurStr(p.totale)}
                      </Badge>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label="Esporta o stampa"
                        title="Esporta o stampa"
                        onClick={() => onEsporta({ agenteNome, data: p.data, righe: p.righe })}
                      >
                        <IconFileExport size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label="Annulla pagamento"
                        title="Annulla pagamento"
                        onClick={() => annulla(p)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Group>

                  <Collapse expanded={espanso}>
                    <RighePagamentoVirtuali righe={p.righe} />
                  </Collapse>
                </Paper>
              );
            }}
          />
            </Stack>
          )}
        </Box>

        <FooterAzioniModale>
            <Button variant="subtle" color="gray" onClick={onClose}>
              Chiudi
            </Button>
        </FooterAzioniModale>
      </Box>
    </Modal>
  );
}

function RighePagamentoVirtuali({ righe }: { righe: RigaPag[] }) {
  const columns = useMemo<DataTableColumn<RigaPag>[]>(
    () => [
      {
        accessor: "numero",
        title: "N°",
        cellsClassName: "tabular",
        render: (r) => <span style={{ fontWeight: 600 }}>{r.numero}</span>,
      },
      { accessor: "data", title: "Data", cellsClassName: "tabular", render: (r) => formattaDataItaliana(r.data) },
      { accessor: "clienteNome", title: "Cliente", render: (r) => r.clienteNome || "—" },
      {
        accessor: "provvigione",
        title: "Provvigione",
        textAlign: "right",
        cellsClassName: "tabular",
        render: (r) => `€ ${centsToEurStr(r.provvigione)}`,
      },
    ],
    []
  );
  return (
    <Box mt="xs" style={{ height: modalTableHeight(righe.length, { min: 130, max: 260, maxVisibleRows: 5 }) }}>
      <Tabella<RigaPag>
        height="100%"
        columns={columns}
        records={righe}
        idAccessor={(r) => r.ordineId || `${r.numero}-${r.data}`}
        storeColumnsKey="contabilita-storico-provvigioni-righe"
        emptyState={<Box />}
      />
    </Box>
  );
}
