import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBrandWhatsapp,
  IconBraces,
  IconChevronDown,
  IconKey,
  IconMail,
  IconPlus,
  IconSend,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import {
  api,
  inTauri,
  type ConfigurazioneEmail,
  type ConfigurazioneEmailSalvaInput,
  type ModelloComunicazione,
  type ModelloComunicazioneSalvaInput,
  type TipoModelloComunicazione,
  type WhatsappDiagnostica,
} from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";

const PRESET: ConfigurazioneEmailSalvaInput = {
  nomeMittente: "PharmaTek",
  indirizzoMittente: "",
  smtpHost: "smtp.example.invalid",
  smtpPort: 465,
  smtpSicurezza: "ssl_tls",
  smtpUsername: "",
  replyToAbilitato: false,
  replyTo: "",
  firma: "",
  salvaPostaInviata: true,
  imapHost: "imap.example.invalid",
  imapPort: 993,
  imapSicurezza: "ssl_tls",
  destinatarioProva: "",
  password: "",
};

function formDaConfig(
  config: ConfigurazioneEmail,
): ConfigurazioneEmailSalvaInput {
  return {
    nomeMittente: config.nomeMittente,
    indirizzoMittente: config.indirizzoMittente,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSicurezza: config.smtpSicurezza,
    smtpUsername: config.smtpUsername,
    replyToAbilitato: config.replyToAbilitato,
    replyTo: config.replyTo,
    firma: config.firma,
    salvaPostaInviata: config.salvaPostaInviata,
    imapHost: config.imapHost,
    imapPort: config.imapPort,
    imapSicurezza: config.imapSicurezza,
    destinatarioProva: config.destinatarioProva,
    password: "",
  };
}

function ContenutoModaleComunicazioni({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea
      className="pt-modal-scroll"
      type="auto"
      scrollbarSize={7}
      offsetScrollbars
    >
      <Stack gap="lg" pr="xs">{children}</Stack>
    </ScrollArea>
  );
}

function CanaleCard({
  icona,
  colore,
  titolo,
  descrizione,
  stato,
  onClick,
  disabled,
  actionLabel = "Configura",
}: {
  icona: React.ReactNode;
  colore: string;
  titolo: string;
  descrizione: string;
  stato: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  actionLabel?: string;
}) {
  return (
    <Card withBorder radius="md" p="md">
      <Stack gap="sm" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <ThemeIcon size={38} radius="md" variant="light" color={colore}>
            {icona}
          </ThemeIcon>
          {stato}
        </Group>
        <Box style={{ flex: 1 }}>
          <Text fw={700} size="sm">
            {titolo}
          </Text>
          <Text size="xs" c="dimmed" mt={3}>
            {descrizione}
          </Text>
        </Box>
        <Button
          variant="default"
          size="xs"
          fullWidth
          onClick={onClick}
          disabled={disabled}
        >
          {actionLabel}
        </Button>
      </Stack>
    </Card>
  );
}

export function ComunicazioniSettings({ onReady }: { onReady?: () => void }) {
  const [config, setConfig] = useState<ConfigurazioneEmail | null>(null);
  const [form, setForm] = useState<ConfigurazioneEmailSalvaInput>(PRESET);
  const [aperto, setAperto] = useState(false);
  const [avanzate, setAvanzate] = useState(false);
  const [caricando, setCaricando] = useState(true);
  const [salvando, setSalvando] = useState<"salva" | "prova" | null>(null);
  const [errore, setErrore] = useState("");
  const [modelli, setModelli] = useState<ModelloComunicazione[]>([]);
  const [modelliAperti, setModelliAperti] = useState(false);
  const [modelliCaricando, setModelliCaricando] = useState(true);
  const [modelloSelezionato, setModelloSelezionato] = useState("");
  const [modelloForm, setModelloForm] =
    useState<ModelloComunicazioneSalvaInput | null>(null);
  const [modelloSalvando, setModelloSalvando] = useState(false);
  const [modelloErrore, setModelloErrore] = useState("");
  const [whatsappAperto, setWhatsappAperto] = useState(false);
  const [whatsappNome, setWhatsappNome] = useState("");
  const [whatsappTelefono, setWhatsappTelefono] = useState("");
  const [whatsappDiagnostica, setWhatsappDiagnostica] =
    useState<WhatsappDiagnostica | null>(null);
  const [whatsappCaricando, setWhatsappCaricando] = useState(false);
  const [whatsappInvio, setWhatsappInvio] = useState(false);
  const [whatsappErrore, setWhatsappErrore] = useState("");
  const [whatsappPronto, setWhatsappPronto] = useState(false);

  const carica = useCallback(async () => {
    if (!inTauri) {
      setCaricando(false);
      return;
    }
    try {
      const corrente = await api.configurazioneEmailGet();
      setConfig(corrente);
      setForm(formDaConfig(corrente));
      setErrore("");
    } catch (error) {
      setErrore(String(error));
    } finally {
      setCaricando(false);
    }
  }, []);

  const caricaModelli = useCallback(async () => {
    if (!inTauri) {
      setModelliCaricando(false);
      return [] as ModelloComunicazione[];
    }
    setModelliCaricando(true);
    try {
      const lista = await api.modelliComunicazioneLista();
      setModelli(lista);
      return lista;
    } catch (error) {
      setModelloErrore(String(error));
      return [] as ModelloComunicazione[];
    } finally {
      setModelliCaricando(false);
    }
  }, []);

  useEffect(() => {
    void carica();
    void caricaModelli();
  }, [carica, caricaModelli]);

  const apri = () => {
    setForm(config ? formDaConfig(config) : PRESET);
    setErrore("");
    setAvanzate(false);
    setAperto(true);
  };

  const chiudi = () => {
    if (salvando) return;
    setAperto(false);
    setErrore("");
  };

  const selezionaModello = (modello: ModelloComunicazione) => {
    setModelloSelezionato(modello.id);
    setModelloForm({
      id: modello.id,
      tipo: modello.tipo,
      titolo: modello.titolo,
      oggetto: modello.oggetto,
      corpo: modello.corpo,
      attivo: modello.attivo,
    });
    setModelloErrore("");
  };

  const nuovoModello = () => {
    const tipo =
      modelloCorrente?.tipo ??
      ("sollecito_pagamento" satisfies TipoModelloComunicazione);
    setModelloSelezionato("");
    setModelloForm({
      tipo,
      titolo: "",
      oggetto: "",
      corpo: "",
      attivo: true,
    });
    setModelloErrore("");
  };

  const apriModelli = async () => {
    setModelliAperti(true);
    setModelloErrore("");
    const lista = await caricaModelli();
    const corrente =
      lista.find((modello) => modello.id === modelloSelezionato) ?? lista[0];
    if (corrente) selezionaModello(corrente);
  };

  const salvaModello = async () => {
    if (!modelloForm || modelloSalvando) return;
    setModelloSalvando(true);
    setModelloErrore("");
    try {
      const salvato = await api.modelloComunicazioneSalva(modelloForm);
      setModelli((correnti) => {
        const esiste = correnti.some((modello) => modello.id === salvato.id);
        const prossimi = esiste
          ? correnti.map((modello) =>
              modello.id === salvato.id ? salvato : modello,
            )
          : [...correnti, salvato];
        return prossimi.sort((a, b) =>
          `${a.tipo}:${a.titolo}`.localeCompare(`${b.tipo}:${b.titolo}`, "it"),
        );
      });
      selezionaModello(salvato);
      toast.success(
        modelloForm.id ? "Modello aggiornato." : "Modello aggiunto.",
      );
    } catch (error) {
      setModelloErrore(String(error));
    } finally {
      setModelloSalvando(false);
    }
  };

  const modelloCorrente = modelli.find(
    (modello) => modello.id === modelloSelezionato,
  );
  const variabiliModello =
    modelli.find((modello) => modello.tipo === modelloForm?.tipo)
      ?.variabiliDisponibili ?? [];

  const eliminaModello = async () => {
    if (!modelloCorrente || modelloCorrente.predefinito || modelloSalvando)
      return;
    const confermato = await dialog.confirmDanger(
      "Rimuovere il modello?",
      `Il modello “${modelloCorrente.titolo}” non sarà più disponibile per i nuovi messaggi.`,
      { conferma: "Rimuovi", annulla: "Annulla" },
    );
    if (!confermato) return;
    setModelloSalvando(true);
    setModelloErrore("");
    try {
      await api.modelloComunicazioneElimina(modelloCorrente.id);
      const prossimi = modelli.filter(
        (modello) => modello.id !== modelloCorrente.id,
      );
      setModelli(prossimi);
      if (prossimi[0]) selezionaModello(prossimi[0]);
      else {
        setModelloSelezionato("");
        setModelloForm(null);
      }
      toast.success("Modello rimosso.");
    } catch (error) {
      setModelloErrore(String(error));
    } finally {
      setModelloSalvando(false);
    }
  };

  const inputPulito = useMemo(
    () => ({
      ...form,
      password: form.password?.length ? form.password : undefined,
    }),
    [form],
  );

  const salva = async (prova: boolean) => {
    setSalvando(prova ? "prova" : "salva");
    setErrore("");
    try {
      const aggiornata = prova
        ? await api.configurazioneEmailVerificaEInviaProva(inputPulito)
        : await api.configurazioneEmailSalva(inputPulito);
      setConfig(aggiornata);
      setForm(formDaConfig(aggiornata));
      setAperto(false);
      if (prova) {
        const avviso = aggiornata.ultimaProva?.avviso;
        if (avviso) toast.warning(avviso);
        else toast.success(`Prova inviata a ${aggiornata.destinatarioProva}.`);
      } else {
        toast.success("Configurazione e-mail salvata.");
      }
    } catch (error) {
      setErrore(String(error));
    } finally {
      setSalvando(null);
    }
  };

  const caricaDiagnosticaWhatsapp = useCallback(async (rapida = false) => {
    if (!inTauri) {
      setWhatsappPronto(true);
      return;
    }
    if (!rapida) setWhatsappCaricando(true);
    try {
      setWhatsappDiagnostica(
        rapida
          ? await api.whatsappStatoGet()
          : await api.whatsappDiagnosticaGet(),
      );
    } catch (error) {
      setWhatsappErrore(String(error));
    } finally {
      if (!rapida) setWhatsappCaricando(false);
      setWhatsappPronto(true);
    }
  }, []);

  useEffect(() => {
    void caricaDiagnosticaWhatsapp(true);
  }, [caricaDiagnosticaWhatsapp]);

  useEffect(() => {
    if (!caricando && !modelliCaricando && whatsappPronto) onReady?.();
  }, [caricando, modelliCaricando, onReady, whatsappPronto]);

  const apriWhatsapp = () => {
    setWhatsappErrore("");
    setWhatsappAperto(true);
    void caricaDiagnosticaWhatsapp();
  };

  const verificaWhatsapp = async () => {
    if (!whatsappNome.trim() || !whatsappTelefono.trim() || whatsappInvio)
      return;
    const confermato = await dialog.confirm(
      "Inviare il collaudo WhatsApp?",
      `PharmaTek invierà a ${whatsappNome.trim()} un messaggio di prova e un secondo messaggio con un piccolo PDF diagnostico.`,
      { conferma: "Invia i due messaggi", annulla: "Annulla" },
    );
    if (!confermato) return;
    setWhatsappInvio(true);
    setWhatsappErrore("");
    try {
      const risultato = await api.whatsappVerificaEInviaProva({
        nome: whatsappNome.trim(),
        telefono: whatsappTelefono.trim(),
      });
      setWhatsappDiagnostica(risultato.diagnostica);
      toast.success("Collaudo WhatsApp completato: testo e PDF inviati.");
    } catch (error) {
      setWhatsappErrore(String(error));
      await caricaDiagnosticaWhatsapp();
    } finally {
      setWhatsappInvio(false);
    }
  };

  const passwordStato = config?.passwordPresenteLocale ? (
    <Badge color="teal" variant="light">
      Configurata
    </Badge>
  ) : (
    <Badge color="gray" variant="light">
      Da configurare
    </Badge>
  );
  const whatsappAvviso =
    whatsappErrore || whatsappDiagnostica?.ultimoEsito?.messaggio || "";

  return (
    <>
      <Stack gap="md">
        {errore && !aperto && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} py="xs">
            <Text size="xs">{errore}</Text>
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <CanaleCard
            icona={<IconMail size={21} />}
            colore="blue"
            titolo="E-mail"
            descrizione={
              config?.configurata
                ? `${config.nomeMittente} · ${config.indirizzoMittente}`
                : "Casella Aruba precompilata, da verificare."
            }
            stato={
              passwordStato
            }
            onClick={apri}
            disabled={caricando || !inTauri}
          />
          <CanaleCard
            icona={<IconBrandWhatsapp size={21} />}
            colore="green"
            titolo="WhatsApp"
            descrizione="Collaudo locale dell'app Windows, del testo e degli allegati."
            stato={
              whatsappDiagnostica?.ultimoEsito?.riuscito ? (
                <Badge color="teal" variant="light">
                  Compatibile
                </Badge>
              ) : whatsappDiagnostica?.ultimoEsito ? (
                <Badge color="red" variant="light">
                  Da verificare
                </Badge>
              ) : (
                <Badge color="gray" variant="light">
                  Questo PC
                </Badge>
              )
            }
            onClick={apriWhatsapp}
            disabled={!inTauri}
            actionLabel="Verifica su questo PC"
          />
        </SimpleGrid>

        <Divider />

        <Group justify="space-between" align="center" wrap="nowrap" gap="md">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" color="grape" radius="md" size="lg">
              <IconTemplate size={18} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Group gap="xs">
                <Text size="sm" fw={600}>
                  Modelli di comunicazione
                </Text>
                {!modelliCaricando && (
                  <Badge
                    color={modelli.length ? "grape" : "gray"}
                    variant="light"
                    size="sm"
                  >
                    {modelli.length} {modelli.length === 1 ? "modello" : "modelli"}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed" truncate>
                Testi condivisi per solleciti, preventivi e spedizioni.
              </Text>
            </Box>
          </Group>
          <Button
            variant="default"
            size="xs"
            leftSection={<IconTemplate size={15} />}
            disabled={!inTauri || modelliCaricando}
            onClick={() => void apriModelli()}
          >
            Configura
          </Button>
        </Group>
      </Stack>

      <Modal
        opened={aperto}
        onClose={chiudi}
        title={
          <Group gap="sm">
            <ThemeIcon variant="light" color="blue" radius="md">
              <IconMail size={18} />
            </ThemeIcon>
            <Text fw={700}>Configura e-mail</Text>
          </Group>
        }
        size="lg"
        centered
        closeOnClickOutside={!salvando}
        closeOnEscape={!salvando}
        transitionProps={{ transition: "fade", duration: 180 }}
      >
        <div className="pt-modal-shell">
          <ContenutoModaleComunicazioni>
              {errore && (
                <Alert color="red" icon={<IconAlertTriangle size={17} />}>
                  <Text size="sm">{errore}</Text>
                </Alert>
              )}

              <Stack gap="sm">
                <Text fw={700} size="sm">
                  Mittente
                </Text>
                <TextInput
                  label="Nome visualizzato"
                  value={form.nomeMittente}
                  onChange={(event) => {
                    const nomeMittente = event.currentTarget.value;
                    setForm((value) => ({ ...value, nomeMittente }));
                  }}
                  required
                />
                <TextInput
                  label="Indirizzo e-mail"
                  value={form.indirizzoMittente}
                  onChange={(event) => {
                    const indirizzoMittente = event.currentTarget.value;
                    setForm((value) => ({ ...value, indirizzoMittente }));
                  }}
                  required
                />
                <TextInput
                  label="Nome utente"
                  description="Per Aruba coincide normalmente con l'indirizzo completo."
                  value={form.smtpUsername}
                  onChange={(event) => {
                    const smtpUsername = event.currentTarget.value;
                    setForm((value) => ({ ...value, smtpUsername }));
                  }}
                  required
                />
                <PasswordInput
                  label={
                    config?.passwordPresenteLocale
                      ? "Nuova password"
                      : "Password"
                  }
                  leftSection={<IconKey size={16} />}
                  value={form.password ?? ""}
                  onChange={(event) => {
                    const password = event.currentTarget.value;
                    setForm((value) => ({ ...value, password }));
                  }}
                  required={!config?.passwordPresenteLocale}
                />
              </Stack>

              <Divider />

              <Stack gap="sm">
                <Switch
                  checked={form.replyToAbilitato}
                  onChange={(event) => {
                    const replyToAbilitato = event.currentTarget.checked;
                    setForm((value) => ({ ...value, replyToAbilitato }));
                  }}
                  label="Usa un indirizzo “Rispondi a” diverso"
                  description="Se attivo, le risposte saranno indirizzate a Livio."
                />
                <TextInput
                  label="Rispondi a"
                  value={form.replyTo}
                  disabled={!form.replyToAbilitato}
                  onChange={(event) => {
                    const replyTo = event.currentTarget.value;
                    setForm((value) => ({ ...value, replyTo }));
                  }}
                />
                <Textarea
                  label="Firma"
                  description="Facoltativa; per ora può restare vuota."
                  autosize
                  minRows={2}
                  maxRows={5}
                  value={form.firma}
                  onChange={(event) => {
                    const firma = event.currentTarget.value;
                    setForm((value) => ({ ...value, firma }));
                  }}
                />
              </Stack>

              <Divider />

              <Stack gap="sm">
                <Switch
                  checked={form.salvaPostaInviata}
                  onChange={(event) => {
                    const salvaPostaInviata = event.currentTarget.checked;
                    setForm((value) => ({ ...value, salvaPostaInviata }));
                  }}
                  label="Salva una copia nella Posta inviata"
                  description="La copia sarà visibile anche dagli altri client collegati via IMAP."
                />
                <TextInput
                  label="Destinatario della prova"
                  value={form.destinatarioProva}
                  onChange={(event) => {
                    const destinatarioProva = event.currentTarget.value;
                    setForm((value) => ({ ...value, destinatarioProva }));
                  }}
                  required
                />
              </Stack>

              <Divider />

              <Button
                variant="subtle"
                color="gray"
                justify="space-between"
                rightSection={
                  <IconChevronDown
                    size={16}
                    style={{
                      transform: avanzate ? "rotate(180deg)" : undefined,
                      transition: "transform 140ms ease",
                    }}
                  />
                }
                onClick={() => setAvanzate((value) => !value)}
                aria-expanded={avanzate}
              >
                Parametri avanzati
              </Button>
              <Collapse expanded={avanzate}>
                <Stack gap="md" pb="xs">
                  <Text size="xs" c="dimmed">
                    Preset Aruba SSL/TLS. Modificalo soltanto se cambia il
                    fornitore.
                  </Text>
                  <SimpleGrid cols={{ base: 1, xs: 2 }}>
                    <TextInput
                      label="Server di invio"
                      value={form.smtpHost}
                      onChange={(event) => {
                        const smtpHost = event.currentTarget.value;
                        setForm((value) => ({ ...value, smtpHost }));
                      }}
                    />
                    <NumberInput
                      label="Porta"
                      value={form.smtpPort}
                      min={1}
                      max={65535}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          smtpPort:
                            typeof value === "number"
                              ? value
                              : Number(value) || 465,
                        }))
                      }
                    />
                    <Select
                      label="Sicurezza invio"
                      data={[
                        { value: "ssl_tls", label: "SSL/TLS" },
                        { value: "starttls", label: "STARTTLS" },
                      ]}
                      value={form.smtpSicurezza}
                      allowDeselect={false}
                      onChange={(value) =>
                        value &&
                        setForm((current) => ({
                          ...current,
                          smtpSicurezza: value as "ssl_tls" | "starttls",
                        }))
                      }
                    />
                  </SimpleGrid>
                  <SimpleGrid cols={{ base: 1, xs: 2 }}>
                    <TextInput
                      label="Server Posta inviata"
                      value={form.imapHost}
                      disabled={!form.salvaPostaInviata}
                      onChange={(event) => {
                        const imapHost = event.currentTarget.value;
                        setForm((value) => ({ ...value, imapHost }));
                      }}
                    />
                    <NumberInput
                      label="Porta"
                      value={form.imapPort}
                      min={1}
                      max={65535}
                      disabled={!form.salvaPostaInviata}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          imapPort:
                            typeof value === "number"
                              ? value
                              : Number(value) || 993,
                        }))
                      }
                    />
                    <Select
                      label="Sicurezza Posta inviata"
                      data={[
                        { value: "ssl_tls", label: "SSL/TLS" },
                        { value: "starttls", label: "STARTTLS" },
                      ]}
                      value={form.imapSicurezza}
                      disabled={!form.salvaPostaInviata}
                      allowDeselect={false}
                      onChange={(value) =>
                        value &&
                        setForm((current) => ({
                          ...current,
                          imapSicurezza: value as "ssl_tls" | "starttls",
                        }))
                      }
                    />
                  </SimpleGrid>
                </Stack>
              </Collapse>
          </ContenutoModaleComunicazioni>

          <Group
            justify="space-between"
            mt="lg"
            pt="md"
            className="pt-modal-footer"
          >
            <Button
              variant="subtle"
              color="gray"
              onClick={chiudi}
              disabled={!!salvando}
            >
              Annulla
            </Button>
            <Group gap="sm">
              <Button
                variant="default"
                onClick={() => void salva(false)}
                loading={salvando === "salva"}
                disabled={!!salvando || !inTauri}
              >
                Salva
              </Button>
              <Button
                leftSection={<IconSend size={17} />}
                onClick={() => void salva(true)}
                loading={salvando === "prova"}
                disabled={!!salvando || !inTauri}
              >
                Verifica e invia prova
              </Button>
            </Group>
          </Group>
        </div>
      </Modal>

      <Modal
        opened={whatsappAperto}
        onClose={() => {
          if (!whatsappInvio) setWhatsappAperto(false);
        }}
        title={
          <Group gap="sm">
            <ThemeIcon variant="light" color="green" radius="md">
              <IconBrandWhatsapp size={18} />
            </ThemeIcon>
            <Text fw={700}>Verifica WhatsApp su questo PC</Text>
          </Group>
        }
        size="lg"
        centered
        closeOnClickOutside={!whatsappInvio}
        closeOnEscape={!whatsappInvio}
        transitionProps={{ transition: "fade", duration: 180 }}
      >
        <div className="pt-modal-shell">
          <ContenutoModaleComunicazioni>
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Box>
                    <Text size="sm" fw={700}>
                      Stato su questo PC
                    </Text>
                    <Text size="xs" c="dimmed">
                      Installazione e automazione di WhatsApp Desktop
                    </Text>
                  </Box>
                  <Badge
                    color={
                      whatsappDiagnostica?.ultimoEsito?.riuscito
                        ? "teal"
                        : whatsappDiagnostica?.ultimoEsito
                          ? "red"
                          : "gray"
                    }
                    variant="light"
                  >
                    {whatsappCaricando
                      ? "Controllo…"
                      : whatsappDiagnostica?.ultimoEsito?.riuscito
                        ? "Compatibile"
                        : whatsappDiagnostica?.ultimoEsito
                          ? `Errore · ${whatsappDiagnostica.ultimoEsito.fase}`
                          : "Non collaudato"}
                  </Badge>
                </Group>

                <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs">
                  <Box>
                    <Text size="xs" c="dimmed">
                      Protocollo locale
                    </Text>
                    <Text size="sm" fw={600}>
                      {whatsappCaricando
                        ? "Controllo in corso…"
                        : whatsappDiagnostica?.protocolloRegistrato
                          ? "Registrato"
                          : "Non rilevato"}
                    </Text>
                  </Box>
                  <Box>
                    <Text size="xs" c="dimmed">
                      Applicazione rilevata
                    </Text>
                    <Text size="sm" fw={600} truncate>
                      {whatsappDiagnostica?.processo || "—"}
                    </Text>
                  </Box>
                  {!!whatsappDiagnostica?.versione && (
                    <Box>
                      <Text size="xs" c="dimmed">
                        Versione
                      </Text>
                      <Text size="sm" fw={600}>
                        {whatsappDiagnostica.versione}
                      </Text>
                    </Box>
                  )}
                  {!!whatsappDiagnostica?.campioniPrestazioni && (
                    <Box>
                      <Text size="xs" c="dimmed">
                        Tempi della sessione
                      </Text>
                      <Text size="sm" fw={600}>
                        Mediana {whatsappDiagnostica.medianaMs} ms · p95{" "}
                        {whatsappDiagnostica.percentile95Ms} ms
                      </Text>
                    </Box>
                  )}
                </SimpleGrid>

                {whatsappAvviso && (
                  <Alert color="red" variant="light" py="xs">
                    <Text size="xs">{whatsappAvviso}</Text>
                  </Alert>
                )}
              </Stack>

              <Divider />

              <Stack gap="sm">
                <Box>
                  <Text size="sm" fw={700}>
                    Destinatario del collaudo
                  </Text>
                  <Text size="xs" c="dimmed">
                    Verranno inviati realmente un messaggio e un piccolo PDF.
                    Inserisci il numero con prefisso internazionale oppure un
                    numero italiano.
                  </Text>
                </Box>
                <SimpleGrid cols={{ base: 1, xs: 2 }}>
                  <TextInput
                    label="Nome destinatario"
                    value={whatsappNome}
                    disabled={whatsappInvio}
                    onChange={(event) =>
                      setWhatsappNome(event.currentTarget.value)
                    }
                    required
                  />
                  <TextInput
                    label="Numero WhatsApp"
                    value={whatsappTelefono}
                    disabled={whatsappInvio}
                    onChange={(event) =>
                      setWhatsappTelefono(event.currentTarget.value)
                    }
                    required
                  />
                </SimpleGrid>
              </Stack>

          </ContenutoModaleComunicazioni>

          <Group
            justify="space-between"
            mt="lg"
            pt="md"
            className="pt-modal-footer"
          >
            <Button
              variant="subtle"
              color="gray"
              disabled={whatsappInvio}
              onClick={() => setWhatsappAperto(false)}
            >
              Chiudi
            </Button>
            <Button
              color="green"
              leftSection={<IconSend size={17} />}
              loading={whatsappInvio}
              disabled={
                whatsappCaricando ||
                !whatsappNome.trim() ||
                !whatsappTelefono.trim()
              }
              onClick={() => void verificaWhatsapp()}
            >
              Verifica e invia prova
            </Button>
          </Group>
        </div>
      </Modal>

      <Modal
        opened={modelliAperti}
        onClose={() => {
          if (!modelloSalvando) setModelliAperti(false);
        }}
        title={
          <Group gap="sm">
            <ThemeIcon variant="light" color="grape" radius="md">
              <IconTemplate size={18} />
            </ThemeIcon>
            <Text fw={700}>Modelli di comunicazione</Text>
          </Group>
        }
        size="xl"
        centered
        closeOnClickOutside={!modelloSalvando}
        closeOnEscape={!modelloSalvando}
        transitionProps={{ transition: "fade", duration: 180 }}
      >
        <div className="pt-modal-shell">
          <ContenutoModaleComunicazioni>
              {modelloErrore && (
                <Alert color="red" icon={<IconAlertTriangle size={17} />}>
                  <Text size="sm">{modelloErrore}</Text>
                </Alert>
              )}

              <Group align="end" wrap="nowrap">
                <Select
                  label="Modello"
                  leftSection={<IconTemplate size={16} />}
                  data={modelli.map((modello) => ({
                    value: modello.id,
                    label: `${modello.titolo} · ${modello.tipoLabel}${
                      modello.predefinito ? " · Base" : ""
                    }`,
                  }))}
                  value={modelloSelezionato || null}
                  searchable
                  allowDeselect={false}
                  disabled={modelliCaricando || modelloSalvando}
                  placeholder={
                    modelliCaricando ? "Caricamento…" : "Nuovo modello"
                  }
                  onChange={(id) => {
                    const modello = modelli.find((item) => item.id === id);
                    if (modello) selezionaModello(modello);
                  }}
                  style={{ flex: 1 }}
                />
                <Button
                  variant="default"
                  leftSection={<IconPlus size={16} />}
                  onClick={nuovoModello}
                  disabled={modelliCaricando || modelloSalvando}
                >
                  Aggiungi
                </Button>
              </Group>

              {modelloForm && (
                <>
                  <Group justify="space-between" align="center">
                    <Group gap="xs">
                      <ThemeIcon variant="light" color="grape" size="md">
                        <IconTemplate size={16} />
                      </ThemeIcon>
                      <Text size="sm" fw={700}>
                        {modelloCorrente?.predefinito
                          ? "Modello base"
                          : modelloCorrente
                            ? "Modello personalizzato"
                            : "Nuovo modello"}
                      </Text>
                    </Group>
                    <Switch
                      checked={modelloForm.attivo ?? true}
                      label="Attivo"
                      onChange={(event) => {
                        const attivo = event.currentTarget.checked;
                        setModelloForm((corrente) =>
                          corrente ? { ...corrente, attivo } : corrente,
                        );
                      }}
                    />
                  </Group>

                  <Select
                    label="Uso"
                    description="Determina in quali punti del gestionale viene proposto."
                    value={modelloForm.tipo}
                    allowDeselect={false}
                    disabled={modelloCorrente?.predefinito}
                    data={[
                      { value: "preventivo", label: "Invio preventivo" },
                      {
                        value: "sollecito_preventivo",
                        label: "Sollecito preventivo",
                      },
                      {
                        value: "sollecito_pagamento",
                        label: "Sollecito pagamento",
                      },
                      {
                        value: "preavviso_spedizione",
                        label: "Preavviso spedizione",
                      },
                    ]}
                    onChange={(value) =>
                      value &&
                      setModelloForm((corrente) =>
                        corrente
                          ? {
                              ...corrente,
                              tipo: value as TipoModelloComunicazione,
                            }
                          : corrente,
                      )
                    }
                  />

                  <TextInput
                    label="Nome del modello"
                    value={modelloForm.titolo}
                    maxLength={120}
                    onChange={(event) => {
                      const titolo = event.currentTarget.value;
                      setModelloForm((corrente) =>
                        corrente ? { ...corrente, titolo } : corrente,
                      );
                    }}
                  />

                  <TextInput
                    label="Oggetto e-mail"
                    description="WhatsApp usa soltanto il messaggio qui sotto."
                    value={modelloForm.oggetto}
                    maxLength={300}
                    onChange={(event) => {
                      const oggetto = event.currentTarget.value;
                      setModelloForm((corrente) =>
                        corrente ? { ...corrente, oggetto } : corrente,
                      );
                    }}
                  />

                  <Textarea
                    label="Messaggio e-mail e WhatsApp"
                    value={modelloForm.corpo}
                    autosize
                    minRows={9}
                    maxRows={18}
                    onChange={(event) => {
                      const corpo = event.currentTarget.value;
                      setModelloForm((corrente) =>
                        corrente ? { ...corrente, corpo } : corrente,
                      );
                    }}
                  />

                  <Stack gap="xs">
                    <Group gap={6}>
                      <IconBraces size={16} />
                      <Text size="sm" fw={600}>
                        Inserisci un dato
                      </Text>
                    </Group>
                    <Group gap="xs">
                      {variabiliModello.map((variabile) => (
                        <Button
                          key={variabile.chiave}
                          size="compact-xs"
                          variant="light"
                          color="gray"
                          onClick={() =>
                            setModelloForm((corrente) =>
                              corrente
                                ? {
                                    ...corrente,
                                    corpo: `${corrente.corpo}${
                                      corrente.corpo &&
                                      !corrente.corpo.endsWith(" ") &&
                                      !corrente.corpo.endsWith("\n")
                                        ? " "
                                        : ""
                                    }{{${variabile.chiave}}}`,
                                  }
                                : corrente,
                            )
                          }
                        >
                          {variabile.etichetta}
                        </Button>
                      ))}
                    </Group>
                    <Text size="xs" c="dimmed">
                      I dati vengono sostituiti quando prepari il messaggio.
                    </Text>
                  </Stack>
                </>
              )}
          </ContenutoModaleComunicazioni>

          <Group
            justify="space-between"
            mt="lg"
            pt="md"
            className="pt-modal-footer"
          >
            <Group gap="xs">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setModelliAperti(false)}
                disabled={modelloSalvando}
              >
                Chiudi
              </Button>
              {modelloCorrente && !modelloCorrente.predefinito && (
                <Button
                  variant="subtle"
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => void eliminaModello()}
                  disabled={modelloSalvando}
                >
                  Rimuovi
                </Button>
              )}
            </Group>
            <Button
              leftSection={<IconTemplate size={17} />}
              onClick={() => void salvaModello()}
              loading={modelloSalvando}
              disabled={!modelloForm || modelliCaricando}
            >
              Salva modello
            </Button>
          </Group>
        </div>
      </Modal>

    </>
  );
}
