import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
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
  IconMail,
  IconSend,
  IconTemplate,
} from "@tabler/icons-react";
import {
  api,
  type CanaleComunicazione,
  type ModelloComunicazione,
  type RecordDto,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { VirtualStack } from "../../ui/VirtualStack";
import { chiudiFinestraCorrente } from "../../lib/finestreTauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import {
  emailComunicazioneValida,
  telefonoWhatsappValido,
} from "./ComunicazioneComposer";
import { risolviModello } from "./modelliComunicazione";
import {
  CHIAVE_GEOMETRIA_COMUNICAZIONE_BATCH,
  type AperturaCampagnaComunicazioni,
  EVENTO_APRI_CAMPAGNA_COMUNICAZIONI,
  type CampagnaComunicazioneTarget,
} from "./apriComunicazione";
import { formattaStimaInvio, stimaInvioSecondi } from "./stimaInvio";
import { RecapitoRapidoPopover } from "./RecapitoRapidoPopover";

type SceltaCanale = CanaleComunicazione | "entrambi";
const EVENTI_DESTINATARI_CAMPAGNA = [
  "cliente:salvato",
  "medico:salvato",
] as const;

export function chiaveTargetCampagna(
  target: CampagnaComunicazioneTarget,
): string {
  const origine =
    target.origineEntita && target.origineId
      ? `${target.origineEntita}:${target.origineId}`
      : "";
  return [
    origine,
    target.destinatarioEntita,
    target.destinatarioId,
  ]
    .filter(Boolean)
    .join(":");
}

export function canaleCampagnaIniziale(
  targets: CampagnaComunicazioneTarget[],
): SceltaCanale {
  const email = targets.filter((target) =>
    emailComunicazioneValida(target.email),
  ).length;
  const whatsapp = targets.filter((target) =>
    telefonoWhatsappValido(target.telefono),
  ).length;
  if (targets.length > 1 && email > 0 && whatsapp > 0) return "entrambi";
  return whatsapp > email ? "whatsapp" : "email";
}

export function riallineaCanaleCampagna(
  corrente: SceltaCanale,
  targets: CampagnaComunicazioneTarget[],
  sceltaManuale: boolean,
): SceltaCanale {
  const haEmail = targets.some((target) =>
    emailComunicazioneValida(target.email),
  );
  const haWhatsapp = targets.some((target) =>
    telefonoWhatsappValido(target.telefono),
  );
  if (!sceltaManuale) return canaleCampagnaIniziale(targets);
  if (corrente === "email" && haEmail) return corrente;
  if (corrente === "whatsapp" && haWhatsapp) return corrente;
  if (corrente === "entrambi" && haEmail && haWhatsapp) return corrente;
  if (haEmail && !haWhatsapp) return "email";
  if (haWhatsapp && !haEmail) return "whatsapp";
  if (haEmail && haWhatsapp) return canaleCampagnaIniziale(targets);
  return corrente;
}

function chiaveCampagna() {
  const casuale =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `campagna:${casuale}`;
}

function canaliPerTarget(
  target: CampagnaComunicazioneTarget,
  scelta: SceltaCanale,
) {
  const email = emailComunicazioneValida(target.email);
  const whatsapp = telefonoWhatsappValido(target.telefono);
  if (scelta === "email") return email ? (["email"] as const) : [];
  if (scelta === "whatsapp") return whatsapp ? (["whatsapp"] as const) : [];
  return [
    ...(email ? (["email"] as const) : []),
    ...(whatsapp ? (["whatsapp"] as const) : []),
  ];
}

function dataIt(dataIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso)) return "";
  return new Intl.DateTimeFormat("it-IT").format(
    new Date(`${dataIso}T12:00:00`),
  );
}

function dataAffidamentoIniziale(
  targets: CampagnaComunicazioneTarget[],
): string {
  for (const target of targets) {
    const data = target.variabili?.data_spedizione_iso?.trim() ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) return data;
  }
  return "";
}

function variabiliTarget(
  target: CampagnaComunicazioneTarget,
  dataAffidamento: string,
) {
  return {
    nome_cliente: target.destinatarioNome,
    ragione_sociale: target.destinatarioNome,
    ...target.variabili,
    ...(target.tipo === "preavviso_spedizione"
      ? { data_spedizione: dataIt(dataAffidamento) }
      : {}),
  };
}

export function aggiornaTargetDaRecord(
  target: CampagnaComunicazioneTarget,
  record: RecordDto,
): CampagnaComunicazioneTarget {
  if (
    record.deleted ||
    record.id !== target.destinatarioId
  ) {
    return target;
  }
  const valore = (campo: string) =>
    typeof record.data[campo] === "string"
      ? String(record.data[campo]).trim()
      : "";
  const nome =
    valore("ragione_sociale") ||
    valore("denominazione") ||
    valore("nome_completo") ||
    `${valore("nome")} ${valore("cognome")}`.trim() ||
    target.destinatarioNome;
  const snapshot = target.snapshot ?? [];
  const destinatarioNelloSnapshot = snapshot.some(
    (item) =>
      item.entita === target.destinatarioEntita &&
      item.id === target.destinatarioId,
  );
  return {
    ...target,
    destinatarioNome: nome,
    email: valore("email"),
    telefono: valore("telefono"),
    variabili: {
      ...target.variabili,
      nome_cliente: nome,
      ragione_sociale: nome,
    },
    snapshot: destinatarioNelloSnapshot
      ? snapshot.map((item) =>
          item.entita === target.destinatarioEntita &&
          item.id === target.destinatarioId
            ? { ...item, revision: record.revision }
            : item,
        )
      : [
          ...snapshot,
          {
            entita: target.destinatarioEntita,
            id: target.destinatarioId,
            revision: record.revision,
          },
        ],
  };
}

export function CampagnaComunicazioniHost({
  initialRequest = null,
  standalone = false,
}: {
  initialRequest?: AperturaCampagnaComunicazioni | null;
  standalone?: boolean;
} = {}) {
  const [targets, setTargets] = useState<CampagnaComunicazioneTarget[]>(
    initialRequest?.targets ?? [],
  );
  const [aperto, setAperto] = useState(
    (initialRequest?.targets.length ?? 0) > 0,
  );
  const apertoRef = useRef((initialRequest?.targets.length ?? 0) > 0);
  const [modelli, setModelli] = useState<ModelloComunicazione[]>([]);
  const [modelloId, setModelloId] = useState("");
  const [scelta, setScelta] = useState<SceltaCanale>(() =>
    canaleCampagnaIniziale(initialRequest?.targets ?? []),
  );
  const [oggettoEmail, setOggettoEmail] = useState("");
  const [corpo, setCorpo] = useState("");
  const [caricando, setCaricando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [prorogaSetteGiorni, setProrogaSetteGiorni] = useState(false);
  const [dataAffidamento, setDataAffidamento] = useState(() =>
    dataAffidamentoIniziale(initialRequest?.targets ?? []),
  );
  const [errore, setErrore] = useState("");
  const [recapitiAperti, setRecapitiAperti] = useState<Set<string>>(
    () => new Set(),
  );
  const [sessioneCampagna, setSessioneCampagna] = useState(0);
  const campagnaRef = useRef(chiaveCampagna());
  const ultimaRichiestaRef = useRef(initialRequest?.richiestaId ?? "");
  const sceltaManualeRef = useRef(false);
  const versioneRicaricaDestinatariRef = useRef(0);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const chiudi = () => {
    if (preparando) return;
    setRecapitiAperti(new Set());
    if (standalone) {
      void chiudiFinestraCorrente();
      return;
    }
    apertoRef.current = false;
    setAperto(false);
  };

  const ricevi = useCallback((prossimi: CampagnaComunicazioneTarget[]) => {
    if (!prossimi?.length) return;
    const unici = [
      ...new Map(
        prossimi.map((target) => [
          chiaveTargetCampagna(target),
          target,
        ]),
      ).values(),
    ];
    campagnaRef.current = chiaveCampagna();
    setSessioneCampagna((corrente) => corrente + 1);
    setTargets(unici);
    apertoRef.current = true;
    setAperto(true);
    setModelli([]);
    setModelloId("");
    setOggettoEmail("");
    setCorpo("");
    setProrogaSetteGiorni(false);
    setDataAffidamento(dataAffidamentoIniziale(unici));
    setErrore("");
    setRecapitiAperti(new Set());
    sceltaManualeRef.current = false;
    setScelta(canaleCampagnaIniziale(unici));
  }, []);

  const aggiornaRecapitoAperto = useCallback(
    (chiave: string, opened: boolean) => {
      setRecapitiAperti((correnti) => {
        const prossimo = new Set(correnti);
        if (opened) prossimo.add(chiave);
        else prossimo.delete(chiave);
        return prossimo;
      });
    },
    [],
  );

  useEffect(() => {
    const gestisci = (
      payload:
        | AperturaCampagnaComunicazioni
        | CampagnaComunicazioneTarget[]
        | undefined,
    ) => {
      if (!payload) return;
      const richiesta = Array.isArray(payload)
        ? { targets: payload, richiestaId: "" }
        : payload;
      if (
        richiesta.richiestaId &&
        richiesta.richiestaId === ultimaRichiestaRef.current
      ) {
        return;
      }
      ultimaRichiestaRef.current = richiesta.richiestaId;
      ricevi(richiesta.targets);
    };
    const listener = (event: Event) =>
      gestisci(
        (event as CustomEvent<AperturaCampagnaComunicazioni>).detail,
      );
    window.addEventListener(EVENTO_APRI_CAMPAGNA_COMUNICAZIONI, listener);
    let attivo = true;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<AperturaCampagnaComunicazioni>(
          EVENTO_APRI_CAMPAGNA_COMUNICAZIONI,
          ({ payload }) => gestisci(payload),
        ),
      )
      .then((unlisten) => {
        if (attivo) off = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      window.removeEventListener(EVENTO_APRI_CAMPAGNA_COMUNICAZIONI, listener);
      off?.();
    };
  }, [ricevi]);

  useEffect(() => {
    if (!targets.length) return;
    let attivo = true;
    setCaricando(true);
    api
      .modelliComunicazioneLista()
      .then((lista) => {
        if (!attivo) return;
        setModelli(lista);
        const tipo = targets[0].tipo;
        const modello =
          lista.find(
            (item) => item.attivo && item.tipo === tipo && item.predefinito,
          ) ?? lista.find((item) => item.attivo && item.tipo === tipo);
        setModelloId(modello?.id ?? "");
        setOggettoEmail(modello?.oggetto ?? "");
        setCorpo(modello?.corpo ?? "");
      })
      .catch((error) => setErrore(String(error)))
      .finally(() => attivo && setCaricando(false));
    return () => {
      attivo = false;
    };
  }, [sessioneCampagna]);

  const applicaDestinatarioAggiornato = useCallback((record: RecordDto) => {
    // Il salvataggio appena concluso prevale su una lettura partita prima
    // dell'update e non ancora rientrata dalla proiezione.
    versioneRicaricaDestinatariRef.current += 1;
    setTargets((correnti) =>
      correnti.map((target) =>
        target.destinatarioId === record.id
          ? aggiornaTargetDaRecord(target, record)
          : target,
      ),
    );
  }, []);

  const ricaricaDestinatari = useCallback(async () => {
    if (!apertoRef.current || !targetsRef.current.length) return;
    const versione = ++versioneRicaricaDestinatariRef.current;
    const idsPerEntita = new Map<"cliente" | "medico", Set<string>>();
    for (const target of targetsRef.current) {
      const ids =
        idsPerEntita.get(target.destinatarioEntita) ?? new Set<string>();
      ids.add(target.destinatarioId);
      idsPerEntita.set(target.destinatarioEntita, ids);
    }
    const gruppi = await Promise.all(
      [...idsPerEntita].map(async ([entita, ids]) => ({
        entita,
        records: await api.recordsGetMany(entita, [...ids]),
      })),
    );
    const perChiave = new Map(
      gruppi.flatMap(({ entita, records }) =>
        records
          .filter((record) => !record.deleted)
          .map(
            (record) =>
              [`${entita}:${record.id}`, record] as const,
          ),
      ),
    );
    if (versione !== versioneRicaricaDestinatariRef.current) return;
    setTargets((correnti) =>
      correnti.map((target) => {
        const record = perChiave.get(
          `${target.destinatarioEntita}:${target.destinatarioId}`,
        );
        return record ? aggiornaTargetDaRecord(target, record) : target;
      }),
    );
  }, []);

  useEffect(() => {
    if (aperto) void ricaricaDestinatari();
  }, [aperto, ricaricaDestinatari, sessioneCampagna]);

  useRicaricaSuEventi(
    EVENTI_DESTINATARI_CAMPAGNA,
    ricaricaDestinatari,
    120,
  );

  useEffect(() => {
    if (!targets.length) return;
    setScelta((corrente) =>
      riallineaCanaleCampagna(
        corrente,
        targets,
        sceltaManualeRef.current,
      ),
    );
  }, [targets]);

  const haEmail = targets.some((target) =>
    emailComunicazioneValida(target.email),
  );
  const haWhatsapp = targets.some((target) =>
    telefonoWhatsappValido(target.telefono),
  );
  const tipo = targets[0]?.tipo;
  const modelliDisponibili = modelli.filter(
    (modello) => modello.attivo && (!tipo || modello.tipo === tipo),
  );
  const modelloSelezionato = modelliDisponibili.find(
    (modello) => modello.id === modelloId,
  );
  const preavvisoSpedizione = targets.some(
    (target) => target.tipo === "preavviso_spedizione",
  );

  const applicaModello = (id: string) => {
    const modello = modelliDisponibili.find((item) => item.id === id);
    if (!modello) return;
    setModelloId(modello.id);
    setOggettoEmail(modello.oggetto);
    setCorpo(modello.corpo);
    setErrore("");
  };

  const revisione = useMemo(
    () =>
      targets.map((target) => {
        const canali = canaliPerTarget(target, scelta);
        const variabili = variabiliTarget(target, dataAffidamento);
        const mancanti = new Set<string>();
        for (const canale of canali) {
          const testi = canale === "email" ? [oggettoEmail, corpo] : [corpo];
          for (const testo of testi) {
            for (const chiave of risolviModello(testo, variabili).mancanti) {
              mancanti.add(chiave);
            }
          }
        }
        return { target, canali, mancanti: [...mancanti] };
      }),
    [corpo, dataAffidamento, oggettoEmail, scelta, targets],
  );

  const contenutoValido =
    !!corpo.trim() &&
    (scelta === "whatsapp" || !!oggettoEmail.trim()) &&
    (!preavvisoSpedizione || !!dataAffidamento);
  const destinatariPronti = revisione.filter(
    (voce) => voce.canali.length > 0 && voce.mancanti.length === 0,
  );
  const pronti = contenutoValido ? destinatariPronti : [];
  const daCorreggere = revisione.length - destinatariPronti.length;
  const numeroInvii = pronti.reduce(
    (totale, voce) => totale + voce.canali.length,
    0,
  );
  const tempoStimato = formattaStimaInvio(
    stimaInvioSecondi(pronti.flatMap((voce) => voce.canali)),
  );
  const proroghe = [
    ...new Map(
      pronti
        .flatMap((voce) => voce.target.proroga ?? [])
        .map((proroga) => [proroga.id, proroga]),
    ).values(),
  ];
  const totaleProroga = proroghe.reduce(
    (totale, proroga) => totale + proroga.importo,
    0,
  );

  const prepara = async () => {
    if (!pronti.length || preparando) return;
    setPreparando(true);
    setErrore("");
    const rilasciDocumenti: Array<() => Promise<void>> = [];
    try {
      const snapshot = pronti.flatMap((voce) =>
        (voce.target.snapshot ?? []).map((record) => ({
          destinatario: voce.target.destinatarioNome,
          ordineId: voce.target.documentoPreventivo?.ordineId,
          proroga: voce.target.proroga?.find(
            (proroga) => proroga.id === record.id,
          ),
          ...record,
        })),
      );
      const idsPerEntita = new Map<string, Set<string>>();
      for (const record of snapshot) {
        if (record.entita === "preventivo") continue;
        const ids = idsPerEntita.get(record.entita) ?? new Set<string>();
        ids.add(record.id);
        idsPerEntita.set(record.entita, ids);
      }
      const [preventiviCorrenti, gruppiCorrenti] = await Promise.all([
        snapshot.some((record) => record.entita === "preventivo")
          ? api.preventiviLista()
          : Promise.resolve([]),
        Promise.all(
          [...idsPerEntita].map(async ([entita, ids]) => ({
            entita,
            records: await api.recordsGetMany(entita, [...ids]),
          })),
        ),
      ]);
      const preventiviPerId = new Map(
        preventiviCorrenti.map((preventivo) => [preventivo.id, preventivo]),
      );
      const recordsPerChiave = new Map(
        gruppiCorrenti.flatMap(({ entita, records }) =>
          records.map(
            (record) => [`${entita}:${record.id}`, record] as const,
          ),
        ),
      );
      const controlli = snapshot.map((record) => {
        if (record.entita === "preventivo") {
          const corrente = preventiviPerId.get(record.id);
          return {
            ...record,
            corrente: corrente
              ? {
                  deleted: false,
                  revision: corrente.revision,
                  data: {} as Record<string, unknown>,
                }
              : null,
          };
        }
        return {
          ...record,
          corrente:
            recordsPerChiave.get(`${record.entita}:${record.id}`) ?? null,
        };
      });
      const cambiato = controlli.find(
        (record) =>
          !record.corrente ||
          record.corrente.deleted ||
          (record.corrente.revision !== record.revision &&
            !(
              prorogaSetteGiorni &&
              record.proroga &&
              record.corrente.data.comunicazione_proroga_id ===
                campagnaRef.current &&
              record.corrente.data.scadenza === record.proroga.nuovaScadenza &&
              record.corrente.data.importo === record.proroga.importo &&
              record.corrente.data.conto_id === record.proroga.contoId &&
              record.corrente.data.saldato === false
            )),
      );
      if (cambiato) {
        throw new Error(
          `I dati di ${cambiato.destinatario} sono cambiati durante la revisione. Chiudi e riapri la campagna per aggiornare destinatari e importi.`,
        );
      }
      const bozze = [];
      for (const voce of pronti) {
        const variabili = variabiliTarget(voce.target, dataAffidamento);
        const allegatiGenerati = voce.target.documentoPreventivo
          ? await import("../preventivi/allegatiPreventivo").then(async (modulo) => {
              const generati = await modulo.preparaAllegatiPreventivo(
                voce.target.documentoPreventivo!,
                voce.canali,
              );
              rilasciDocumenti.push(() =>
                modulo.rilasciaAllegatiPreventivo(generati),
              );
              return generati;
            })
          : {};
        for (const canale of voce.canali) {
          const oggetto =
            canale === "email"
              ? risolviModello(oggettoEmail, variabili).testo.trim()
              : "";
          const corpoRisolto = risolviModello(
            corpo,
            variabili,
          ).testo.trim();
          const bozza = await api.comunicazioneCreaBozza({
            idempotencyKey: `${campagnaRef.current}:${chiaveTargetCampagna(voce.target)}:${canale}`,
            destinatarioEntita: voce.target.destinatarioEntita,
            destinatarioId: voce.target.destinatarioId,
            canale,
            recapito:
              canale === "email"
                ? (voce.target.email?.trim() ?? "")
                : (voce.target.telefono?.trim() ?? ""),
            oggetto,
            corpo: corpoRisolto,
            modelloId: modelloSelezionato?.id ?? "",
            modelloVersioneId: modelloSelezionato?.versioneId ?? "",
            modelloVersione: modelloSelezionato?.versione ?? 0,
            origineEntita: voce.target.origineEntita ?? "",
            origineId: voce.target.origineId ?? "",
            origineRevision:
              voce.target.origineRevision ??
              voce.target.documentoPreventivo?.revision ??
              "",
            origineFingerprint:
              voce.target.origineFingerprint ??
              voce.target.documentoPreventivo?.fingerprintCorrente ??
              "",
            originiCorrelate: voce.target.originiCorrelate ?? [],
            origineSnapshot:
              voce.target.origineSnapshot ??
              voce.target.documentoPreventivo ??
              null,
            tipoModello:
              voce.target.tipo ?? modelloSelezionato?.tipo ?? "",
            allegati:
              voce.target.allegatiPerCanale?.[canale] ??
              allegatiGenerati[canale] ??
              [],
            campagnaId: campagnaRef.current,
          });
          bozze.push(bozza);
        }
      }
      if (prorogaSetteGiorni && proroghe.length) {
        await api.pagamentiProrogaSetteGiorni(
          campagnaRef.current,
          proroghe.map(({ id, revision, vecchiaScadenza, nuovaScadenza }) => ({
            id,
            revision,
            vecchiaScadenza,
            nuovaScadenza,
          })),
        );
      }
      for (const bozza of bozze) {
        if (bozza.stato === "bozza" || bozza.stato === "da_revisionare") {
          await api.comunicazioneMettiInCoda(bozza.id);
        }
      }
      toast.success(
        `${numeroInvii} invii avviati in sequenza.${
          prorogaSetteGiorni && proroghe.length
            ? " Scadenze posticipate di 7 giorni."
            : ""
        }`,
      );
      if (standalone) {
        void chiudiFinestraCorrente();
      } else {
        apertoRef.current = false;
        setAperto(false);
      }
    } catch (error) {
      setErrore(String(error));
    } finally {
      const pulizie = await Promise.allSettled(
        rilasciDocumenti.map((rilascia) => rilascia()),
      );
      const puliziaFallita = pulizie.find(
        (esito): esito is PromiseRejectedResult => esito.status === "rejected",
      );
      if (puliziaFallita) {
        setErrore(
          `Pulizia dei documenti temporanei non riuscita: ${puliziaFallita.reason}`,
        );
      }
      setPreparando(false);
    }
  };

  const titolo = targets.some((target) => target.tipo)
    ? "Avvisa clienti"
    : "Nuova comunicazione";

  const campi = (
    <Stack gap="md" pr="xs">
      {preavvisoSpedizione && (
        <TextInput
          type="date"
          label="Data di affidamento al corriere"
          description="È la data che sarà comunicata ai clienti per l’affidamento del collo al corriere."
          value={dataAffidamento}
          required
          error={
            dataAffidamento
              ? undefined
              : "Scegli la data da comunicare ai clienti."
          }
          onChange={(event) => {
            setDataAffidamento(event.currentTarget.value);
            setErrore("");
          }}
        />
      )}

      <Select
        label="Modello"
        leftSection={<IconTemplate size={16} />}
        value={modelloId}
        data={modelliDisponibili.map((modello) => ({
          value: modello.id,
          label: `${modello.titolo} · ${modello.tipoLabel}`,
        }))}
        clearable
        searchable
        disabled={caricando}
        placeholder={
          modelliDisponibili.length
            ? "Scegli il modello"
            : "Nessun modello attivo"
        }
        onChange={(value) => {
          if (value) applicaModello(value);
          else setModelloId("");
        }}
      />

      <Stack gap="sm">
        {scelta !== "whatsapp" && (
          <TextInput
            label="Oggetto"
            value={oggettoEmail}
            onChange={(event) => setOggettoEmail(event.currentTarget.value)}
          />
        )}
        <Textarea
          label="Messaggio"
          minRows={6}
          autosize
          value={corpo}
          onChange={(event) => setCorpo(event.currentTarget.value)}
        />
        {scelta === "entrambi" && (
          <Text size="xs" c="dimmed">
            Lo stesso messaggio sarà usato per e-mail e WhatsApp.
          </Text>
        )}
      </Stack>

      {proroghe.length > 0 && (
        <Box
          p="sm"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--mantine-radius-md)",
          }}
        >
          <Stack gap="xs">
            <Switch
              checked={prorogaSetteGiorni}
              onChange={(event) =>
                setProrogaSetteGiorni(event.currentTarget.checked)
              }
              label="Posticipa le scadenze di 7 giorni"
            />
            {prorogaSetteGiorni && (
              <>
                <Text size="xs" c="dimmed">
                  {proroghe.length}{" "}
                  {proroghe.length === 1 ? "scadenza" : "scadenze"} · totale €{" "}
                  {(totaleProroga / 100).toLocaleString("it-IT", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
                <Text size="xs">
                  {[
                    ...new Set(
                      proroghe.map(
                        (proroga) =>
                          `${new Intl.DateTimeFormat("it-IT").format(
                            new Date(`${proroga.vecchiaScadenza}T12:00:00`),
                          )} → ${new Intl.DateTimeFormat("it-IT").format(
                            new Date(`${proroga.nuovaScadenza}T12:00:00`),
                          )}`,
                      ),
                    ),
                  ].join(" · ")}
                </Text>
              </>
            )}
          </Stack>
        </Box>
      )}

      <Group justify="space-between">
        <Text fw={700} size="sm">
          Destinatari
        </Text>
        <Group gap="xs">
          <Badge color="teal" variant="light">
            {destinatariPronti.length} pronti
          </Badge>
          {daCorreggere > 0 && (
            <Badge color="orange" variant="light">
              {daCorreggere} da correggere
            </Badge>
          )}
        </Group>
      </Group>

      <VirtualStack
        items={revisione}
        getKey={(voce) => chiaveTargetCampagna(voce.target)}
        maxHeight={260}
        estimateHeight={58}
        gap={6}
        renderItem={(voce) => (
          <Group
            justify="space-between"
            wrap="nowrap"
            p="xs"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--mantine-radius-sm)",
            }}
          >
            <Box style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {voce.target.destinatarioNome}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {voce.mancanti.length
                  ? `Dati mancanti: ${voce.mancanti.join(", ")}`
                  : voce.canali.length
                    ? voce.canali
                        .map((canale) =>
                          canale === "email" ? "E-mail" : "WhatsApp",
                        )
                        .join(" + ")
                    : "Nessun recapito utilizzabile"}
              </Text>
            </Box>
            <Group gap={6} wrap="nowrap">
              {(!emailComunicazioneValida(voce.target.email) ||
                !telefonoWhatsappValido(voce.target.telefono)) && (
                <RecapitoRapidoPopover
                  target={voce.target}
                  richiediEmail={!emailComunicazioneValida(voce.target.email)}
                  richiediTelefono={
                    !telefonoWhatsappValido(voce.target.telefono)
                  }
                  onAggiornato={applicaDestinatarioAggiornato}
                  onOpenChange={(opened) =>
                    aggiornaRecapitoAperto(
                      chiaveTargetCampagna(voce.target),
                      opened,
                    )
                  }
                />
              )}
              <Badge
                color={
                  voce.canali.length && !voce.mancanti.length
                    ? "teal"
                    : "orange"
                }
                variant="light"
              >
                {voce.canali.length && !voce.mancanti.length
                  ? "Pronto"
                  : "Escluso"}
              </Badge>
            </Group>
          </Group>
        )}
      />

      {errore && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={17} />}
          title="Preparazione non riuscita"
        >
          {errore}
        </Alert>
      )}
    </Stack>
  );

  const contenuto = (
    <Box
      pos="relative"
      className={standalone ? "pt-window-form" : undefined}
      style={standalone ? { height: "100%" } : undefined}
    >
      <LoadingOverlay visible={caricando} />
      <Stack
        gap="md"
        className={standalone ? "pt-modal-shell" : undefined}
        style={standalone ? { flex: 1, minHeight: 0 } : undefined}
      >
        {standalone && (
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="yellow" radius="md" size="lg">
              <IconSend size={19} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Text fw={800} size="lg">
                {titolo}
              </Text>
              <Text size="sm" c="dimmed">
                {targets.length}{" "}
                {targets.length === 1 ? "destinatario" : "destinatari"}
              </Text>
            </Box>
          </Group>
        )}

        <SegmentedControl
          fullWidth
          value={scelta}
          onChange={(value) => {
            sceltaManualeRef.current = true;
            setScelta(value as SceltaCanale);
          }}
          data={[
            {
              value: "email",
              disabled: !haEmail,
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconMail size={15} />
                  <span>E-mail</span>
                </Group>
              ),
            },
            {
              value: "whatsapp",
              disabled: !haWhatsapp,
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconBrandWhatsapp size={15} />
                  <span>WhatsApp</span>
                </Group>
              ),
            },
            {
              value: "entrambi",
              disabled: !haEmail || !haWhatsapp,
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconMail size={14} />
                  <IconBrandWhatsapp size={14} />
                  <span>Entrambi</span>
                </Group>
              ),
            },
          ]}
        />

        {standalone ? (
          <ScrollArea
            offsetScrollbars
            style={{ flex: "1 1 0", minHeight: 0 }}
          >
            {campi}
          </ScrollArea>
        ) : (
          <ScrollArea.Autosize mah="calc(100vh - 300px)" offsetScrollbars>
            {campi}
          </ScrollArea.Autosize>
        )}

        <Group justify="space-between" className="pt-modal-footer">
          <Group gap="xs">
            <ThemeIcon variant="light" color="yellow">
              <IconSend size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text size="sm">
                {numeroInvii} {numeroInvii === 1 ? "invio" : "invii"}
              </Text>
              {numeroInvii > 0 && (
                <Text size="xs" c="dimmed">
                  Tempo stimato {tempoStimato}
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap="sm">
            <Button variant="default" onClick={chiudi} disabled={preparando}>
              Annulla
            </Button>
            <Button
              leftSection={<IconSend size={16} />}
              loading={preparando}
              disabled={!pronti.length || caricando}
              onClick={() => void prepara()}
            >
              Prepara invii
            </Button>
          </Group>
        </Group>
      </Stack>
    </Box>
  );

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
      opened={aperto}
      onClose={chiudi}
      onExitTransitionEnd={() => {
        if (!apertoRef.current) setTargets([]);
      }}
      size="min(980px, calc(100vw - 32px))"
      centered
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="yellow" radius="md">
            <IconSend size={18} />
          </ThemeIcon>
          <Text fw={700}>{titolo}</Text>
        </Group>
      }
      closeOnEscape={!preparando && recapitiAperti.size === 0}
      closeOnClickOutside={!preparando}
      transitionProps={{ transition: "fade", duration: 180 }}
      styles={{
        body: { overflow: "hidden" },
        content: { overflow: "hidden" },
      }}
    >
      {contenuto}
    </Modal>
  );
}

export function CampagnaComunicazioniWindow() {
  useRicordaGeometria(CHIAVE_GEOMETRIA_COMUNICAZIONE_BATCH);
  const payload = new URLSearchParams(window.location.search).get("payload");
  let richiesta: AperturaCampagnaComunicazioni | null = null;
  try {
    richiesta = payload
      ? (JSON.parse(payload) as AperturaCampagnaComunicazioni)
      : null;
  } catch {
    richiesta = null;
  }
  if (!richiesta?.targets?.length) {
    return (
      <Stack align="center" justify="center" h="100vh" p="xl" ta="center">
        <Text fw={700}>Comunicazione non disponibile</Text>
        <Text c="dimmed" size="sm">
          Chiudi questa finestra e riapri la comunicazione dal gestionale.
        </Text>
      </Stack>
    );
  }
  return (
    <CampagnaComunicazioniHost
      initialRequest={richiesta}
      standalone
    />
  );
}
