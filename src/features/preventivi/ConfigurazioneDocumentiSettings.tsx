import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconFileInvoice,
  IconPencil,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ConfigurazioneDocumenti,
  type ConfigurazioneDocumentiSalvaInput,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";

function inputDaConfig(
  config: ConfigurazioneDocumenti,
): ConfigurazioneDocumentiSalvaInput {
  return {
    revision: config.revision,
    denominazione: config.denominazione,
    indirizzo: config.indirizzo,
    localita: config.localita,
    telefono: config.telefono,
    email: config.email,
    sito: config.sito,
    validitaDefaultGiorni: config.validitaDefaultGiorni,
    condizioniDefault: config.condizioniDefault,
  };
}

export function ConfigurazioneDocumentiSettings() {
  const [config, setConfig] = useState<ConfigurazioneDocumenti | null>(null);
  const [form, setForm] =
    useState<ConfigurazioneDocumentiSalvaInput | null>(null);
  const [aperto, setAperto] = useState(false);
  const [caricando, setCaricando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [errore, setErrore] = useState("");

  const carica = useCallback(async () => {
    setCaricando(true);
    try {
      const corrente = await api.configurazioneDocumentiGet();
      setConfig(corrente);
      setErrore("");
    } catch (error) {
      setErrore(String(error));
    } finally {
      setCaricando(false);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const aggiorna = <K extends keyof ConfigurazioneDocumentiSalvaInput,>(
    key: K,
    value: ConfigurazioneDocumentiSalvaInput[K],
  ) => setForm((corrente) => (corrente ? { ...corrente, [key]: value } : corrente));

  const salva = async () => {
    if (!form || salvando) return;
    setSalvando(true);
    setErrore("");
    try {
      const salvata = await api.configurazioneDocumentiSalva(form);
      setConfig(salvata);
      setForm(inputDaConfig(salvata));
      setAperto(false);
      toast.success("Intestazione documenti aggiornata.");
    } catch (error) {
      setErrore(String(error));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <Group justify="space-between" align="center" wrap="nowrap" gap="md">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="yellow" radius="md" size="lg">
            <IconFileInvoice size={18} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600}>
              Intestazione preventivi e schede cliente
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {config
                ? `${config.denominazione} · ${config.email}`
                : caricando
                  ? "Caricamento…"
                  : "Configurazione non disponibile"}
            </Text>
          </Box>
        </Group>
        <Button
          variant="default"
          size="xs"
          leftSection={caricando ? <Loader size={14} /> : <IconPencil size={15} />}
          disabled={!config || caricando}
          onClick={() => {
            if (!config) return;
            setForm(inputDaConfig(config));
            setErrore("");
            setAperto(true);
          }}
        >
          Modifica
        </Button>
      </Group>
      {!aperto && errore && (
        <Alert icon={<IconAlertTriangle size={17} />} color="red">
          {errore}
        </Alert>
      )}

      <Modal
        opened={aperto}
        onClose={() => !salvando && setAperto(false)}
        title="Intestazione documenti"
        size="lg"
        centered
      >
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            {form && (
              <Stack gap="md">
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    label="Denominazione"
                    value={form.denominazione}
                    onChange={(event) =>
                      aggiorna("denominazione", event.currentTarget.value)
                    }
                    withAsterisk
                  />
                  <TextInput
                    label="Telefono"
                    value={form.telefono}
                    onChange={(event) =>
                      aggiorna("telefono", event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Indirizzo"
                    value={form.indirizzo}
                    onChange={(event) =>
                      aggiorna("indirizzo", event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Località"
                    value={form.localita}
                    onChange={(event) =>
                      aggiorna("localita", event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="E-mail"
                    value={form.email}
                    onChange={(event) =>
                      aggiorna("email", event.currentTarget.value)
                    }
                    withAsterisk
                  />
                  <TextInput
                    label="Sito"
                    value={form.sito}
                    onChange={(event) =>
                      aggiorna("sito", event.currentTarget.value)
                    }
                  />
                </SimpleGrid>
                <NumberInput
                  label="Validità predefinita"
                  value={form.validitaDefaultGiorni}
                  onChange={(value) =>
                    aggiorna(
                      "validitaDefaultGiorni",
                      typeof value === "number" ? value : 30,
                    )
                  }
                  min={1}
                  max={365}
                  suffix={
                    form.validitaDefaultGiorni === 1 ? " giorno" : " giorni"
                  }
                />
                <Textarea
                  label="Condizioni di pagamento predefinite"
                  value={form.condizioniDefault}
                  onChange={(event) =>
                    aggiorna("condizioniDefault", event.currentTarget.value)
                  }
                  autosize
                  minRows={2}
                  maxRows={5}
                />
                {errore && (
                  <Alert
                    icon={<IconAlertTriangle size={17} />}
                    color="red"
                    title="Salvataggio non riuscito"
                  >
                    {errore}
                  </Alert>
                )}
              </Stack>
            )}
          </Box>
          <div className="pt-modal-footer" style={{ justifyContent: "flex-end" }}>
            <div className="pt-modal-actions">
              <Button
                variant="default"
                disabled={salvando}
                onClick={() => setAperto(false)}
              >
                Annulla
              </Button>
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                loading={salvando}
                onClick={() => void salva()}
              >
                Salva
              </Button>
            </div>
          </div>
        </Box>
      </Modal>
    </>
  );
}
