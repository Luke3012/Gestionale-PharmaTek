// Storico di un record (chi/cosa/quando), ricostruito dagli eventi, con la
// possibilità di annullare una singola modifica (revert al valore precedente).
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Center, Group, Loader, Modal, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconArrowBackUp,
  IconCircleX,
  IconPencil,
  IconPlus,
  IconRestore,
  IconTrash,
} from "@tabler/icons-react";
import { api, type StoricoVoce } from "../lib/tauri";
import { toast } from "./toast/store";
import { etichettaCampoStorico, formattaDataOraStorico, formattaValoreStorico } from "./storicoFormat";
import { useRicaricaSuEventi } from "../lib/useRicaricaSuEventi";

const META: Record<StoricoVoce["op"], { label: string; color: string; Ico: typeof IconPlus }> = {
  created: { label: "Creato", color: "green", Ico: IconPlus },
  field_set: { label: "Modifica", color: "blue", Ico: IconPencil },
  deleted: { label: "Nel Cestino", color: "orange", Ico: IconTrash },
  restored: { label: "Ripristinato", color: "teal", Ico: IconRestore },
  purged: { label: "Eliminato def.", color: "red", Ico: IconCircleX },
};

export function StoricoModal({
  entity,
  id,
  etichetta,
  onClose,
  onChanged,
}: {
  entity: string;
  id: string;
  etichetta: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [voci, setVoci] = useState<StoricoVoce[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [utenti, setUtenti] = useState<Record<string, string>>({});
  const eventiRicarica = useMemo(() => [`${entity}:salvato`] as const, [entity]);

  async function carica() {
    try {
      setVoci(await api.recordStorico(entity, id));
    } catch (e) {
      toast.error(`Storico non disponibile: ${e}`);
    } finally {
      setCaricamento(false);
    }
  }

  useEffect(() => {
    carica();
    // Mappa userId → nome per non mostrare codici "strani".
    api
      .getUsers()
      .then((us) => setUtenti(Object.fromEntries(us.map((u) => [u.id, u.nome]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, id]);

  useRicaricaSuEventi(eventiRicarica, carica, 180);

  function nomeUtente(uid: string): string {
    return utenti[uid] || "";
  }

  // Gli eventi della creazione (Created + i campi impostati subito) vengono
  // accorpati nella sola voce "Creato": non li elenchiamo come modifiche.
  const creationMs = voci[0]?.op === "created" ? voci[0].ms : -1;

  // Valore del campo subito prima dell'evento all'indice `idx`.
  function valorePrecedente(field: string, idx: number): unknown {
    for (let i = idx - 1; i >= 0; i--) {
      const v = voci[i];
      if (v.op === "field_set" && v.field === field) return v.value;
    }
    return "";
  }

  async function annulla(field: string, idx: number) {
    try {
      await api.recordUpdate(entity, id, { [field]: valorePrecedente(field, idx) });
      toast.success("Modifica annullata.");
      onChanged?.();
      carica();
    } catch (e) {
      toast.error(`Annullamento non riuscito: ${e}`);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      size="lg"
      title={<Text fw={700}>Storico — {etichetta}</Text>}
      transitionProps={{ transition: "fade", duration: 180 }}
    >
      {caricamento ? (
        <Center p="xl">
          <Loader />
        </Center>
      ) : voci.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="md">
          Nessuna modifica registrata.
        </Text>
      ) : (
        <Stack gap={8}>
          {voci
            .map((v, idx) => ({ v, idx }))
            .filter(({ v }) => !(v.op === "field_set" && creationMs >= 0 && v.ms - creationMs < 2000))
            .reverse()
            .map(({ v, idx }) => {
              const m = META[v.op];
              return (
                <Group key={idx} justify="space-between" wrap="nowrap" align="flex-start">
                  <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                    <ThemeIcon size={28} radius="md" variant="light" color={m.color}>
                      <m.Ico size={16} />
                    </ThemeIcon>
                    <Box style={{ minWidth: 0 }}>
                      <Text size="sm">
                        {v.op === "field_set" ? (
                          <>
                            <b>{etichettaCampoStorico(v.field ?? "")}</b> → {formattaValoreStorico(v.value)}
                          </>
                        ) : (
                          <b>{m.label}</b>
                        )}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formattaDataOraStorico(v.ms)}
                        {nomeUtente(v.user) ? ` · ${nomeUtente(v.user)}` : ""}
                      </Text>
                    </Box>
                  </Group>
                  {v.op === "field_set" && v.field && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<IconArrowBackUp size={13} />}
                      onClick={() => annulla(v.field!, idx)}
                    >
                      Annulla
                    </Button>
                  )}
                </Group>
              );
            })}
        </Stack>
      )}
    </Modal>
  );
}
