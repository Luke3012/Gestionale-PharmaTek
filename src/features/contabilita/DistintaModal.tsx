// Modale "Nuova distinta corriere" (FASE 3C): registra un bonifico cumulativo con cui
// un corriere (o un versamento assegni) accredita su un conto reale uno o più pagamenti
// incassati in contrassegno/assegno. Si spuntano i pagamenti coperti; l'importo della
// distinta è la SOMMA degli spuntati (nessuna trattenuta). Il conto di accredito si
// propone dal corriere (conto_incasso_id) con fallback sul predefinito accrediti, ed è
// una fotografia storica sulla distinta. I pagamenti coperti passano a "saldato".
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconSearch, IconTruckDelivery } from "@tabler/icons-react";
import { api, type ContrassegnoAperto, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { EuroInput } from "../../ui/EuroInput";
import { oggiIso as oggi } from "../../lib/date";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { focusInvalidField } from "../../ui/focusInvalid";
import { Tabella, type DataTableColumn } from "../../ui/Tabella";
import { modalTableHeight } from "../../ui/modalTableHeight";
import { DataAdattiva } from "../../ui/DataAdattiva";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { opzioniRecordNome } from "../../lib/opzioniRecord";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { èContoTransito, opzioniConti } from "./contoPreferito";

export function DistintaModal({
  opened,
  onClose,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Teniamo il contenuto montato durante l'animazione di uscita (smontarlo subito fa
  // "collassare" il modale su un riquadro vuoto mentre si chiude).
  const [mostrato, clearMostrato] = useModalSnapshot(opened ? true : null);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      zIndex={1300}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconTruckDelivery size={18} />
          </ThemeIcon>
          <Text fw={700}>Nuova distinta corriere</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: clearMostrato }}
    >
      {mostrato && <Form onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function Form({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [aperti, setAperti] = useState<ContrassegnoAperto[]>([]);
  const [corrieri, setCorrieri] = useState<RecordDto[]>([]);
  const [conti, setConti] = useState<RecordDto[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const [corriereId, setCorriereId] = useState<string>("");
  const [contoId, setContoId] = useState<string>("");
  const [dataDistinta, setDataDistinta] = useState(oggi());
  const [dataAccredito, setDataAccredito] = useState(oggi());
  const [filtroTipo, setFiltroTipo] = useState<"tutti" | "contrassegno" | "assegno">("tutti");
  const [cercaNominativo, setCercaNominativo] = useState("");
  const [spuntati, setSpuntati] = useState<Set<string>>(new Set());
  // Importo realmente accreditato dal bonifico (€): si propone come somma degli spuntati
  // ma è modificabile (il corriere può trattenere commissioni).
  const [importoEmesso, setImportoEmesso] = useState<number | "">("");
  const importoToccato = useRef(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    Promise.all([api.contrassegniAperti(), api.recordsList("corriere"), api.recordsList("conto")])
      .then(([a, co, c]) => {
        setAperti(a);
        setCorrieri(co);
        setConti(c);
        // Propone il conto predefinito accrediti come default iniziale.
        const predef = c.find((x) => x.data.predefinito_accrediti === true);
        if (predef) setContoId(predef.id);
      })
      .catch((e) => toast.error(`Caricamento non riuscito: ${e}`))
      .finally(() => setCaricamento(false));
  }, []);

  // Cambiando corriere, propone il suo conto di accredito (fallback: predefinito accrediti).
  function cambiaCorriere(id: string | null) {
    const cid = id ?? "";
    setCorriereId(cid);
    const corr = corrieri.find((c) => c.id === cid);
    const proposto =
      (corr?.data.conto_incasso_id as string) ||
      conti.find((x) => x.data.predefinito_accrediti === true)?.id ||
      "";
    if (proposto) setContoId(proposto);
  }

  const visibili = useMemo(() => {
    const termini = cercaNominativo.trim().toLocaleLowerCase("it").split(/\s+/).filter(Boolean);
    return aperti.filter((aperto) => {
      if (filtroTipo !== "tutti" && aperto.contoTipo !== filtroTipo) return false;
      const nominativo = `${aperto.clienteNome} ${aperto.agenteNome} ${aperto.ordineNumero}`
        .toLocaleLowerCase("it");
      return termini.every((termine) => nominativo.includes(termine));
    });
  }, [aperti, cercaNominativo, filtroTipo]);

  const importo = useMemo(
    () => aperti.filter((a) => spuntati.has(a.id)).reduce((s, a) => s + a.importo, 0),
    [aperti, spuntati]
  );
  const nSpuntati = spuntati.size;

  // Finché l'utente non tocca l'importo, lo teniamo allineato alla somma degli spuntati.
  useEffect(() => {
    if (!importoToccato.current) setImportoEmesso(importo > 0 ? importo / 100 : "");
  }, [importo]);

  const importoCent = importoEmesso === "" ? importo : eurToCents(Number(importoEmesso));
  const differenza = importoCent - importo;

  const tuttiVisibiliSpuntati =
    visibili.length > 0 && visibili.every((a) => spuntati.has(a.id));

  function toggle(id: string, on: boolean) {
    setSpuntati((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleTutti(on: boolean) {
    setSpuntati((s) => {
      const next = new Set(s);
      for (const a of visibili) {
        if (on) next.add(a.id);
        else next.delete(a.id);
      }
      return next;
    });
  }

  const columns = useMemo<DataTableColumn<ContrassegnoAperto>[]>(
    () => [
      {
        accessor: "__selezione",
        title: (
          <Checkbox
            checked={tuttiVisibiliSpuntati}
            indeterminate={!tuttiVisibiliSpuntati && visibili.some((a) => spuntati.has(a.id))}
            onChange={(e) => toggleTutti(e.currentTarget.checked)}
            aria-label="Spunta tutti"
          />
        ),
        width: 42,
        render: (a) => (
          <Checkbox
            checked={spuntati.has(a.id)}
            onChange={(e) => toggle(a.id, e.currentTarget.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Spunta ordine ${a.ordineNumero}`}
          />
        ),
      },
      { accessor: "ordineNumero", title: "Ordine", render: (a) => a.ordineNumero || "—" },
      { accessor: "clienteNome", title: "Cliente", render: (a) => a.clienteNome || "—" },
      { accessor: "agenteNome", title: "Agente", render: (a) => a.agenteNome || "—" },
      {
        accessor: "contoTipo",
        title: "Mezzo",
        render: (a) => (
          <Badge size="xs" variant="light" color={a.contoTipo === "assegno" ? "grape" : "cyan"}>
            {a.contoTipo === "assegno" ? "Assegno" : "Contrassegno"}
          </Badge>
        ),
      },
      {
        accessor: "data",
        title: "Data",
        cellsClassName: "tabular",
        render: (a) => <DataAdattiva iso={a.data} compatta={false} />,
      },
      {
        accessor: "importo",
        title: "Importo",
        textAlign: "right",
        cellsClassName: "tabular",
        render: (a) => `€ ${centsToEurStr(a.importo)}`,
      },
    ],
    [spuntati, tuttiVisibiliSpuntati, visibili]
  );

  async function conferma() {
    if (nSpuntati === 0) {
      toast.warning("Spunta almeno un pagamento da accreditare.");
      return;
    }
    if (!contoId) {
      toast.warning("Indica il conto di accredito.");
      focusInvalidField('[data-pt-field="distinta-conto"]');
      return;
    }
    const selezionati = aperti.filter((a) => spuntati.has(a.id));
    if (selezionati.length !== nSpuntati) {
      toast.warning("Alcuni pagamenti selezionati non sono più disponibili. Aggiorno la lista.");
      setSpuntati(new Set(selezionati.map((a) => a.id)));
      return;
    }
    setSalvando(true);
    try {
      const aggiornati = await api.contrassegniAperti();
      const aggiornatiById = new Map(aggiornati.map((a) => [a.id, a]));
      const incoerente = selezionati.some((a) => {
        const corrente = aggiornatiById.get(a.id);
        return (
          !corrente ||
          corrente.ordineId !== a.ordineId ||
          corrente.importo !== a.importo ||
          corrente.contoId !== a.contoId ||
          corrente.contoTipo !== a.contoTipo
        );
      });
      if (incoerente) {
        setAperti(aggiornati);
        setSpuntati((prev) => new Set([...prev].filter((id) => aggiornatiById.has(id))));
        toast.warning("I pagamenti selezionati sono cambiati da un altro PC. Controlla la distinta aggiornata e riprova.");
        return;
      }

      await api.distintaCrea({
        corriereId,
        dataDistinta,
        dataAccredito,
        contoId,
        importo: importoCent,
        pagamentoIds: selezionati.map((a) => a.id),
        pagamentiAttesi: selezionati.map((a) => ({
          id: a.id,
          ordineId: a.ordineId,
          importo: a.importo,
          contoId: a.contoId,
          contoTipo: a.contoTipo,
        })),
      });
      toast.success(`Distinta registrata: ${nSpuntati} pagamenti accreditati.`);
      onSaved();
    } catch (e) {
      toast.error(`Registrazione distinta non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  const datiCorrieri = useMemo(
    () => opzioniRecordNome(corrieri, "(corriere)"),
    [corrieri]
  );
  const datiConti = useMemo(
    () =>
      opzioniConti(conti.filter((c) => !èContoTransito(c.data.tipo))),
    [conti]
  );

  return (
    <Box className="pt-modal-shell pt-modal-shell-table">
      <Box className="pt-modal-scroll">
        <Stack gap="sm">
          <Group grow align="flex-end">
            <Select
              label="Corriere"
              placeholder="(versamento assegni / nessuno)"
              data={datiCorrieri}
              value={corriereId || null}
              onChange={cambiaCorriere}
              clearable
              comboboxProps={{ withinPortal: true, zIndex: 1400 }}
            />
            <Box data-pt-field="distinta-conto">
              <Select
                label="Conto di accredito"
                placeholder="Scegli conto reale"
                data={datiConti}
                value={contoId || null}
                onChange={(v) => setContoId(v ?? "")}
                comboboxProps={{ withinPortal: true, zIndex: 1400 }}
                allowDeselect={false}
              />
            </Box>
          </Group>
          <Group grow align="flex-end">
            <TextInput
              label="Data distinta"
              type="date"
              value={dataDistinta}
              onChange={(e) => setDataDistinta(e.currentTarget.value)}
            />
            <TextInput
              label="Data accredito"
              type="date"
              value={dataAccredito}
              onChange={(e) => setDataAccredito(e.currentTarget.value)}
            />
          </Group>

          <Divider label="Pagamenti da accreditare" labelPosition="left" my={4} />

          <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
            <SegmentedControl
              size="xs"
              value={filtroTipo}
              onChange={(v) => setFiltroTipo(v as typeof filtroTipo)}
              data={[
                { value: "tutti", label: "Tutti" },
                { value: "contrassegno", label: "Contrassegno" },
                { value: "assegno", label: "Assegno" },
              ]}
            />
            <DebouncedInput
              size="xs"
              aria-label="Cerca nominativo nei pagamenti alla consegna"
              placeholder="Cerca nominativo…"
              leftSection={<IconSearch size={14} />}
              value={cercaNominativo}
              onChange={setCercaNominativo}
              style={{ flex: "0 1 260px", minWidth: 150, marginLeft: "auto" }}
            />
            <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
              {caricamento ? "Caricamento…" : `${visibili.length} in attesa di accredito`}
            </Text>
          </Group>

          <Tabella<ContrassegnoAperto>
            columns={columns}
            records={visibili}
            caricamentoIniziale={caricamento}
            idAccessor="id"
            storeColumnsKey="contabilita-nuova-distinta"
            height={modalTableHeight(visibili.length, { min: 60, max: 620, viewportOffset: 430, maxVisibleRows: 10 })}
            onRowClick={({ record }) => toggle(record.id, !spuntati.has(record.id))}
            rowStyle={() => ({ cursor: "pointer" })}
            emptyState={
              caricamento ? (
                <Box />
              ) : (
                <Text size="sm" c="dimmed" py="md" ta="center">
                  Nessun pagamento in contrassegno/assegno da accreditare per questo filtro.
                </Text>
              )
            }
          />

        </Stack>
      </Box>

      <div className="pt-modal-footer">
        <Group gap="lg" align="flex-end">
          <EuroInput
            label="Importo accreditato"
            description={`Somma spuntati: € ${centsToEurStr(importo)}`}
            value={importoEmesso}
            onChange={(v) => {
              importoToccato.current = true;
              setImportoEmesso(v === "" ? "" : Number(v));
            }}
            min={0}
            w={200}
          />
          {differenza !== 0 && nSpuntati > 0 && (
            <Text size="xs" c={differenza < 0 ? "orange" : "teal"}>
              {differenza < 0 ? "Trattenuta" : "Eccedenza"}: € {centsToEurStr(Math.abs(differenza))}
            </Text>
          )}
        </Group>
        <Group gap="sm">
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          <Button color="accent" onClick={conferma} loading={salvando} disabled={nSpuntati === 0}>
            Registra distinta ({nSpuntati})
          </Button>
        </Group>
      </div>
    </Box>
  );
}
