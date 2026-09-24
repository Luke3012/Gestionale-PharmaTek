// Modale di **preparazione alla produzione** (FASE 5B/6): si apre al «Manda in produzione»
// quando serve completare i **dati di produzione** mancanti: quelli Immunoterapia
// (formulazione/posologia/allergeni) sono obbligatori; quelli Diagnostica
// (tipo test/ML/quantità/codice) restano facoltativi ma sono compilabili nello stesso passaggio.
// La data di consegna prevista Laboratorio si gestisce dopo, dalla vista «In lavorazione».
// L'acconto mancante NON blocca: è solo un avviso in evidenza in cima (i pagamenti non si
// toccano mai).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDot,
  IconHammer,
} from "@tabler/icons-react";
import { api, type Campi, type OrdineDto, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { focusInvalidField } from "../../ui/focusInvalid";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { VirtualFlow } from "../../ui/VirtualFlow";
import {
  campiProduzione,
  campiDiagnostica,
  diagnosticaIncompleta,
  ML_COMUNI,
  nomeProdotto,
  rigaProduzioneCompleta,
  TIPI_TEST,
  type CampiDiagnostica,
  type CampiProduzione,
  type Suggerimenti,
} from "./datiProduzione";

/** Un ordine con le sue righe **incomplete** da compilare. */
interface GruppoDaCompilare {
  ordine: OrdineDto;
  righe: RecordDto[];
}

export interface CompilaTarget {
  /** Ordini con righe (dati di produzione) da completare. Può essere vuoto. */
  gruppi: GruppoDaCompilare[];
  /** Righe Diagnostica senza ML o quantità: modificabili qui, ma sempre facoltative. */
  gruppiDiagnostica: GruppoDaCompilare[];
  /** Ordini senza acconto incassato (solo avviso, non bloccante). */
  senzaAcconto: OrdineDto[];
  /** Tutte le righe scelte per l'invio, comprese quelle che non richiedono compilazione. */
  righeDaInviare: Array<{ id: string; ordineNumero: string; rigaNumero: number; prodottoNome: string }>;
}

type MotivoRigaNonValida = "eliminata" | "spedita" | "lavorata";

export interface RigaNonValida {
  id: string;
  motivo: MotivoRigaNonValida;
}

/** Individua tutte le righe che non possono più essere incluse nell'invio. */
export function rilevaRigheNonValide(ids: string[], correnti: RecordDto[]): RigaNonValida[] {
  const correntiById = new Map(correnti.map((r) => [r.id, r]));
  const risultato: RigaNonValida[] = [];
  for (const id of ids) {
    const riga = correntiById.get(id);
    if (!riga || riga.deleted) risultato.push({ id, motivo: "eliminata" });
    else if (riga.data.stato_riga === "spedita" || riga.data.spedizione_id) {
      risultato.push({ id, motivo: "spedita" });
    } else if (riga.data.stato_produzione || riga.data.lotto_produzione) {
      risultato.push({ id, motivo: "lavorata" });
    }
  }
  return risultato;
}

function uguali(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function patchProduzione(iniziale: CampiProduzione, corrente: CampiProduzione): Campi {
  const patch: Campi = {};
  const formulazione = corrente.formulazione.trim();
  const posologia = corrente.posologia.trim();
  if (formulazione !== iniziale.formulazione.trim()) patch.formulazione = formulazione;
  if (posologia !== iniziale.posologia.trim()) patch.posologia = posologia;
  if (!uguali(corrente.allergeni, iniziale.allergeni)) patch.allergeni = corrente.allergeni;
  return patch;
}

function patchDiagnostica(iniziale: CampiDiagnostica, corrente: CampiDiagnostica): Campi {
  const patch: Campi = {};
  const tipoTest = corrente.tipoTest.trim();
  const ml = corrente.ml.trim();
  const codice = corrente.codice.trim();
  if (tipoTest !== iniziale.tipoTest.trim()) patch.tipo_test = tipoTest;
  if (ml !== iniziale.ml.trim()) patch.ml = ml;
  if (corrente.qta !== iniziale.qta) patch.qta = corrente.qta;
  if (codice !== iniziale.codice.trim()) patch.codice_laboratorio = codice;
  return patch;
}

export function CompilaProduzioneModal({
  target,
  prodMap,
  sugg,
  onClose,
  onConfirm,
}: {
  target: CompilaTarget | null;
  prodMap: Map<string, string>;
  sugg: Suggerimenti;
  onClose: () => void;
  /** Esegue l'invio delle sole righe confermate e segnala se è riuscito. */
  onConfirm: (righeIds: string[]) => Promise<boolean>;
}) {
  const [mostrato, clearMostrato] = useModalSnapshot(target);

  return (
    <Modal
      opened={!!target}
      onClose={onClose}
      closeOnEscape
      closeOnClickOutside
      size="lg"
      zIndex={1300}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconHammer size={18} />
          </ThemeIcon>
          <Text fw={700}>Prepara la produzione</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: clearMostrato }}
    >
      {mostrato && (
        <Corpo target={mostrato} prodMap={prodMap} sugg={sugg} onClose={onClose} onConfirm={onConfirm} />
      )}
    </Modal>
  );
}

function Corpo({
  target,
  prodMap,
  sugg,
  onClose,
  onConfirm,
}: {
  target: CompilaTarget;
  prodMap: Map<string, string>;
  sugg: Suggerimenti;
  onClose: () => void;
  onConfirm: (righeIds: string[]) => Promise<boolean>;
}) {
  const righeIds = target.gruppi.flatMap((g) => g.righe.map((r) => r.id));
  const righeDiagnosticaIds = target.gruppiDiagnostica.flatMap((g) => g.righe.map((r) => r.id));
  const [valori, setValori] = useState<Record<string, CampiProduzione>>(() => {
    const init: Record<string, CampiProduzione> = {};
    for (const g of target.gruppi) for (const r of g.righe) init[r.id] = campiProduzione(r.data);
    return init;
  });
  const [valoriDiagnostica, setValoriDiagnostica] = useState<Record<string, CampiDiagnostica>>(() => {
    const init: Record<string, CampiDiagnostica> = {};
    for (const g of target.gruppiDiagnostica) {
      for (const r of g.righe) init[r.id] = campiDiagnostica(r.data);
    }
    return init;
  });
  const [salvando, setSalvando] = useState(false);
  const [scrollGroupKey, setScrollGroupKey] = useState<string | null>(null);
  const [nonValide, setNonValide] = useState<RigaNonValida[]>([]);
  const [escluse, setEscluse] = useState<Set<string>>(() => new Set());
  const nonValideToastId = useRef<string | null>(null);

  const righeAttive = target.righeDaInviare.filter((r) => !escluse.has(r.id));
  const righeIdsAttive = righeIds.filter((id) => !escluse.has(id));
  const righeDiagnosticaIdsAttive = righeDiagnosticaIds.filter((id) => !escluse.has(id));
  const dettaglioRighe = useMemo(
    () => new Map(target.righeDaInviare.map((r) => [r.id, r])),
    [target.righeDaInviare]
  );

  useEffect(
    () => () => {
      if (nonValideToastId.current) toast.dismiss(nonValideToastId.current);
    },
    []
  );

  const gruppoIdPerRiga = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of target.gruppi) for (const r of g.righe) map.set(r.id, g.ordine.id);
    return map;
  }, [target.gruppi]);

  function scrollaEFocalizza(
    setKey: (key: string | null) => void,
    key: string,
    selector: string
  ) {
    setKey(null);
    window.setTimeout(() => setKey(key), 0);
    window.setTimeout(() => focusInvalidField(selector), 90);
    window.setTimeout(() => focusInvalidField(selector), 220);
  }

  function setRiga(id: string, patch: Partial<CampiProduzione>) {
    setValori((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  }

  function setRigaDiagnostica(id: string, patch: Partial<CampiDiagnostica>) {
    setValoriDiagnostica((v) => ({ ...v, [id]: { ...v[id], ...patch } }));
  }

  const nComplete = righeIdsAttive.filter((id) => rigaProduzioneCompleta(valori[id])).length;
  const nDiagnosticaComplete = righeDiagnosticaIdsAttive.filter(
    (id) => !diagnosticaIncompleta(valoriDiagnostica[id])
  ).length;
  const righeOk = righeIdsAttive.length === 0 || nComplete === righeIdsAttive.length;
  const pronto = righeOk && righeAttive.length > 0 && nonValide.length === 0;

  function mostraRigheNonValide(righe: RigaNonValida[]): boolean {
    if (righe.length === 0) return false;
    setNonValide(righe);
    if (nonValideToastId.current) toast.dismiss(nonValideToastId.current);
    let toastId = "";
    const descrizioni = righe.map((riga) => {
      const dettaglio = dettaglioRighe.get(riga.id);
      const motivo =
        riga.motivo === "eliminata"
          ? "eliminata"
          : riga.motivo === "spedita"
            ? "già spedita"
            : "già in lavorazione";
      const numeroRiga = dettaglio?.rigaNumero ? ` · riga ${dettaglio.rigaNumero}` : "";
      return `Ordine ${dettaglio?.ordineNumero || "—"}${numeroRiga} · ${dettaglio?.prodottoNome || "Riga"} (${motivo})`;
    });
    toastId = toast.warning(descrizioni.join("; "), {
      titolo: "Invio non eseguito: righe cambiate altrove",
      durata: 0,
      azioni: [
        {
          label: "Escludi le righe",
          onClick: () => {
            escludiRighe(righe);
            toast.dismiss(toastId);
          },
        },
      ],
    });
    nonValideToastId.current = toastId;
    const prima = righe[0]?.id;
    if (prima) {
      const gruppo = gruppoIdPerRiga.get(prima);
      if (gruppo) scrollaEFocalizza(setScrollGroupKey, gruppo, `[data-pt-row="${prima}"]`);
    }
    return true;
  }

  function escludiRighe(righe: RigaNonValida[]) {
    setEscluse((correnti) => {
      const prossime = new Set(correnti);
      for (const riga of righe) prossime.add(riga.id);
      return prossime;
    });
    setNonValide([]);
    if (nonValideToastId.current) {
      toast.dismiss(nonValideToastId.current);
      nonValideToastId.current = null;
    }
  }

  async function conferma() {
    if (righeAttive.length === 0) {
      toast.warning("Non è rimasta alcuna riga da mandare in produzione.");
      return;
    }
    if (!righeOk) {
      const prima = righeIdsAttive.find((id) => !rigaProduzioneCompleta(valori[id]));
      if (prima) {
        scrollaEFocalizza(
          setScrollGroupKey,
          gruppoIdPerRiga.get(prima) ?? prima,
          `[data-pt-row="${prima}"]`
        );
      }
      return;
    }
    setSalvando(true);
    try {
      const targetById = new Map(
        [...target.gruppi, ...target.gruppiDiagnostica].flatMap((g) => g.righe).map((r) => [r.id, r])
      );
      const correnti = await api.recordsList("riga_ordine");
      const correntiById = new Map(correnti.map((r) => [r.id, r]));
      const aggiornamenti: Array<{ id: string; fields: Campi }> = [];

      if (mostraRigheNonValide(rilevaRigheNonValide(righeAttive.map((r) => r.id), correnti))) {
        return;
      }

      for (const id of righeIdsAttive) {
        const inizialeRecord = targetById.get(id)!;
        const correnteRecord = correntiById.get(id);
        const patch = patchProduzione(campiProduzione(inizialeRecord.data), valori[id]);
        if (!correnteRecord) return;
        if (Object.keys(patch).length > 0) aggiornamenti.push({ id, fields: patch });
      }

      for (const id of righeDiagnosticaIdsAttive) {
        const inizialeRecord = targetById.get(id)!;
        const correnteRecord = correntiById.get(id);
        const patch = patchDiagnostica(campiDiagnostica(inizialeRecord.data), valoriDiagnostica[id]);
        if (!correnteRecord) return;
        if (Object.keys(patch).length > 0) aggiornamenti.push({ id, fields: patch });
      }

      // Un solo batch ricontrolla tutte le righe e scrive tutto o niente. Le patch
      // contengono sempre soltanto i campi effettivamente toccati nel modale.
      if (aggiornamenti.length > 0) await api.produzioneCompilaRighe(aggiornamenti);
      const inviato = await onConfirm(righeAttive.map((r) => r.id));
      if (inviato) {
        onClose();
        return;
      }
      const dopoErrore = await api.recordsList("riga_ordine");
      mostraRigheNonValide(rilevaRigheNonValide(righeAttive.map((r) => r.id), dopoErrore));
    } catch (e) {
      const dopoErrore = await api.recordsList("riga_ordine").catch(() => []);
      if (!mostraRigheNonValide(rilevaRigheNonValide(righeAttive.map((r) => r.id), dopoErrore))) {
        toast.error(`Operazione non riuscita: ${e}`);
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Box className="pt-modal-shell">
      <Box className="pt-modal-scroll">
        <Stack gap="md">
          {target.senzaAcconto.length > 0 && (
            <Alert
              variant="light"
              color="orange"
              icon={<IconAlertTriangle size={18} />}
              title="Acconto non ancora registrato"
            >
              <Text size="sm">
                Questi ordini non hanno un acconto incassato. Puoi procedere lo stesso — i pagamenti non
                vengono modificati:
              </Text>
              <Text size="sm" mt={4} fw={500}>
                {target.senzaAcconto
                  .map((o) => `${o.numero} — ${o.clienteNome || o.medicoNome || "—"}`)
                  .join("   ·   ")}
              </Text>
            </Alert>
          )}

          {target.gruppi.length > 0 && (
            <Box>
              <Text size="sm" c="dimmed" mb="sm">
                Questi prodotti non hanno ancora i dati di produzione. Compilali per poterli mandare in
                produzione: ne mancano <b>{righeIds.length - nComplete}</b> su {righeIds.length}.
              </Text>
              <VirtualFlow
                items={target.gruppi}
                getKey={(g) => g.ordine.id}
                estimateHeight={250}
                gap={16}
                overscan={4}
                scrollToKey={scrollGroupKey}
                renderItem={(g) => (
                  <Box>
                    <Group gap={8} wrap="nowrap" mb="xs">
                      <Badge variant="filled" color="accent" radius="sm">
                        {g.ordine.numero}
                      </Badge>
                      <Text size="sm" c="dimmed" truncate>
                        {[g.ordine.clienteNome || g.ordine.medicoNome, g.ordine.clienteCitta]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </Text>
                    </Group>
                    <Stack gap="sm">
                      {g.righe.map((r) => (
                        <RigaCompila
                          id={r.id}
                          key={r.id}
                          nome={nomeProdotto(prodMap, r)}
                          qta={typeof r.data.qta === "number" ? r.data.qta : 1}
                          valore={valori[r.id]}
                          sugg={sugg}
                          esclusa={escluse.has(r.id)}
                          nonValida={nonValide.some((x) => x.id === r.id)}
                          onChange={(patch) => setRiga(r.id, patch)}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
              />
            </Box>
          )}

          {target.gruppiDiagnostica.length > 0 && (
            <Box>
              <Text size="sm" c="dimmed" mb="sm">
                Per questi allergeni Diagnostica mancano ML o quantità. Puoi completarli ora per
                rendere più completo il file Laboratorio, oppure procedere comunque: sono dati facoltativi.
              </Text>
              <VirtualFlow
                items={target.gruppiDiagnostica}
                getKey={(g) => `diag-${g.ordine.id}`}
                estimateHeight={230}
                gap={16}
                overscan={4}
                renderItem={(g) => (
                  <Box>
                    <Group gap={8} wrap="nowrap" mb="xs">
                      <Badge variant="filled" color="teal" radius="sm">
                        {g.ordine.numero}
                      </Badge>
                      <Text size="sm" c="dimmed" truncate>
                        {[g.ordine.medicoNome || g.ordine.clienteNome, g.ordine.clienteCitta]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </Text>
                    </Group>
                    <Stack gap="sm">
                      {g.righe.map((r) => (
                        <RigaCompilaDiagnostica
                          id={r.id}
                          key={r.id}
                          nome={nomeProdotto(prodMap, r)}
                          valore={valoriDiagnostica[r.id]}
                          esclusa={escluse.has(r.id)}
                          nonValida={nonValide.some((x) => x.id === r.id)}
                          onChange={(patch) => setRigaDiagnostica(r.id, patch)}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
              />
            </Box>
          )}
        </Stack>
      </Box>

      <div className="pt-modal-footer">
        <Stack gap={0}>
          {righeIds.length > 0 && (
            <Text size="sm" c={pronto ? "teal" : "dimmed"} fw={500}>
              {nComplete} / {righeIdsAttive.length} dati Immunoterapia
            </Text>
          )}
          {righeDiagnosticaIds.length > 0 && (
            <Text size="xs" c="dimmed">
              {nDiagnosticaComplete} / {righeDiagnosticaIdsAttive.length} dati Diagnostica · facoltativi
            </Text>
          )}
        </Stack>
        <div className="pt-modal-actions">
          {nonValide.length > 0 && (
            <Button variant="light" color="red" onClick={() => escludiRighe(nonValide)} disabled={salvando}>
              Escludi {nonValide.length} {nonValide.length === 1 ? "riga" : "righe"}
            </Button>
          )}
          <Button variant="subtle" color="gray" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          <Button
            color="accent"
            leftSection={<IconHammer size={16} />}
            disabled={salvando || nonValide.length > 0 || righeAttive.length === 0}
            loading={salvando}
            onClick={conferma}
          >
            Manda in produzione
          </Button>
        </div>
      </div>
    </Box>
  );
}

function RigaCompilaDiagnostica({
  id,
  nome,
  valore,
  esclusa,
  nonValida,
  onChange,
}: {
  id: string;
  nome: string;
  valore: CampiDiagnostica;
  esclusa: boolean;
  nonValida: boolean;
  onChange: (patch: Partial<CampiDiagnostica>) => void;
}) {
  const completa = !diagnosticaIncompleta(valore);
  const tipiTest = [...new Set([valore.tipoTest, ...TIPI_TEST].filter(Boolean))];
  const volumi = [...new Set([valore.ml, ...ML_COMUNI].filter(Boolean))];

  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      data-pt-row={id}
      opacity={esclusa ? 0.55 : 1}
      style={nonValida ? { borderColor: "var(--mantine-color-red-5)" } : undefined}
    >
      <Group gap={8} wrap="nowrap" mb={8} style={{ minWidth: 0 }}>
        <ThemeIcon variant="light" color={completa ? "teal" : "gray"} size="sm" radius="xl">
          {completa ? <IconCircleCheck size={16} /> : <IconCircleDot size={16} />}
        </ThemeIcon>
        <Text size="sm" fw={600} truncate>
          {nome}
        </Text>
        {esclusa && <Badge color="gray">Esclusa</Badge>}
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" verticalSpacing="xs">
        <Autocomplete
          label="Tipo test"
          placeholder="Es. PRICK TEST"
          size="xs"
          data={tipiTest}
          value={valore.tipoTest}
          disabled={esclusa}
          onChange={(v) => onChange({ tipoTest: v })}
          comboboxProps={{ withinPortal: false }}
        />
        <Autocomplete
          label="ML"
          placeholder="Es. 2"
          size="xs"
          data={volumi}
          value={valore.ml}
          disabled={esclusa}
          onChange={(v) => onChange({ ml: v })}
          comboboxProps={{ withinPortal: false }}
        />
        <NumberInput
          label="Quantità"
          size="xs"
          min={0}
          allowDecimal={false}
          value={valore.qta}
          disabled={esclusa}
          onChange={(v) => onChange({ qta: Number(v) || 0 })}
        />
        <TextInput
          label="Codice Laboratorio"
          placeholder="Es. P-093"
          size="xs"
          value={valore.codice}
          disabled={esclusa}
          onChange={(e) => onChange({ codice: e.currentTarget.value })}
        />
      </SimpleGrid>
    </Paper>
  );
}

function RigaCompila({
  id,
  nome,
  qta,
  valore,
  sugg,
  esclusa,
  nonValida,
  onChange,
}: {
  id: string;
  nome: string;
  qta: number;
  valore: CampiProduzione;
  sugg: Suggerimenti;
  esclusa: boolean;
  nonValida: boolean;
  onChange: (patch: Partial<CampiProduzione>) => void;
}) {
  const completa = rigaProduzioneCompleta(valore);
  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
      data-pt-row={id}
      opacity={esclusa ? 0.55 : 1}
      style={nonValida ? { borderColor: "var(--mantine-color-red-5)" } : undefined}
    >
      <Group justify="space-between" wrap="nowrap" mb={8}>
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color={completa ? "teal" : "gray"} size="sm" radius="xl">
            {completa ? <IconCircleCheck size={16} /> : <IconCircleDot size={16} />}
          </ThemeIcon>
          <Text size="sm" fw={600} truncate>
            {nome}
          </Text>
          <Text size="xs" c="dimmed">
            ×{qta}
          </Text>
          {esclusa && <Badge color="gray">Esclusa</Badge>}
        </Group>
      </Group>
      <Group grow gap="xs" wrap="nowrap" align="flex-start">
        <Autocomplete
          label="Formulazione"
          placeholder="Es. polimerizzato"
          size="xs"
          data={sugg.formulazioni}
          value={valore.formulazione}
          disabled={esclusa}
          onChange={(v) => onChange({ formulazione: v })}
          comboboxProps={{ withinPortal: false }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && valore.formulazione) {
              const t = valore.formulazione.toLowerCase();
              const first = sugg.formulazioni.find(x => x.toLowerCase().includes(t));
              if (first) onChange({ formulazione: first });
            }
          }}
        />
        <Autocomplete
          label="Posologia"
          placeholder="Es. 3+3"
          size="xs"
          data={sugg.posologie}
          value={valore.posologia}
          disabled={esclusa}
          onChange={(v) => onChange({ posologia: v })}
          comboboxProps={{ withinPortal: false }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && valore.posologia) {
              const t = valore.posologia.toLowerCase();
              const first = sugg.posologie.find(x => x.toLowerCase().includes(t));
              if (first) onChange({ posologia: first });
            }
          }}
        />
      </Group>
      <TagsInput
        label="Allergeni / ceppi (max 10)"
        placeholder={valore.allergeni.length === 0 ? "Aggiungi…" : undefined}
        size="xs"
        mt="xs"
        maxTags={10}
        data={sugg.allergeni}
        value={valore.allergeni}
        disabled={esclusa}
        onChange={(v) => onChange({ allergeni: v })}
        comboboxProps={{ withinPortal: false }}
      />
    </Paper>
  );
}
