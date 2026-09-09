import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconShieldCheck, IconTrash } from "@tabler/icons-react";
import {
  api,
  inTauri,
  type PuliziaDatiArgs,
  type PuliziaModalita,
  type PuliziaPreset,
  type PuliziaPreview,
  type PuliziaResult,
} from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { ricalcolaNotificheSubito } from "../notifiche/ricalcolaNotifiche";

const OPZIONI_MODALITA: { value: PuliziaModalita; label: string }[] = [
  { value: "inutili", label: "Ordini inutili" },
  { value: "clienti_morti", label: "Clienti morti" },
  { value: "movimenti_periodo", label: "Periodo" },
];

const OPZIONI_PRESET: { value: PuliziaPreset; label: string }[] = [
  { value: "anno", label: "Anno di lavoro" },
  { value: "prima_anno", label: "Prima dell'anno" },
  { value: "mesi_12", label: "Più vecchi di 12 mesi" },
  { value: "mesi_24", label: "Più vecchi di 24 mesi" },
  { value: "mesi_36", label: "Più vecchi di 36 mesi" },
  { value: "custom", label: "Date custom" },
];

export function PuliziaDatiBox({
  anno,
  onBackupCleaned,
}: {
  anno: number;
  onBackupCleaned?: () => void;
}) {
  const annoBase = anno === 0 ? new Date().getFullYear() : anno;
  const [modalita, setModalita] = useState<PuliziaModalita>("inutili");
  const [preset, setPreset] = useState<PuliziaPreset>("prima_anno");
  const [dal, setDal] = useState(`${annoBase}-01-01`);
  const [al, setAl] = useState(`${annoBase}-12-31`);
  const [preview, setPreview] = useState<PuliziaPreview | null>(null);
  const [ultimo, setUltimo] = useState<PuliziaResult | null>(null);
  const [analizzando, setAnalizzando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    setPreview(null);
    setUltimo(null);
  }, [modalita, preset, dal, al, annoBase]);

  const args: PuliziaDatiArgs = {
    modalita,
    preset,
    anno: annoBase,
    dal: preset === "custom" ? dal : null,
    al: preset === "custom" ? al : null,
  };
  const bloccata = !!preview?.blocchi.length;
  const puoEliminare = !!preview && preview.totaleRecord > 0 && !bloccata;

  async function analizza() {
    setAnalizzando(true);
    setUltimo(null);
    try {
      const res = await api.puliziaDatiAnteprima(args);
      setPreview(res);
      if (res.totaleRecord === 0 && res.blocchi.length === 0) {
        toast.info("Nessun dato da pulire per questi criteri.");
      }
    } catch (e) {
      toast.error(`Anteprima non riuscita: ${e}`);
    } finally {
      setAnalizzando(false);
    }
  }

  async function elimina() {
    if (!preview) return;
    const ok = await dialog.confirmDanger(
      "Eliminazione definitiva",
      "Creo un backup, poi elimino i record indicati.",
      { conferma: "Elimina definitivamente", annulla: "Annulla" }
    );
    if (!ok) return;
    setEliminando(true);
    try {
      const res = await api.puliziaDatiEsegui(args, preview.conferma);
      await ricalcolaNotificheSubito();
      setUltimo(res);
      setPreview(null);
      toast.success(`Pulizia completata: ${res.purgati} record eliminati.`);
      onBackupCleaned?.();
    } catch (e) {
      toast.error(`Pulizia non riuscita: ${e}`);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={modalita}
        onChange={(value) => setModalita(value as PuliziaModalita)}
        data={OPZIONI_MODALITA}
        fullWidth
      />
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <Select
          label="Periodo"
          data={OPZIONI_PRESET}
          value={preset}
          onChange={(value) => value && setPreset(value as PuliziaPreset)}
          allowDeselect={false}
          style={{ flex: 1 }}
        />
        <Button
          disabled={!inTauri}
          loading={analizzando}
          onClick={analizza}
          leftSection={<IconShieldCheck size={16} />}
        >
          Analizza
        </Button>
      </Group>
      {preset === "custom" && (
        <Group gap="sm" grow>
          <TextInput label="Da" type="date" value={dal} onChange={(e) => setDal(e.currentTarget.value)} />
          <TextInput label="A" type="date" value={al} onChange={(e) => setAl(e.currentTarget.value)} />
        </Group>
      )}

      {preview && (
        <Box>
          <Divider my="xs" />
          <Group justify="space-between" align="center" gap="sm">
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" fw={700}>{preview.descrizione}</Text>
              <Text size="xs" c="dimmed">
                {preview.dal || "inizio archivio"} → {preview.al || "fine archivio"}
              </Text>
            </Box>
            <Badge color={bloccata ? "red" : preview.totaleRecord > 0 ? "yellow" : "gray"} variant="light">
              {preview.totaleRecord} record
            </Badge>
          </Group>

          {Object.keys(preview.conteggi).length > 0 && (
            <Group gap={6} mt="xs">
              {Object.entries(preview.conteggi).map(([entity, count]) => (
                <Badge key={entity} variant="outline" color="gray">
                  {labelEntitaPulizia(entity)}: {count}
                </Badge>
              ))}
            </Group>
          )}

          {preview.blocchi.length > 0 && (
            <Alert color="orange" variant="light" mt="sm" py="xs">
              <Stack gap={4}>
                {preview.blocchi.slice(0, 4).map((blocco, index) => (
                  <Text key={`${blocco.titolo}-${index}`} size="xs">
                    <b>{blocco.titolo}</b>: {blocco.dettaglio}
                  </Text>
                ))}
                {preview.blocchi.length > 4 && (
                  <Text size="xs" c="dimmed">Altri blocchi: {preview.blocchi.length - 4}</Text>
                )}
              </Stack>
            </Alert>
          )}

          {preview.totaleRecord > 0 && !bloccata && (
            <Stack gap={8} mt="sm">
              <Button
                color="red"
                disabled={!puoEliminare || !inTauri}
                loading={eliminando}
                onClick={elimina}
                leftSection={<IconTrash size={16} />}
              >
                Elimina definitivamente
              </Button>
            </Stack>
          )}
        </Box>
      )}

      {ultimo && (
        <Alert color="green" variant="light" py="xs">
          <Group justify="space-between" gap="sm">
            <Text size="xs">
              Backup creato, {ultimo.purgati} record eliminati
              {ultimo.notificheRipulite ? `, ${ultimo.notificheRipulite} stati notifica ripuliti` : ""}
              {ultimo.compattato ? `, ${ultimo.tombstoneRimosse} tombstone rimosse` : ""}.
            </Text>
            <Anchor
              size="xs"
              component="button"
              type="button"
              onClick={() => api.apriCartellaBackup().catch((e) => toast.error(`Apertura cartella non riuscita: ${e}`))}
            >
              Apri backup
            </Anchor>
          </Group>
        </Alert>
      )}
    </Stack>
  );
}

function labelEntitaPulizia(entity: string): string {
  const labels: Record<string, string> = {
    ordine: "Ordini",
    riga_ordine: "Righe",
    pagamento: "Pagamenti",
    distinta: "Distinte",
    rimborso: "Rimborsi",
    spedizione: "Spedizioni",
    cliente: "Clienti",
    promemoria: "Promemoria",
    notifica_letta: "Stati notifica",
    comunicazione: "Comunicazioni",
  };
  return labels[entity] ?? entity;
}
