import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconCalendar, IconFileSpreadsheet } from "@tabler/icons-react";
import { api } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { VirtualFlow } from "../../ui/VirtualFlow";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { dataPrevistaDefault } from "./datiProduzione";
import type { GruppoLotto } from "./tipiProduzione";

export interface RigaDataConsegnaPrevista {
  id: string;
  ordineNumero: string;
  descrizione: string;
  paziente: string;
  dataIniziale: string;
}

export type DataConsegnaTarget =
  | {
      modo: "gestione";
      scope: string;
      righe: RigaDataConsegnaPrevista[];
    }
  | {
      modo: "export";
      scope: string;
      righe: RigaDataConsegnaPrevista[];
      g: GruppoLotto;
    };

export function inizializzaDateConsegna(target: DataConsegnaTarget): Record<string, string> {
  const proposta = dataPrevistaDefault();
  const valori: Record<string, string> = {};
  for (const riga of target.righe) {
    valori[riga.id] = riga.dataIniziale || (target.modo === "export" ? proposta : "");
  }
  return valori;
}

export function DataConsegnaPrevistaModal({
  target,
  onClose,
  onSave,
  onContinueWithoutSave,
}: {
  target: DataConsegnaTarget | null;
  onClose: () => void;
  onSave: (valori: Record<string, string>, target: DataConsegnaTarget) => Promise<void> | void;
  onContinueWithoutSave: (target: Extract<DataConsegnaTarget, { modo: "export" }>) => void;
}) {
  const [mostrato, clearMostrato] = useModalSnapshot(target);
  const [valori, setValori] = useState<Record<string, string>>({});
  const [comune, setComune] = useState(() => dataPrevistaDefault());
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!target) return;
    setValori(inizializzaDateConsegna(target));
    setComune(dataPrevistaDefault());
  }, [target]);

  function applicaATutti(value: string) {
    setComune(value);
    setValori((precedenti) => {
      if (!mostrato) return precedenti;
      const successivi = { ...precedenti };
      for (const riga of mostrato.righe) successivi[riga.id] = value;
      return successivi;
    });
  }

  async function salva() {
    if (!mostrato) return;
    setSalvando(true);
    try {
      const correnti = await api.recordsList("riga_ordine");
      const correntiById = new Map(correnti.map((riga) => [riga.id, riga]));
      const puliti: Record<string, string> = {};
      const aggiornamenti: Array<{ id: string; valore: string }> = [];
      for (const riga of mostrato.righe) {
        const corrente = correntiById.get(riga.id);
        if (!corrente) {
          toast.warning("Un prodotto non è più disponibile. Chiudi e riapri il lotto prima di continuare.");
          return;
        }
        const iniziale = riga.dataIniziale.trim();
        const locale = (valori[riga.id] ?? "").trim();
        const remoto = typeof corrente.data.data_prevista === "string" ? corrente.data.data_prevista.trim() : "";
        const modificatoQui = locale !== iniziale;
        // Se questa riga non è stata toccata, usa l'eventuale valore remoto più recente
        // anche per l'export che segue, senza riscriverlo.
        puliti[riga.id] = modificatoQui ? locale : remoto;
        if (modificatoQui) aggiornamenti.push({ id: riga.id, valore: locale });
      }
      await Promise.all(
        aggiornamenti.map(({ id, valore }) =>
          api.recordUpdate("riga_ordine", id, { data_prevista: valore })
        )
      );
      await onSave(puliti, mostrato);
    } catch (e) {
      toast.error(`Salvataggio non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  const nCompilate = mostrato
    ? mostrato.righe.filter((riga) => (valori[riga.id] ?? "").trim() !== "").length
    : 0;
  const isExport = mostrato?.modo === "export";

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
            <IconCalendar size={18} />
          </ThemeIcon>
          <Text fw={700}>Data di consegna prevista</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: clearMostrato }}
    >
      {mostrato && (
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="md">
              <Text size="sm">
                {isExport
                  ? "Alcuni prodotti del lotto non hanno ancora la data di consegna prevista per il file Laboratorio. Puoi impostarla ora oppure esportare lasciandola vuota."
                  : "Imposta la data di consegna prevista comunicata dal laboratorio. Puoi applicare un valore comune e poi correggere i singoli prodotti."}
              </Text>
              <Text size="xs" c="dimmed">
                {mostrato.scope}
              </Text>
              <TextInput
                label="Imposta per tutti"
                size="xs"
                value={comune}
                onChange={(e) => applicaATutti(e.currentTarget.value)}
                placeholder="es. 3 giugno oppure 01/07/2026"
                data-autofocus
              />
              <VirtualFlow
                items={mostrato.righe}
                getKey={(riga) => riga.id}
                estimateHeight={42}
                gap={6}
                overscan={10}
                renderItem={(riga) => (
                  <Group gap="sm" wrap="nowrap">
                    <Badge variant="light" color="gray" radius="sm" style={{ flexShrink: 0 }}>
                      {riga.ordineNumero}
                    </Badge>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {riga.paziente || riga.descrizione}
                      </Text>
                      {riga.paziente && (
                        <Text size="xs" c="dimmed" truncate>
                          {riga.descrizione}
                        </Text>
                      )}
                    </Box>
                    <TextInput
                      size="xs"
                      w={170}
                      value={valori[riga.id] ?? ""}
                      onChange={(e) =>
                        setValori((precedenti) => ({
                          ...precedenti,
                          [riga.id]: e.currentTarget.value,
                        }))
                      }
                      placeholder="gg/mm/aaaa"
                    />
                  </Group>
                )}
              />
            </Stack>
          </Box>

          <div className="pt-modal-footer">
            <Text size="sm" c="dimmed" fw={500}>
              {nCompilate} / {mostrato.righe.length} date
            </Text>
            <div className="pt-modal-actions">
              <Button variant="subtle" color="gray" onClick={onClose} disabled={salvando}>
                Annulla
              </Button>
              {mostrato.modo === "export" && (
                <Button
                  variant="default"
                  disabled={salvando}
                  onClick={() => onContinueWithoutSave(mostrato)}
                >
                  Continua senza impostare
                </Button>
              )}
              <Button
                color="teal"
                leftSection={<IconFileSpreadsheet size={16} />}
                loading={salvando}
                disabled={salvando}
                onClick={salva}
              >
                {isExport ? "Imposta e continua" : "Salva"}
              </Button>
            </div>
          </div>
        </Box>
      )}
    </Modal>
  );
}
