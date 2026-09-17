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
import { collegaDisiscrizioneAsincrona } from "../../lib/disiscrizioneAsincrona";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { creaIdCasuale } from "../../lib/idCasuale";
import {
  CHIAVE_GEOMETRIA_COMUNICAZIONE,
  datiDestinatarioDaRecord,
  EVENTO_APRI_COMUNICAZIONE,
  type ComunicazioneTarget,
  variabiliNomeDestinatario,
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
import {
  ComunicazioneNonDisponibile,
  ContenitoreComunicazioneStandalone,
  IntestazioneComunicazioneStandalone,
  leggiPayloadComunicazione,
  TitoloNuovaComunicazione,
} from "./ElementiComunicazione";
import { accodaBozzeComunicazione } from "./operazioniComunicazioni";

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
  return `manuale:${creaIdCasuale()}`;
}

function variabiliTarget(target: ComunicazioneTarget): Record<string, string> {
  return {
    ...variabiliNomeDestinatario(target.destinatarioNome),
    ...target.variabili,
  };
}

function canaleIniziale(target: ComunicazioneTarget): SceltaCanale {
  if (target.canaliConsentiti?.length === 1) return target.canaliConsentiti[0];
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
    setTarget((corrente) => {
      if (
        !corrente ||
        corrente.destinatarioId !== record.id ||
        record.deleted
      ) {
        return corrente;
      }
      const dati = datiDestinatarioDaRecord(record, corrente.destinatarioNome);
      return {
        ...corrente,
        destinatarioNome: dati.nome,
        email: dati.email,
        telefono: dati.telefono,
        variabili: {
          ...corrente.variabili,
          ...variabiliNomeDestinatario(dati.nome),
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
    const disiscriviTauri = collegaDisiscrizioneAsincrona(
      import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<ComunicazioneTarget>(
          EVENTO_APRI_COMUNICAZIONE,
          ({ payload }) => {
            if (payload) riceviTarget(payload);
          },
        ),
      ),
    );
    return () => {
      window.removeEventListener(EVENTO_APRI_COMUNICAZIONE, locale);
      disiscriviTauri();
    };
  }, [riceviTarget]);

  useRicaricaSuEventi(
    EVENTI_DESTINATARIO_COMPOSER,
    async () => {
      if (!target || salvataggio || target.destinatarioEntita === "laboratorio_laboratorio") return;
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

  const allegatiTarget = useMemo(
    () => [...new Map(
      Object.values(mostrato?.allegatiPerCanale ?? {})
        .flat()
        .map((allegato) => [allegato.riferimento, allegato]),
    ).values()],
    [mostrato?.allegatiPerCanale],
  );

  const rilasciaAllegatiTarget = async () => {
    if (mostrato?.rilasciaAllegatiAllaChiusura && allegatiTarget.length) {
      await api.documentiCacheRilascia(
        allegatiTarget,
        mostrato.eliminaAllegatiNonUsatiAllaChiusura,
      );
    }
  };

  const chiudi = () => {
    if (salvataggio) return;
    void rilasciaAllegatiTarget()
      .catch(() => {})
      .finally(() => {
        setTarget(null);
        if (standalone) void chiudiFinestraCorrente();
      });
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
        await accodaBozzeComunicazione(bozze, api.comunicazioneMettiInCoda);
        toast.success(
          bozze.length === 1
            ? "Invio avviato."
            : `${bozze.length} invii avviati in sequenza.`,
        );
      } else {
        toast.success(bozze.length === 1 ? "Bozza salvata." : "Bozze salvate.");
      }
      setTarget(null);
      if (mostrato.rilasciaAllegatiAllaChiusura && allegatiTarget.length) {
        await rilasciaAllegatiTarget().catch(() => {});
      }
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

  const canaliConsentiti = mostrato?.canaliConsentiti ?? ["email", "whatsapp"];
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
  ].filter((opzione) =>
    opzione.value === "entrambi"
      ? canaliConsentiti.includes("email") && canaliConsentiti.includes("whatsapp")
      : canaliConsentiti.includes(opzione.value as CanaleComunicazione),
  );

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
              : "Numero di telefono mancante o non utilizzabile"
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
              Aggiungi un indirizzo e-mail oppure un numero di telefono utilizzabile
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

      {allegatiTarget.length > 0 && (
        <Alert
          icon={<IconPaperclip size={18} />}
          color="teal"
          title={`${allegatiTarget.length} allegat${allegatiTarget.length === 1 ? "o" : "i"} pront${allegatiTarget.length === 1 ? "o" : "i"}`}
        >
          <Stack gap={2}>
            {allegatiTarget.map((allegato) => (
              <Text key={allegato.riferimento} size="xs">
                {allegato.nome} · {(allegato.dimensione / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB
              </Text>
            ))}
          </Stack>
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
          <IntestazioneComunicazioneStandalone
            titolo="Nuova comunicazione"
            sottotitolo={mostrato.destinatarioNome}
            conMargine
            troncaSottotitolo
          />
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
      <ContenitoreComunicazioneStandalone>
        {contenuto}
      </ContenitoreComunicazioneStandalone>
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
      title={<TitoloNuovaComunicazione />}
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
  const target = leggiPayloadComunicazione<ComunicazioneTarget>();
  if (!target?.destinatarioId || !target.destinatarioNome) {
    return <ComunicazioneNonDisponibile />;
  }
  return <ComunicazioneComposerHost initialTarget={target} standalone />;
}
