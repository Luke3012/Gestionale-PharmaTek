// Modale crea/modifica promemoria condiviso (FASE 6C). Campi: testo, scadenza,
// priorità (segmented), ricorrenza, avviso anticipato (giorni), e collegamento
// opzionale a un'entità (cliente/medico/agente/ordine) tramite Select ricercabile
// raggruppato. Quando aperta pre-collegata (da editor ordine / riepilogo) il
// collegamento è fissato e mostrato come chip non modificabile.
import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  LoadingOverlay,
} from "@mantine/core";
import { IconBellPlus, IconTrash } from "@tabler/icons-react";
import { api, type Identity, type OrdineDto, type RecordDto } from "../../lib/tauri";
import { usePrefs } from "../../lib/prefs";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { catturaOrigineCestino, volaNelCestino, type PuntoVoloCestino } from "../../ui/volaCestino";
import { focusInvalidField } from "../../ui/focusInvalid";
import {
  COLLEGATO_META,
  PRIORITA,
  RICORRENZE,
  aggiornaPromemoria,
  creaPromemoria,
  eliminaPromemoria,
  type Collegato,
  type CollegatoTipo,
  type Priorita,
  type Promemoria,
  type RicorrenzaTipo,
} from "./promemoria";
import { riattivaPromemoria } from "../notifiche/notifiche";
import { oggiIso as oggi } from "../../lib/date";

export interface PromemoriaTarget {
  /** Modifica di un promemoria esistente. */
  promemoria?: Promemoria;
  /** Nuovo promemoria già collegato a un'entità (da editor ordine / riepilogo). */
  collegatoPre?: Collegato;
}

export function PromemoriaModal({
  target,
  identity,
  onClose,
  onSaved,
}: {
  target: PromemoriaTarget | null;
  identity?: Identity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mostrato, setMostrato] = useState<PromemoriaTarget | null>(target);
  useEffect(() => {
    if (target) setMostrato(target);
  }, [target]);

  const isEdit = !!mostrato?.promemoria;

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      size="md"
      zIndex={1300}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconBellPlus size={18} />
          </ThemeIcon>
          <Text fw={700}>{isEdit ? "Modifica promemoria" : "Nuovo promemoria"}</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: () => setMostrato(null) }}
    >
      {mostrato && <PromemoriaForm target={mostrato} identity={identity} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

/** Contenuto del form (senza chrome modale): riusato dalla finestra dedicata. */
export function PromemoriaForm({
  target,
  identity,
  onClose,
  onSaved,
  dentroFinestra,
}: {
  target: PromemoriaTarget;
  identity?: Identity;
  onClose: () => void;
  onSaved: () => void;
  dentroFinestra?: boolean;
}) {
  const p = target.promemoria;
  const isEdit = !!p;

  const [testo, setTesto] = useState(p?.testo ?? "");
  const [scadenza, setScadenza] = useState(p?.scadenza || oggi());
  const [priorita, setPriorita] = useState<Priorita>(p?.priorita ?? "media");
  const [ricorrenza, setRicorrenza] = useState<RicorrenzaTipo>(p?.ricorrenza ?? "nessuna");
  const { anticipoPromemoria } = usePrefs();
  const [avviso, setAvviso] = useState<number | "">(p ? p.avvisoAnticipato : anticipoPromemoria);
  const [salvando, setSalvando] = useState(false);

  // Collegamento: pre-fissato (da editor/riepilogo) oppure scelto qui.
  const preLink = target.collegatoPre;
  const linkFissato = !!preLink && !isEdit;
  const [linkVal, setLinkVal] = useState<string>(
    preLink ? `${preLink.tipo}:${preLink.id}` : p?.collegatoTipo ? `${p.collegatoTipo}:${p.collegatoId}` : ""
  );

  // Opzioni del Select collegamento: clienti/medici/agenti/ordini, raggruppate.
  const [opzioni, setOpzioni] = useState<{ group: string; items: { value: string; label: string }[] }[]>([]);
  const [nomePerValore, setNomePerValore] = useState<Record<string, { tipo: CollegatoTipo; nome: string }>>({});

  useEffect(() => {
    if (linkFissato) return; // niente caricamento se il link è già fissato
    let vivo = true;
    Promise.all([
      api.recordsList("cliente").catch(() => [] as RecordDto[]),
      api.recordsList("medico").catch(() => [] as RecordDto[]),
      api.recordsList("agente").catch(() => [] as RecordDto[]),
      api.ordiniLista().catch(() => [] as OrdineDto[]),
    ])
      .then(([clienti, medici, agenti, ordini]) => {
        if (!vivo) return;
        const mappa: Record<string, { tipo: CollegatoTipo; nome: string }> = {};
        const reg = (tipo: CollegatoTipo, id: string, nome: string) => {
          mappa[`${tipo}:${id}`] = { tipo, nome };
        };
        const itemsAnag = (tipo: CollegatoTipo, recs: RecordDto[]) =>
          recs
            .map((r) => {
              const nome = (r.data.nome as string) || "(senza nome)";
              reg(tipo, r.id, nome);
              return { value: `${tipo}:${r.id}`, label: nome };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
        const itemsOrdini = ordini.map((o) => {
          const nome = `${o.numero}${o.clienteNome ? ` · ${o.clienteNome}` : ""}`;
          reg("ordine", o.id, o.numero);
          return { value: `ordine:${o.id}`, label: nome };
        });
        setNomePerValore(mappa);
        setOpzioni([
          { group: "Clienti", items: itemsAnag("cliente", clienti) },
          { group: "Medici", items: itemsAnag("medico", medici) },
          { group: "Agenti", items: itemsAnag("agente", agenti) },
          { group: "Ordini", items: itemsOrdini },
        ]);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [linkFissato]);

  function collegatoDaStato(): Collegato | null {
    if (linkFissato && preLink) return preLink;
    if (!linkVal) return null;
    const [tipo, id] = linkVal.split(":");
    // In modifica senza opzioni caricate ancora, ricade sul nome salvato.
    const m = nomePerValore[linkVal];
    const nome = m?.nome ?? p?.collegatoNome ?? "";
    return { tipo: tipo as CollegatoTipo, id, nome };
  }

  async function salva() {
    if (!testo.trim()) {
      toast.warning("Scrivi il testo del promemoria.");
      focusInvalidField('[data-pt-field="promemoria-testo"]');
      return;
    }
    setSalvando(true);
    const campi = {
      testo: testo.trim(),
      scadenza,
      priorita,
      ricorrenza,
      avvisoAnticipato: avviso === "" ? 0 : Number(avviso),
      collegato: collegatoDaStato(),
    };
    try {
      if (isEdit && p) {
        await aggiornaPromemoria(p.id, campi);
        // Una modifica «riattiva» le notifiche del promemoria: se è ancora in scadenza/
        // scaduto torna a comparire anche se era stato scartato (gli id sono stabili).
        await riattivaPromemoria(p.id, identity).catch(() => {});
      } else {
        await creaPromemoria(campi, identity);
      }
      toast.success(isEdit ? "Promemoria aggiornato." : "Promemoria creato.");
      onSaved();
    } catch (e) {
      toast.error(`Operazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  async function elimina(origine?: PuntoVoloCestino) {
    if (!p) return;
    const ok = await dialog.confirmDanger(
      "Eliminare il promemoria?",
      "Verrà spostato nel Cestino (ripristinabile).",
      { conferma: "Elimina" }
    );
    if (!ok) return;
    (window as any).eliminatoDaMe = true;
    setSalvando(true);
    try {
      await eliminaPromemoria(p.id);
      if (!volaNelCestino(origine)) {
        toast.success("Promemoria eliminato.");
      }
      onSaved();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  // Chip del collegamento fissato (da editor/riepilogo): non modificabile.
  const metaFissato = linkFissato && preLink ? COLLEGATO_META[preLink.tipo] : null;
  const linkChip =
    metaFissato && preLink ? (
      <Badge variant="light" color={metaFissato.color} leftSection={<metaFissato.Ico size={12} />}>
        {metaFissato.label}: {preLink.nome || "—"}
      </Badge>
    ) : null;

  return (
    <Box className="pt-modal-shell" style={{ position: "relative" }}>
      <LoadingOverlay
        visible={!!dentroFinestra && salvando}
        zIndex={1400}
        overlayProps={{ radius: "sm", backgroundOpacity: 0.4 }}
        loaderProps={{ color: "yellow", type: "bars" }}
      />
      <Box className="pt-modal-scroll">
        <Stack gap="sm">
          <Box data-pt-field="promemoria-testo">
            <Textarea
              label="Promemoria"
              placeholder="Es. richiamare il cliente per il saldo"
              value={testo}
              onChange={(e) => setTesto(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={5}
              data-autofocus
            />
          </Box>

          <Group grow align="flex-start">
            <TextInput
              label="Scadenza"
              type="date"
              value={scadenza}
              onChange={(e) => setScadenza(e.currentTarget.value)}
            />
            <Box>
              <Text size="sm" fw={500} mb={4}>
                Priorità
              </Text>
              <SegmentedControl
                fullWidth
                value={priorita}
                onChange={(v) => setPriorita(v as Priorita)}
                data={PRIORITA.map((pd) => ({ value: pd.value, label: pd.label }))}
              />
            </Box>
          </Group>

          <Group grow align="flex-start">
            <Select
              label="Ricorrenza"
              data={RICORRENZE.map((r) => ({ value: r.value, label: r.label }))}
              value={ricorrenza}
              onChange={(v) => setRicorrenza((v as RicorrenzaTipo) ?? "nessuna")}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true, zIndex: 1400 }}
            />
            <NumberInput
              label="Avviso anticipato"
              description="Giorni prima (0 = nessuno)"
              value={avviso}
              onChange={(v) => setAvviso(v === "" ? "" : Number(v))}
              min={0}
              max={60}
              suffix=" g"
            />
          </Group>

          <Divider label="Collegamento" labelPosition="left" my={2} />
          {linkFissato ? (
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Collegato a
              </Text>
              {linkChip}
            </Group>
          ) : (
            <Select
              label="Collega a un'entità (opzionale)"
              placeholder="Nessun collegamento"
              data={opzioni}
              value={linkVal || null}
              onChange={(v) => setLinkVal(v ?? "")}
              searchable
              clearable
              limit={50}
              nothingFoundMessage="Nessun risultato"
              comboboxProps={{ withinPortal: true, zIndex: 1400 }}
            />
          )}
        </Stack>
      </Box>

      <div className="pt-modal-footer">
        {isEdit ? (
          <Button
            variant="subtle"
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={(e) => elimina(catturaOrigineCestino(e))}
            disabled={salvando}
          >
            Elimina
          </Button>
        ) : (
          <span />
        )}
        <div className="pt-modal-actions">
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          <Button color="accent" onClick={salva} loading={salvando} leftSection={<IconBellPlus size={16} />}>
            {isEdit ? "Salva" : "Crea promemoria"}
          </Button>
        </div>
      </div>
    </Box>
  );
}
