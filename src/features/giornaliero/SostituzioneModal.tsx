// Sostituzione prodotto: da un ordine con problemi crea, in pochi click, un nuovo
// ordine **omaggio** per lo stesso cliente con i prodotti scelti (gratuiti, esclusi
// dalle provvigioni). Resta montato per animare correttamente entrata/uscita.
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { IconGift, IconInfoCircle } from "@tabler/icons-react";
import { api, type OrdineDto, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { oggiIso as oggi } from "../../lib/date";

interface RigaSost {
  prodottoId: string;
  nome: string;
  qta: number;
  paziente: string;
  scelta: boolean;
}

export function SostituzioneModal({
  ordine,
  onClose,
  onCreato,
}: {
  ordine: OrdineDto | null;
  onClose: () => void;
  onCreato: () => void;
}) {
  const [mostrato, setMostrato] = useState<OrdineDto | null>(ordine);
  const [righe, setRighe] = useState<RigaSost[]>([]);
  const [caricamento, setCaricamento] = useState(false);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (ordine) setMostrato(ordine);
  }, [ordine]);

  useEffect(() => {
    if (!ordine) return;
    setCaricamento(true);
    (async () => {
      try {
        const [righeTutte, prodotti] = await Promise.all([
          api.recordsList("riga_ordine"),
          api.recordsList("prodotto"),
        ]);
        const nomi = new Map(prodotti.map((p: RecordDto) => [p.id, (p.data.nome as string) || "(prodotto)"]));
        const mie = righeTutte
          .filter((r) => r.data.ordine_id === ordine.id && r.data.prodotto_id)
          .map((r) => ({
            prodottoId: r.data.prodotto_id as string,
            nome: nomi.get(r.data.prodotto_id as string) || "(prodotto)",
            qta: typeof r.data.qta === "number" ? r.data.qta : 1,
            paziente: (r.data.paziente as string) || "",
            scelta: true,
          }));
        setRighe(mie);
      } catch (e) {
        toast.error(`Caricamento prodotti non riuscito: ${e}`);
      } finally {
        setCaricamento(false);
      }
    })();
  }, [ordine]);

  async function crea() {
    if (!mostrato) return;
    const scelte = righe.filter((r) => r.scelta);
    if (scelte.length === 0) {
      toast.warning("Seleziona almeno un prodotto da sostituire.");
      return;
    }
    setCreando(true);
    try {
      const creato = await api.recordCreate("ordine", {
        data: oggi(),
        medico_id: mostrato.medicoId,
        agente_id: mostrato.agenteId,
        cliente_id: mostrato.clienteId,
        stato: "Nuovo",
        omaggio: true,
        acconto: 0,
        note: `Sostituzione ordine ${mostrato.numero}`,
      });
      for (const r of scelte) {
        await api.recordCreate("riga_ordine", {
          ordine_id: creato.id,
          prodotto_id: r.prodottoId,
          qta: r.qta,
          prezzo: 0, // omaggio: gratuito
          paziente: r.paziente,
          stato_riga: "da_spedire",
        });
      }
      toast.success("Ordine omaggio di sostituzione creato.");
      onCreato();
    } catch (e) {
      toast.error(`Creazione non riuscita: ${e}`);
    } finally {
      setCreando(false);
    }
  }

  const tutti = righe.length > 0 && righe.every((r) => r.scelta);
  const alcuni = righe.some((r) => r.scelta);

  return (
    <Modal
      opened={!!ordine}
      onClose={onClose}
      size="md"
      title={
        <Group gap="sm">
          <IconGift size={20} />
          <Text fw={700}>Sostituzione prodotto {mostrato ? `— Ordine ${mostrato.numero}` : ""}</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 200, onExited: () => setMostrato(null) }}
    >
      {mostrato && (
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="sm">
              <Alert variant="light" color="blue" icon={<IconInfoCircle size={18} />}>
                Crea un <b>nuovo ordine omaggio</b> per <b>{mostrato.clienteNome || "il cliente"}</b> con i
                prodotti scelti, gratuiti ed esclusi dalle provvigioni.
              </Alert>

              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  Prodotti da sostituire
                </Text>
                <Checkbox
                  size="xs"
                  label="Tutti"
                  checked={tutti}
                  indeterminate={alcuni && !tutti}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    setRighe((rs) => rs.map((r) => ({ ...r, scelta: v })));
                  }}
                />
              </Group>

              <Stack gap={6}>
                {caricamento ? (
                  <Text size="sm" c="dimmed">
                    Caricamento…
                  </Text>
                ) : righe.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    L'ordine non ha prodotti da sostituire.
                  </Text>
                ) : (
                  righe.map((r, i) => (
                    <Checkbox
                      key={`${r.prodottoId}-${i}`}
                      checked={r.scelta}
                      onChange={(e) => {
                        const v = e.currentTarget.checked;
                        setRighe((rs) => rs.map((x, j) => (j === i ? { ...x, scelta: v } : x)));
                      }}
                      label={
                        <Group gap={8}>
                          <Badge size="sm" variant="light" color="gray">
                            ×{r.qta}
                          </Badge>
                          <Text size="sm">{r.nome}</Text>
                          {r.paziente && (
                            <Text size="xs" c="dimmed">
                              ({r.paziente})
                            </Text>
                          )}
                        </Group>
                      }
                    />
                  ))
                )}
              </Stack>
            </Stack>
          </Box>

          <div className="pt-modal-footer" style={{ justifyContent: "flex-end" }}>
            <div className="pt-modal-actions">
              <Button variant="default" onClick={onClose} disabled={creando}>
                Annulla
              </Button>
              <Button color="accent" leftSection={<IconGift size={16} />} onClick={crea} loading={creando} disabled={!alcuni}>
                Crea ordine omaggio
              </Button>
            </div>
          </div>
        </Box>
      )}
    </Modal>
  );
}
