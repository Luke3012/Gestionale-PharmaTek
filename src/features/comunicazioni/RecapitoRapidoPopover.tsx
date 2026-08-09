import { useEffect, useRef, useState } from "react";
import {
  Button,
  Group,
  Popover,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import { api, type RecordDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import type { ComunicazioneTarget } from "./apriComunicazione";
import {
  emailComunicazioneValida,
  telefonoWhatsappValido,
} from "./recapiti";

interface BaselineRecapiti {
  revision: string;
  email: string;
  telefono: string;
}

function valore(record: RecordDto, campo: "email" | "telefono"): string {
  return typeof record.data[campo] === "string"
    ? String(record.data[campo]).trim()
    : "";
}

export function RecapitoRapidoPopover({
  target,
  richiediEmail,
  richiediTelefono,
  onAggiornato,
  onOpenChange,
}: {
  target: ComunicazioneTarget;
  richiediEmail: boolean;
  richiediTelefono: boolean;
  onAggiornato: (record: RecordDto) => void;
  onOpenChange?: (opened: boolean) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [caricando, setCaricando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [email, setEmail] = useState(target.email?.trim() ?? "");
  const [telefono, setTelefono] = useState(target.telefono?.trim() ?? "");
  const baselineRef = useRef<BaselineRecapiti | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    onOpenChangeRef.current?.(aperto);
    return () => {
      if (aperto) onOpenChangeRef.current?.(false);
    };
  }, [aperto]);

  const applica = (record: RecordDto, notificaAggiornamento = true) => {
    const prossimaEmail = valore(record, "email");
    const prossimoTelefono = valore(record, "telefono");
    baselineRef.current = {
      revision: record.revision,
      email: prossimaEmail,
      telefono: prossimoTelefono,
    };
    setEmail(prossimaEmail);
    setTelefono(prossimoTelefono);
    if (notificaAggiornamento) onAggiornato(record);
  };

  const apri = async () => {
    setAperto(true);
    setCaricando(true);
    try {
      const record = await api.recordGet(
        target.destinatarioEntita,
        target.destinatarioId,
      );
      if (!record || record.deleted) {
        toast.warning("Questa anagrafica non è più disponibile.");
        setAperto(false);
        return;
      }
      // All'apertura serve soltanto una baseline fresca per il popover.
      // Il parent viene aggiornato al salvataggio (o dagli eventi realtime),
      // evitando un render completo mentre l'utente sta aprendo il form.
      applica(record, false);
    } catch (error) {
      toast.error(`Recapiti non disponibili: ${error}`);
      setAperto(false);
    } finally {
      setCaricando(false);
    }
  };

  const emailNonValida =
    richiediEmail && !!email.trim() && !emailComunicazioneValida(email);
  const telefonoNonValido =
    richiediTelefono &&
    !!telefono.trim() &&
    !telefonoWhatsappValido(telefono);
  const haRecapitoValido =
    (richiediEmail && emailComunicazioneValida(email)) ||
    (richiediTelefono && telefonoWhatsappValido(telefono));

  const salva = async () => {
    if (
      salvando ||
      caricando ||
      emailNonValida ||
      telefonoNonValido ||
      !haRecapitoValido
    ) {
      return;
    }
    setSalvando(true);
    try {
      const corrente = await api.recordGet(
        target.destinatarioEntita,
        target.destinatarioId,
      );
      if (!corrente || corrente.deleted) {
        toast.warning("Questa anagrafica non è più disponibile.");
        setAperto(false);
        return;
      }

      const baseline = baselineRef.current;
      const desiderati = {
        email: email.trim(),
        telefono: telefono.trim(),
      };
      const campiRichiesti = [
        ...(richiediEmail ? (["email"] as const) : []),
        ...(richiediTelefono ? (["telefono"] as const) : []),
      ];
      const conflitto = baseline
        ? campiRichiesti.find((campo) => {
            const prima = baseline[campo];
            const adesso = valore(corrente, campo);
            const desiderato = desiderati[campo];
            return (
              corrente.revision !== baseline.revision &&
              desiderato !== prima &&
              adesso !== prima &&
              adesso !== desiderato
            );
          })
        : undefined;

      if (conflitto) {
        applica(corrente);
        toast.warning(
          `${conflitto === "email" ? "L’e-mail" : "Il telefono"} è stato aggiornato da un’altra postazione. Ho caricato il valore più recente.`,
        );
        return;
      }

      const patch: Record<string, string> = {};
      for (const campo of campiRichiesti) {
        if (desiderati[campo] !== valore(corrente, campo)) {
          patch[campo] = desiderati[campo];
        }
      }
      const aggiornato = Object.keys(patch).length
        ? await api.recordUpdate(
            target.destinatarioEntita,
            target.destinatarioId,
            patch,
          )
        : corrente;
      applica(aggiornato);
      setAperto(false);
      toast.success(
        Object.keys(patch).length
          ? "Recapito salvato nell’anagrafica."
          : "Il recapito era già stato aggiornato.",
      );
    } catch (error) {
      toast.error(`Salvataggio del recapito non riuscito: ${error}`);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Popover
      opened={aperto}
      onChange={setAperto}
      position="bottom-end"
      withinPortal
      width={320}
      trapFocus
      withArrow
      shadow="md"
      radius="md"
      zIndex={1450}
    >
      <Popover.Target>
        <Button
          size="compact-xs"
          variant="light"
          color="orange"
          leftSection={<IconEdit size={13} />}
          onClick={() => void apri()}
        >
          Aggiungi recapito
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        p="sm"
        data-mantine-stop-propagation="true"
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setAperto(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void salva();
          }
        }}
      >
        <Stack gap="xs">
          <div>
            <Text size="sm" fw={600}>
              Recapito di {target.destinatarioNome}
            </Text>
            <Text size="xs" c="dimmed">
              Il dato viene salvato direttamente nell’anagrafica.
            </Text>
          </div>
          {richiediEmail && (
            <TextInput
              label="E-mail"
              type="email"
              autoFocus
              value={email}
              disabled={caricando}
              error={emailNonValida ? "Inserisci un indirizzo e-mail valido" : undefined}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          )}
          {richiediTelefono && (
            <TextInput
              label="Cellulare WhatsApp"
              type="tel"
              autoFocus={!richiediEmail}
              value={telefono}
              disabled={caricando}
              error={
                telefonoNonValido
                  ? "Inserisci un numero cellulare valido"
                  : undefined
              }
              onChange={(event) => setTelefono(event.currentTarget.value)}
            />
          )}
          <Group justify="flex-end" gap="xs" mt={2}>
            <Button
              size="compact-sm"
              variant="default"
              disabled={salvando}
              onClick={() => setAperto(false)}
            >
              Annulla
            </Button>
            <Button
              size="compact-sm"
              color="accent"
              loading={salvando || caricando}
              disabled={
                emailNonValida || telefonoNonValido || !haRecapitoValido
              }
              onClick={() => void salva()}
            >
              Salva
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
