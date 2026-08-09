import {
  Alert,
  Box,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBrandWhatsapp,
  IconMail,
  IconPaperclip,
  IconSend,
  IconTemplate,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  inTauri,
  type CanaleComunicazione,
  type ModelloComunicazione,
  type RecordDto,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { chiudiFinestraCorrente } from "../../lib/finestreTauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import {
  CHIAVE_GEOMETRIA_COMUNICAZIONE,
  EVENTO_APRI_COMUNICAZIONE,
  type ComunicazioneTarget,
} from "./apriComunicazione";
import { formattaStimaInvio, stimaInvioSecondi } from "./stimaInvio";
import {
  emailComunicazioneValida,
  telefonoWhatsappValido,
} from "./recapiti";
import { RecapitoRapidoPopover } from "./RecapitoRapidoPopover";
import {
  risolviModello,
  variabiliMancantiNeiTesti,
} from "./modelliComunicazione";

export {
  emailComunicazioneValida,
  telefonoWhatsappValido,
} from "./recapiti";
export { risolviModello } from "./modelliComunicazione";

const EVENTI_DESTINATARIO_COMPOSER = [
  "cliente:salvato",
  "medico:salvato",
] as const;
type SceltaCanale = CanaleComunicazione | "entrambi";

function chiaveIntento() {
  const casuale =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `manuale:${casuale}`;
}

function variabiliTarget(target: ComunicazioneTarget): Record<string, string> {
  return {
    nome_cliente: target.destinatarioNome,
    ragione_sociale: target.destinatarioNome,
    ...target.variabili,
  };
}

function canaleIniziale(target: ComunicazioneTarget): SceltaCanale {
  if (emailComunicazioneValida(target.email)) return "email";
  return "whatsapp";
}

export function chiaveDestinatarioComunicazione(
  target: ComunicazioneTarget | null | undefined,
) {
  return target
    ? `${target.destinatarioEntita}:${target.destinatarioId}`
    : "";
}

function canaliScelti(scelta: SceltaCanale): CanaleComunicazione[] {
  return scelta === "entrambi" ? ["email", "whatsapp"] : [scelta];
}

function EtichettaCanale({
  canale,
  testo,
}: {
  canale: SceltaCanale;
  testo: string;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      {canale === "email" && <IconMail size={16} />}
      {canale === "whatsapp" && <IconBrandWhatsapp size={16} />}
      {canale === "entrambi" && (
        <Group gap={2} wrap="nowrap">
          <IconMail size={15} />
          <IconBrandWhatsapp size={15} />
        </Group>
      )}
      <Text size="sm" fw={600}>
        {testo}
      </Text>
    </Group>
  );
}

export function ComunicazioneComposerHost({
  initialTarget = null,
  standalone = false,
}: {
  initialTarget?: ComunicazioneTarget | null;
  standalone?: boolean;
} = {}) {
  const [target, setTarget] = useState<ComunicazioneTarget | null>(
    initialTarget,
  );
  const [mostrato, clearMostrato] = useModalSnapshot(target);
  const [modelli, setModelli] = useState<ModelloComunicazione[]>([]);
  const [caricamento, setCaricamento] = useState(false);
  const [salvataggio, setSalvataggio] = useState<"bozza" | "invio" | null>(
    null,
  );
  const [sceltaCanale, setSceltaCanale] = useState<SceltaCanale>(() =>
    initialTarget ? canaleIniziale(initialTarget) : "email",
  );
  const [modelloId, setModelloId] = useState("");
  const [modelloRimosso, setModelloRimosso] = useState(false);
  const [oggettoEmail, setOggettoEmail] = useState("");
  const [corpo, setCorpo] = useState("");
  const [errore, setErrore] = useState("");
  const [recapitoAperto, setRecapitoAperto] = useState(false);
  const intentoRef = useRef(chiaveIntento());
  const ultimaRichiestaRef = useRef("");
  const chiaveDestinatario = chiaveDestinatarioComunicazione(target);

  const riceviTarget = useCallback((next: ComunicazioneTarget) => {
    if (!next?.destinatarioId || !next.destinatarioNome) return;
    if (next.richiestaId && next.richiestaId === ultimaRichiestaRef.current)
      return;
    ultimaRichiestaRef.current = next.richiestaId ?? "";
    intentoRef.current = chiaveIntento();
    setTarget(next);
    setSceltaCanale(canaleIniziale(next));
    setModelloId("");
    setModelloRimosso(false);
    setOggettoEmail("");
    setCorpo("");
    setErrore("");
    setRecapitoAperto(false);
  }, []);

  const applicaDestinatarioAggiornato = useCallback((record: RecordDto) => {
    const valore = (campo: string) =>
      typeof record.data[campo] === "string"
        ? String(record.data[campo]).trim()
        : "";
    setTarget((corrente) => {
      if (
        !corrente ||
        corrente.destinatarioId !== record.id ||
        record.deleted
      ) {
        return corrente;
      }
      const nome =
        valore("ragione_sociale") ||
        valore("denominazione") ||
        valore("nome_completo") ||
        `${valore("nome")} ${valore("cognome")}`.trim() ||
        corrente.destinatarioNome;
      return {
        ...corrente,
        destinatarioNome: nome,
        email: valore("email"),
        telefono: valore("telefono"),
        variabili: {
          ...corrente.variabili,
          nome_cliente: nome,
          ragione_sociale: nome,
        },
      };
    });
  }, []);

  useEffect(() => {
    const locale = (event: Event) => {
      const next = (event as CustomEvent<ComunicazioneTarget>).detail;
      if (next) riceviTarget(next);
    };
    window.addEventListener(EVENTO_APRI_COMUNICAZIONE, locale);
    if (!inTauri) {
      return () =>
        window.removeEventListener(EVENTO_APRI_COMUNICAZIONE, locale);
    }
    let attivo = true;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<ComunicazioneTarget>(
          EVENTO_APRI_COMUNICAZIONE,
          ({ payload }) => {
            if (payload) riceviTarget(payload);
          },
        ),
      )
      .then((unlisten) => {
        if (attivo) off = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      window.removeEventListener(EVENTO_APRI_COMUNICAZIONE, locale);
      off?.();
    };
  }, [riceviTarget]);

  useRicaricaSuEventi(
    EVENTI_DESTINATARIO_COMPOSER,
    async () => {
      if (!target || salvataggio) return;
      const record = await api.recordGet(
        target.destinatarioEntita,
        target.destinatarioId,
      );
      if (!record || record.deleted) return;
      applicaDestinatarioAggiornato(record);
    },
    120,
  );

  useEffect(() => {
    if (!target) return;
    let attivo = true;
    setCaricamento(true);
    api
      .modelliComunicazioneLista()
      .then((lista) => {
        if (attivo) setModelli(lista);
      })
      .catch((e) => {
        if (attivo) setErrore(`Modelli non disponibili: ${e}`);
      })
      .finally(() => {
        if (attivo) setCaricamento(false);
      });
    return () => {
      attivo = false;
    };
  }, [chiaveDestinatario]);

  const modelliDisponibili = useMemo(
    () =>
      modelli
        .filter((modello) => modello.attivo)
        .map((modello) => ({
          value: modello.id,
          label: `${modello.titolo} · ${modello.tipoLabel}`,
        })),
    [modelli],
  );

  const applicaModello = useCallback(
    (nuovoModelloId: string, targetCorrente = mostrato) => {
      setModelloId(nuovoModelloId);
      if (!targetCorrente) return;
      const variabili = variabiliTarget(targetCorrente);
      const modello = modelli.find(
        (item) => item.attivo && item.id === nuovoModelloId,
      );
      setOggettoEmail(
        modello ? risolviModello(modello.oggetto, variabili).testo : "",
      );
      const corpo = modello
        ? risolviModello(modello.corpo, variabili).testo
        : "";
      setCorpo(corpo);
      setErrore("");
    },
    [modelli, mostrato],
  );

  useEffect(() => {
    if (!mostrato || caricamento || modelliDisponibili.length === 0) return;
    if (!mostrato.tipo && !mostrato.origineId) return;
    if (modelloRimosso) return;
    const selezionato = modelli.find(
      (item) => item.attivo && item.id === modelloId,
    );
    const prossimo =
      selezionato ??
      modelli.find(
        (item) =>
          item.attivo && item.tipo === mostrato.tipo && item.predefinito,
      ) ??
      modelli.find((item) => item.attivo && item.tipo === mostrato.tipo) ??
      modelli.find((item) => item.attivo);
    const testiVuoti = !oggettoEmail && !corpo;
    if (prossimo && (!selezionato || testiVuoti)) {
      applicaModello(prossimo.id, mostrato);
    }
  }, [
    applicaModello,
    caricamento,
    corpo,
    modelloId,
    modelli,
    modelliDisponibili.length,
    modelloRimosso,
    mostrato,
    oggettoEmail,
  ]);

  const emailValida = emailComunicazioneValida(mostrato?.email);
  const whatsappValido = telefonoWhatsappValido(mostrato?.telefono);
  const canali = canaliScelti(sceltaCanale);
  const usaEmail = canali.includes("email");
  const usaWhatsapp = canali.includes("whatsapp");
  const tempoStimato = formattaStimaInvio(stimaInvioSecondi(canali));
  const modelloSelezionato = modelli.find(
    (item) => item.attivo && item.id === modelloId,
  );
  const composizioneLibera = !mostrato?.tipo && !mostrato?.origineId;
  const mancanti = useMemo(
    () =>
      variabiliMancantiNeiTesti([
        ...(usaEmail ? [oggettoEmail] : []),
        corpo,
      ]),
    [corpo, oggettoEmail, usaEmail],
  );
  const valido =
    !!mostrato &&
    (!usaEmail ||
      (emailValida && !!oggettoEmail.trim())) &&
    (!usaWhatsapp || whatsappValido) &&
    !!corpo.trim() &&
    mancanti.length === 0;

  const chiudi = () => {
    if (salvataggio) return;
    setTarget(null);
    if (standalone) void chiudiFinestraCorrente();
  };

  const persisti = async (invia: boolean) => {
    if (!mostrato || !valido || salvataggio) return;
    setSalvataggio(invia ? "invio" : "bozza");
    setErrore("");
    let rilasciaAllegati = async () => {};
    try {
      const allegatiGenerati = mostrato.documentoPreventivo
        ? await import("../preventivi/allegatiPreventivo").then(async (modulo) => {
            const generati = await modulo.preparaAllegatiPreventivo(
              mostrato.documentoPreventivo!,
              canali,
            );
            rilasciaAllegati = () => modulo.rilasciaAllegatiPreventivo(generati);
            return generati;
          })
        : {};
      const bozze = [];
      for (const canale of canali) {
        bozze.push(
          await api.comunicazioneCreaBozza({
            idempotencyKey: `${intentoRef.current}:${canale}`,
            destinatarioEntita: mostrato.destinatarioEntita,
            destinatarioId: mostrato.destinatarioId,
            canale,
            recapito:
              canale === "email"
                ? (mostrato.email?.trim() ?? "")
                : (mostrato.telefono?.trim() ?? ""),
            oggetto: canale === "email" ? oggettoEmail.trim() : "",
            corpo: corpo.trim(),
            modelloId: modelloSelezionato?.id ?? "",
            modelloVersioneId: modelloSelezionato?.versioneId ?? "",
            modelloVersione: modelloSelezionato?.versione ?? 0,
            origineEntita: mostrato.origineEntita ?? "",
            origineId: mostrato.origineId ?? "",
            origineRevision:
              mostrato.origineRevision ??
              mostrato.documentoPreventivo?.revision ??
              "",
            origineFingerprint:
              mostrato.origineFingerprint ??
              mostrato.documentoPreventivo?.fingerprintCorrente ??
              "",
            origineSnapshot:
              mostrato.origineSnapshot ?? mostrato.documentoPreventivo ?? null,
            tipoModello:
              mostrato.tipo ?? modelloSelezionato?.tipo ?? "",
            allegati:
              mostrato.allegatiPerCanale?.[canale] ??
              allegatiGenerati[canale] ??
              [],
            // E-mail e WhatsApp avviati dallo stesso click formano un'unica
            // azione: la X della notifica deve poterli annullare insieme.
            campagnaId: canali.length > 1 ? intentoRef.current : "",
          }),
        );
      }
      if (invia) {
        for (const bozza of bozze) {
          if (bozza.stato === "bozza" || bozza.stato === "da_revisionare") {
            await api.comunicazioneMettiInCoda(bozza.id);
          }
        }
        toast.success(
          bozze.length === 1
            ? "Invio avviato."
            : `${bozze.length} invii avviati in sequenza.`,
        );
      } else {
        toast.success(bozze.length === 1 ? "Bozza salvata." : "Bozze salvate.");
      }
      setTarget(null);
      if (standalone) void chiudiFinestraCorrente();
    } catch (e) {
      setErrore(String(e));
    } finally {
      await rilasciaAllegati().catch((error) => {
        setErrore(`Pulizia del documento temporaneo non riuscita: ${error}`);
      });
      setSalvataggio(null);
    }
  };

  const opzioniCanale = [
    {
      value: "email",
      label: <EtichettaCanale canale="email" testo="E-mail" />,
      disabled: !emailValida,
    },
    {
      value: "whatsapp",
      label: <EtichettaCanale canale="whatsapp" testo="WhatsApp" />,
      disabled: !whatsappValido,
    },
    {
      value: "entrambi",
      label: <EtichettaCanale canale="entrambi" testo="Entrambi" />,
      disabled: !emailValida || !whatsappValido,
    },
  ];

  const editorMessaggio = (
    <Stack gap="md">
      {usaEmail && (
      <TextInput
        label="Destinatario e-mail"
        value={
          emailValida
            ? `${mostrato?.destinatarioNome ?? ""} · ${mostrato?.email?.trim() ?? ""}`
            : "Indirizzo e-mail mancante o non valido"
        }
        readOnly
      />
      )}
      {usaWhatsapp && (
        <TextInput
          label="Destinatario WhatsApp"
          value={
            whatsappValido
              ? `${mostrato?.destinatarioNome ?? ""} · ${mostrato?.telefono?.trim() ?? ""}`
              : "Numero cellulare mancante o non valido"
          }
          readOnly
        />
      )}
      {usaEmail && (
      <TextInput
        label="Oggetto"
        value={oggettoEmail}
        maxLength={300}
        onChange={(event) => setOggettoEmail(event.currentTarget.value)}
      />
      )}
      <Textarea
        label="Messaggio"
        value={corpo}
        minRows={7}
        maxRows={14}
        autosize
        onChange={(event) => setCorpo(event.currentTarget.value)}
      />
    </Stack>
  );

  const campi = (
    <Stack gap="md" pr="xs">
      {!emailValida && !whatsappValido && (
        <Alert
          icon={<IconAlertTriangle size={18} />}
          color="orange"
          title="Nessun recapito utilizzabile"
        >
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              Aggiungi un indirizzo e-mail oppure un numero cellulare valido
              nell’anagrafica.
            </Text>
            {mostrato && (
              <RecapitoRapidoPopover
                target={mostrato}
                richiediEmail
                richiediTelefono
                onAggiornato={applicaDestinatarioAggiornato}
                onOpenChange={setRecapitoAperto}
              />
            )}
          </Stack>
        </Alert>
      )}

      <Stack gap={6}>
        <Text size="sm" fw={500}>
          Canale
        </Text>
        <SegmentedControl
          fullWidth
          data={opzioniCanale}
          value={sceltaCanale}
          onChange={(value) => setSceltaCanale(value as SceltaCanale)}
        />
      </Stack>

      <Select
        label="Modello"
        leftSection={<IconTemplate size={16} />}
        data={modelliDisponibili}
        value={modelloId}
        allowDeselect
        clearable
        onChange={(value) => {
          setModelloRimosso(!value);
          applicaModello(value ?? "");
        }}
        placeholder={
          composizioneLibera
            ? "Testo libero — modello facoltativo"
            : modelliDisponibili.length
              ? "Scegli il modello"
              : "Nessun modello attivo"
        }
      />

      {editorMessaggio}

      {mostrato?.documentoPreventivo && (
        <Alert
          icon={<IconPaperclip size={18} />}
          color="teal"
          title={`Preventivo ${mostrato.documentoPreventivo.numeroPreventivo}`}
        >
          {usaEmail && usaWhatsapp
            ? "Alla conferma sarà generato il PDF per l’e-mail; WhatsApp userà il PNG se il preventivo è su una pagina, oppure il PDF completo se è multipagina."
            : usaEmail
              ? "Alla conferma sarà generato e allegato il PDF."
              : "Alla conferma sarà inviato il PNG se il preventivo è su una pagina, oppure il PDF completo se è multipagina."}
        </Alert>
      )}

      {mancanti.length > 0 && (
        <Alert
          icon={<IconAlertTriangle size={18} />}
          color="orange"
          title="Dati da completare"
        >
          Mancano i valori per: {mancanti.join(", ")}.
        </Alert>
      )}
      {errore && (
        <Alert
          icon={<IconAlertTriangle size={18} />}
          color="red"
          title="Operazione non riuscita"
        >
          {errore}
        </Alert>
      )}
    </Stack>
  );

  const contenuto = mostrato ? (
    <Box
      pos="relative"
      className={standalone ? "pt-window-form" : undefined}
      style={standalone ? { height: "100%" } : undefined}
    >
      <LoadingOverlay visible={caricamento} zIndex={20} />
      <Stack
        gap={0}
        className={standalone ? "pt-modal-shell" : undefined}
        style={standalone ? { flex: 1, minHeight: 0 } : undefined}
      >
        {standalone ? (
          <Group gap="sm" mb="lg" wrap="nowrap">
            <ThemeIcon variant="light" color="yellow" radius="md" size="lg">
              <IconSend size={19} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Text fw={800} size="lg">
                Nuova comunicazione
              </Text>
              <Text size="sm" c="dimmed" truncate>
                {mostrato.destinatarioNome}
              </Text>
            </Box>
          </Group>
        ) : (
          <Text size="xs" c="dimmed" mb="md">
            {mostrato.destinatarioNome}
          </Text>
        )}

        {standalone ? (
          <ScrollArea
            type="auto"
            offsetScrollbars
            style={{ flex: "1 1 0", minHeight: 0 }}
          >
            {campi}
          </ScrollArea>
        ) : (
          <ScrollArea.Autosize
            mah="calc(100vh - 250px)"
            type="auto"
            offsetScrollbars
          >
            {campi}
          </ScrollArea.Autosize>
        )}

        <Group justify="space-between" className="pt-modal-footer">
          <Text size="xs" c="dimmed">
            Tempo stimato {tempoStimato}
          </Text>
          <Group gap="sm">
            <Button
              variant="default"
              loading={salvataggio === "bozza"}
              disabled={!valido || !!salvataggio}
              onClick={() => void persisti(false)}
            >
              Salva bozza
            </Button>
            <Button
              leftSection={<IconSend size={16} />}
              loading={salvataggio === "invio"}
              disabled={!valido || !!salvataggio}
              onClick={() => void persisti(true)}
            >
              Invia
            </Button>
          </Group>
        </Group>
      </Stack>
    </Box>
  ) : null;

  if (standalone) {
    return (
      <Box
        p="lg"
        style={{
          height: "100vh",
          overflow: "hidden",
          background: "var(--mantine-color-body)",
        }}
      >
        {contenuto}
      </Box>
    );
  }

  return (
    <Modal
      opened={!!target}
      onClose={chiudi}
      closeOnEscape={!salvataggio && !recapitoAperto}
      closeOnClickOutside={!salvataggio}
      size="min(900px, calc(100vw - 40px))"
      centered
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="yellow" radius="md">
            <IconSend size={18} />
          </ThemeIcon>
          <Text fw={700}>Nuova comunicazione</Text>
        </Group>
      }
      transitionProps={{
        transition: "fade",
        duration: 180,
        onExited: clearMostrato,
      }}
      styles={{ body: { overflow: "hidden" }, content: { overflow: "hidden" } }}
    >
      {contenuto}
    </Modal>
  );
}

export function ComunicazioneComposerWindow() {
  useRicordaGeometria(CHIAVE_GEOMETRIA_COMUNICAZIONE);
  const payload = new URLSearchParams(window.location.search).get("payload");
  let target: ComunicazioneTarget | null = null;
  try {
    target = payload ? (JSON.parse(payload) as ComunicazioneTarget) : null;
  } catch {
    target = null;
  }
  if (!target?.destinatarioId || !target.destinatarioNome) {
    return (
      <Stack align="center" justify="center" h="100vh" p="xl" ta="center">
        <Text fw={700}>Comunicazione non disponibile</Text>
        <Text c="dimmed" size="sm">
          Chiudi questa finestra e riapri la comunicazione dal gestionale.
        </Text>
      </Stack>
    );
  }
  return <ComunicazioneComposerHost initialTarget={target} standalone />;
}
