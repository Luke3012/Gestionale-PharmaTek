import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Drawer,
  Group,
  Modal,
  Popover,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBrandWhatsapp,
  IconMail,
  IconHistory,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  api,
  type Comunicazione,
  type RecordDto,
  type StatoComunicazione,
} from "../../lib/tauri";
import { collegaDisiscrizioneAsincrona } from "../../lib/disiscrizioneAsincrona";
import { setConToggle } from "../../lib/set";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { VirtualStack } from "../../ui/VirtualStack";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { chiudiFinestraCorrente } from "../../lib/finestreTauri";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";
import { formattaDataOraBreve as dataOra } from "../../lib/date";
import {
  EVENTO_APRI_CENTRO_COMUNICAZIONI,
  apriCampagnaComunicazioni,
  apriComunicazione,
  type AperturaCentroComunicazioni,
  type PresentazioneCentroComunicazioni,
} from "./apriComunicazione";
import { TitoloNuovaComunicazione } from "./ElementiComunicazione";

const STATI: Record<
  StatoComunicazione,
  { label: string; color: string }
> = {
  bozza: { label: "Bozza", color: "gray" },
  da_revisionare: { label: "Da rivedere", color: "orange" },
  in_coda: { label: "In attesa", color: "blue" },
  sospeso: { label: "In pausa", color: "gray" },
  in_invio: { label: "Invio in corso", color: "yellow" },
  invio_azionato: { label: "Inviata", color: "teal" },
  consegna_verificata: { label: "Inviata", color: "teal" },
  fallito: { label: "Errore", color: "red" },
  annullato: { label: "Annullata", color: "gray" },
};

type Filtro = "tutte" | "attive" | "inviate" | "errori";
const EVENTI_CENTRO_COMUNICAZIONI = ["comunicazione:salvato"] as const;
const EVENTI_DESTINATARI_COMUNICAZIONI = [
  "cliente:salvato",
  "medico:salvato",
] as const;
const CHIAVE_CAMPAGNE_IGNORATE = "pharmatek:comunicazioni:campagne-ignorate";
const STATI_ELIMINABILI = new Set<StatoComunicazione>([
  "invio_azionato",
  "consegna_verificata",
  "fallito",
  "annullato",
]);

function leggiCampagneIgnorate(): Set<string> {
  try {
    const salvate = JSON.parse(
      window.localStorage.getItem(CHIAVE_CAMPAGNE_IGNORATE) ?? "[]",
    );
    return new Set(
      Array.isArray(salvate)
        ? salvate.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

interface DestinatarioManuale {
  id: string;
  entita: "cliente" | "medico";
  nome: string;
  email: string;
  telefono: string;
}

function StatoElencoDestinatari({ messaggio }: { messaggio: string }) {
  return (
    <Box style={{ flex: 1, display: "grid", placeItems: "center" }}>
      <Text size="sm" c="dimmed" p="md" ta="center">
        {messaggio}
      </Text>
    </Box>
  );
}

function appartieneAlFiltro(comunicazione: Comunicazione, filtro: Filtro) {
  if (filtro === "tutte") return true;
  if (filtro === "attive") {
    return ["bozza", "da_revisionare", "in_coda", "sospeso", "in_invio"].includes(
      comunicazione.stato
    );
  }
  if (filtro === "inviate") {
    return ["invio_azionato", "consegna_verificata"].includes(
      comunicazione.stato
    );
  }
  return comunicazione.stato === "fallito";
}

function comunicazioneEliminabile(comunicazione: Comunicazione) {
  return STATI_ELIMINABILI.has(comunicazione.stato);
}

const CorpoComunicazioneCompatto = memo(function CorpoComunicazioneCompatto({
  corpo,
  ultimoErrore,
  erroreFase,
}: {
  corpo: string;
  ultimoErrore?: string | null;
  erroreFase?: string | null;
}) {
  const [aperto, setAperto] = useState(false);

  return (
    <Popover
      opened={aperto}
      onChange={setAperto}
      position="bottom-start"
      width={440}
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <UnstyledButton
          className="pt-comunicazione-card-corpo-trigger"
          onClick={() => setAperto((corrente) => !corrente)}
          aria-label="Visualizza il messaggio completo"
        >
          <Text size="sm" truncate>
            {corpo}
          </Text>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown
        p="sm"
        style={{
          maxWidth: "calc(100vw - 32px)",
          overflowWrap: "anywhere",
        }}
      >
        <Stack gap="xs">
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {corpo}
          </Text>
          {ultimoErrore && (
            <Stack gap={2}>
              {erroreFase && (
                <Text size="xs" fw={700} c="red">
                  Fase: {erroreFase.replace(/_/g, " ")}
                </Text>
              )}
              <Text size="xs" c="red">
                {ultimoErrore}
              </Text>
            </Stack>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
});

export function CentroComunicazioniContenuto({
  attivo = true,
  onModalStateChange,
  onPrimaComposizione,
  componiInFinestraSeparata = false,
  evidenziazione,
}: {
  attivo?: boolean;
  onModalStateChange?: (aperto: boolean) => void;
  onPrimaComposizione?: () => void;
  componiInFinestraSeparata?: boolean;
  evidenziazione?: { id: string; nonce: number } | null;
}) {
  const [comunicazioni, setComunicazioni] = useState<Comunicazione[]>([]);
  const [azione, setAzione] = useState("");
  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca);
  const [filtro, setFiltro] = useState<Filtro>("tutte");
  const [nuovaAperta, setNuovaAperta] = useState(false);
  const [destinatari, setDestinatari] = useState<DestinatarioManuale[]>([]);
  const [destinatarioIds, setDestinatarioIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [cercaDestinatario, setCercaDestinatario] = useState("");
  const cercaDestinatarioDifferita = useDeferredValue(cercaDestinatario);
  const [destinatariCaricando, setDestinatariCaricando] = useState(false);
  const [evidenziataId, setEvidenziataId] = useState<string | null>(null);
  const [selezionateIds, setSelezionateIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [campagneIgnorate, setCampagneIgnorate] = useState<Set<string>>(
    leggiCampagneIgnorate,
  );
  const versioneCaricamentoRef = useRef(0);

  useEffect(() => {
    const id = evidenziazione?.id?.trim();
    if (!id) return;
    setCerca("");
    setFiltro("tutte");
    setEvidenziataId(id);
    const timer = window.setTimeout(
      () => setEvidenziataId((corrente) => (corrente === id ? null : corrente)),
      1_600,
    );
    return () => window.clearTimeout(timer);
  }, [evidenziazione]);

  useEffect(() => {
    onModalStateChange?.(nuovaAperta);
    return () => onModalStateChange?.(false);
  }, [nuovaAperta, onModalStateChange]);

  const carica = useCallback(async (mostraErrore = false) => {
    const versione = ++versioneCaricamentoRef.current;
    try {
      const aggiornate = await api.comunicazioniLista();
      if (versione === versioneCaricamentoRef.current) {
        setComunicazioni(
          aggiornate.filter(
            (c) =>
              c.destinatarioEntita !== "diagnostica_whatsapp" &&
              !c.campagnaId?.startsWith("collaudo-whatsapp:"),
          ),
        );
      }
    } catch (error) {
      if (mostraErrore && versione === versioneCaricamentoRef.current) {
        toast.error(`Caricamento non riuscito: ${error}`);
      }
    }
  }, []);

  useEffect(() => {
    if (!attivo) return;
    void carica(true);
  }, [attivo, carica]);

  useRicaricaSuEventi(EVENTI_CENTRO_COMUNICAZIONI, () => {
    if (attivo) void carica();
  }, 120);

  const caricaDestinatari = useCallback(async (forza = false) => {
    if ((!forza && destinatari.length) || destinatariCaricando) return;
    setDestinatariCaricando(true);
    try {
      const [clienti, medici] = await Promise.all([
        api.recordsList("cliente"),
        api.recordsList("medico"),
      ]);
      const mappa = (
        record: RecordDto,
        entita: "cliente" | "medico",
      ): DestinatarioManuale => ({
        id: record.id,
        entita,
        nome: String(record.data.nome ?? "").trim() || "(senza nome)",
        email: String(record.data.email ?? "").trim(),
        telefono: String(record.data.telefono ?? "").trim(),
      });
      setDestinatari([
        ...clienti.map((record) => mappa(record, "cliente")),
        ...medici.map((record) => mappa(record, "medico")),
      ].sort((a, b) => a.nome.localeCompare(b.nome, "it")));
    } catch (error) {
      toast.error(`Destinatari non disponibili: ${error}`);
    } finally {
      setDestinatariCaricando(false);
    }
  }, [destinatari.length, destinatariCaricando]);

  useRicaricaSuEventi(EVENTI_DESTINATARI_COMUNICAZIONI, () => {
    if (nuovaAperta) void caricaDestinatari(true);
    else setDestinatari([]);
  }, 120);

  const apriSceltaDestinatario = async () => {
    setNuovaAperta(true);
    await caricaDestinatari();
  };

  const componiManuale = async () => {
    const selezionati = destinatari.filter((item) =>
      destinatarioIds.has(`${item.entita}:${item.id}`),
    );
    if (!selezionati.length) return;
    setNuovaAperta(false);
    const targets = selezionati.map((destinatario) => ({
      destinatarioEntita: destinatario.entita,
      destinatarioId: destinatario.id,
      destinatarioNome: destinatario.nome,
      email: destinatario.email,
      telefono: destinatario.telefono,
    }));
    const aperta =
      targets.length === 1
        ? await apriComunicazione(targets[0], {
            forzaFinestra: componiInFinestraSeparata,
          })
        : await apriCampagnaComunicazioni(targets, {
            forzaFinestra: componiInFinestraSeparata,
          });
    if (aperta) {
      onPrimaComposizione?.();
      setDestinatarioIds(new Set());
      setCercaDestinatario("");
    } else {
      setNuovaAperta(true);
    }
  };

  const destinatariVisibili = useMemo(() => {
    const query = cercaDestinatarioDifferita
      .trim()
      .toLocaleLowerCase("it");
    if (!query) return destinatari;
    return destinatari.filter((item) =>
      [item.nome, item.email, item.telefono, item.entita].some((valore) =>
        valore.toLocaleLowerCase("it").includes(query),
      ),
    );
  }, [cercaDestinatarioDifferita, destinatari]);

  const visibili = useMemo(() => {
    const query = cercaDifferita.trim().toLocaleLowerCase("it");
    return comunicazioni
      .filter((comunicazione) => appartieneAlFiltro(comunicazione, filtro))
      .filter((comunicazione) => {
        if (!query) return true;
        return [
          comunicazione.recapito,
          comunicazione.oggetto,
          comunicazione.corpo,
          comunicazione.proprietarioUtenteNome,
          comunicazione.proprietarioDispositivoNome,
        ].some((valore) => valore.toLocaleLowerCase("it").includes(query));
      })
      .sort((a, b) => b.creataMs - a.creataMs);
  }, [cercaDifferita, comunicazioni, filtro]);

  const eliminabiliIds = useMemo(
    () =>
      new Set(
        comunicazioni
          .filter(comunicazioneEliminabile)
          .map((comunicazione) => comunicazione.id),
      ),
    [comunicazioni],
  );
  const eliminabiliVisibiliIds = useMemo(
    () =>
      visibili
        .filter(comunicazioneEliminabile)
        .map((comunicazione) => comunicazione.id),
    [visibili],
  );
  const tutteLeVisibiliSelezionate =
    eliminabiliVisibiliIds.length > 0 &&
    eliminabiliVisibiliIds.every((id) => selezionateIds.has(id));
  const alcuneVisibiliSelezionate =
    !tutteLeVisibiliSelezionate &&
    eliminabiliVisibiliIds.some((id) => selezionateIds.has(id));
  const chiaveComunicazione = useCallback(
    (comunicazione: Comunicazione) => comunicazione.id,
    [],
  );

  useEffect(() => {
    setSelezionateIds((correnti) => {
      const prossime = new Set(
        [...correnti].filter((id) => eliminabiliIds.has(id)),
      );
      return prossime.size === correnti.size ? correnti : prossime;
    });
  }, [eliminabiliIds]);

  const selezionaComunicazione = (id: string, selezionata: boolean) => {
    setSelezionateIds((correnti) => {
      const prossime = new Set(correnti);
      if (selezionata) prossime.add(id);
      else prossime.delete(id);
      return prossime;
    });
  };

  const selezionaTutteLeVisibili = (selezionate: boolean) => {
    setSelezionateIds((correnti) => {
      const prossime = new Set(correnti);
      for (const id of eliminabiliVisibiliIds) {
        if (selezionate) prossime.add(id);
        else prossime.delete(id);
      }
      return prossime;
    });
  };

  const campagnaCorrente = useMemo(() => {
    const gruppi = new Map<string, Comunicazione[]>();
    for (const comunicazione of comunicazioni) {
      if (!comunicazione.campagnaId) continue;
      const gruppo = gruppi.get(comunicazione.campagnaId) ?? [];
      gruppo.push(comunicazione);
      gruppi.set(comunicazione.campagnaId, gruppo);
    }
    return [...gruppi.entries()]
      .map(([id, elementi]) => {
        const terminati = elementi.filter((item) =>
          [
            "invio_azionato",
            "consegna_verificata",
            "fallito",
            "annullato",
          ].includes(item.stato)
        ).length;
        const inPausa = elementi.some((item) => item.stato === "sospeso");
        const inCoda = elementi.some((item) => item.stato === "in_coda");
        const inInvio = elementi.some((item) => item.stato === "in_invio");
        const fallitiCerti = elementi.filter(
          (item) => item.stato === "fallito" && !item.esitoAmbiguo
        ).length;
        const fallitiAmbigui = elementi.filter(
          (item) => item.stato === "fallito" && item.esitoAmbiguo
        ).length;
        const falliti = elementi.filter((item) => item.stato === "fallito");
        const inviati = elementi.filter((item) =>
          ["invio_azionato", "consegna_verificata"].includes(item.stato)
        ).length;
        const annullati = elementi.filter(
          (item) => item.stato === "annullato"
        ).length;
        const completata = !elementi.some((item) =>
          ["bozza", "da_revisionare", "in_coda", "sospeso", "in_invio"].includes(
            item.stato
          )
        );
        const annullabili = elementi.some((item) =>
          ["bozza", "da_revisionare", "in_coda", "sospeso", "in_invio"].includes(
            item.stato
          )
        );
        return {
          id,
          elementi,
          terminati,
          inPausa,
          inCoda,
          inInvio,
          fallitiCerti,
          fallitiAmbigui,
          falliti,
          inviati,
          annullati,
          annullata: annullati > 0,
          completata,
          annullabili,
          aggiornataMs: Math.max(
            ...elementi.map((item) => item.statoAggiornatoMs || item.creataMs)
          ),
        };
      })
      .sort((a, b) => b.aggiornataMs - a.aggiornataMs)[0];
  }, [comunicazioni]);

  const esegui = async (id: string, operazione: () => Promise<Comunicazione>) => {
    if (azione) return;
    setAzione(id);
    try {
      const aggiornata = await operazione();
      setComunicazioni((correnti) =>
        correnti.map((item) => (item.id === aggiornata.id ? aggiornata : item))
      );
    } catch (error) {
      toast.error(`Operazione non riuscita: ${error}`);
    } finally {
      setAzione("");
    }
  };

  const riprova = async (comunicazione: Comunicazione) => {
    if (comunicazione.esitoAmbiguo) {
      const confermato = await dialog.confirm(
        "Controlla prima di reinviare",
        "Il messaggio potrebbe essere già partito. Verifica la conversazione o la Posta inviata, poi conferma soltanto se vuoi crearne uno nuovo.",
        { conferma: "Crea reinvio" }
      );
      if (!confermato) return;
      await esegui(comunicazione.id, () =>
        api.comunicazioneReinvia(comunicazione.id)
      );
      return;
    }
    await esegui(comunicazione.id, () =>
      api.comunicazioneMettiInCoda(comunicazione.id)
    );
  };

  const reinvia = async (comunicazione: Comunicazione) => {
    const confermato = await dialog.confirm(
      "Inviare di nuovo questa comunicazione?",
      `Verrà creato un nuovo invio verso ${comunicazione.recapito}, con lo stesso testo${
        comunicazione.canale === "email" ? " e lo stesso oggetto" : ""
      }.`,
      { conferma: "Invia di nuovo", annulla: "Annulla" },
    );
    if (!confermato) return;
    await esegui(comunicazione.id, () =>
      api.comunicazioneReinvia(comunicazione.id),
    );
  };

  const aggiornaCampagna = async (
    campagnaId: string,
    operazione: () => Promise<Comunicazione[]>
  ) => {
    if (azione) return false;
    setAzione(`campagna:${campagnaId}`);
    try {
      const aggiornate = await operazione();
      const perId = new Map(aggiornate.map((item) => [item.id, item]));
      setComunicazioni((correnti) =>
        correnti.map((item) => perId.get(item.id) ?? item)
      );
      return true;
    } catch (error) {
      toast.error(`Operazione sulla campagna non riuscita: ${error}`);
      return false;
    } finally {
      setAzione("");
    }
  };

  const riprovaFallitiCampagna = async (campagnaId: string, quanti: number) => {
    let rimessiInCoda = 0;
    let nonValidi = 0;
    const riuscita = await aggiornaCampagna(campagnaId, async () => {
      const aggiornate = await api.campagnaComunicazioneRiprovaFallite(campagnaId);
      rimessiInCoda = aggiornate.filter((item) => item.stato === "in_coda").length;
      nonValidi = aggiornate.filter(
        (item) =>
          item.stato === "fallito" &&
          item.erroreCodice === "recapito_anagrafica_non_valido",
      ).length;
      return aggiornate;
    });
    if (riuscita) {
      if (rimessiInCoda > 0 && nonValidi > 0) {
        toast.warning(
          `${rimessiInCoda} ${
            rimessiInCoda === 1 ? "messaggio rimesso" : "messaggi rimessi"
          } in coda; ${nonValidi} ${
            nonValidi === 1 ? "escluso" : "esclusi"
          } per recapito non valido in anagrafica.`,
        );
      } else if (rimessiInCoda > 0) {
        toast.success(
          rimessiInCoda === 1
            ? "Il messaggio fallito è stato rimesso in coda."
            : `${rimessiInCoda} messaggi falliti sono stati rimessi in coda.`,
        );
      } else if (nonValidi > 0) {
        toast.error(
          nonValidi === 1
            ? "Impossibile riprovare: il recapito in anagrafica non è valido."
            : `Impossibile riprovare: i recapiti di ${nonValidi} destinatari in anagrafica non sono validi.`,
        );
      } else {
        toast.success(
          quanti === 1
            ? "Il messaggio fallito è stato rimesso in coda."
            : `${quanti} messaggi falliti sono stati rimessi in coda.`,
        );
      }
    }
  };

  const annullaCampagna = async (campagnaId: string) => {
    const confermato = await dialog.confirm(
      "Interrompere la campagna?",
      "Gli invii già effettuati restano nello storico; saranno annullati soltanto quelli ancora pendenti.",
      { conferma: "Interrompi", annulla: "Continua campagna" }
    );
    if (!confermato) return;
    await aggiornaCampagna(campagnaId, () =>
      api.campagnaComunicazioneAnnulla(campagnaId)
    );
  };

  const eliminaComunicazione = async (comunicazione: Comunicazione) => {
    const confermato = await dialog.confirm(
      "Eliminare questa comunicazione?",
      "La voce sarà rimossa dalla cronologia. Un invio già effettuato non può essere annullato.",
      { conferma: "Elimina", annulla: "Conserva" },
    );
    if (!confermato || azione) return;
    setAzione(comunicazione.id);
    try {
      await api.comunicazioneElimina(comunicazione.id);
      versioneCaricamentoRef.current += 1;
      setComunicazioni((correnti) =>
        correnti.filter((item) => item.id !== comunicazione.id),
      );
      selezionaComunicazione(comunicazione.id, false);
    } catch (error) {
      toast.error(`Eliminazione non riuscita: ${error}`);
    } finally {
      setAzione("");
    }
  };

  const eliminaCampagna = async (campagnaId: string, quanti: number) => {
    const confermato = await dialog.confirm(
      "Scartare l’ultimo batch?",
      `${quanti} ${quanti === 1 ? "comunicazione sarà rimossa" : "comunicazioni saranno rimosse"} dalla cronologia.`,
      { conferma: "Scarta batch", annulla: "Conserva" },
    );
    if (!confermato || azione) return;
    setAzione(`campagna:${campagnaId}`);
    try {
      await api.campagnaComunicazioneElimina(campagnaId);
      versioneCaricamentoRef.current += 1;
      setComunicazioni((correnti) =>
        correnti.filter((item) => item.campagnaId !== campagnaId),
      );
      setSelezionateIds((correnti) => {
        const prossime = new Set(correnti);
        for (const comunicazione of comunicazioni) {
          if (comunicazione.campagnaId === campagnaId) {
            prossime.delete(comunicazione.id);
          }
        }
        return prossime;
      });
    } catch (error) {
      toast.error(`Eliminazione del batch non riuscita: ${error}`);
    } finally {
      setAzione("");
    }
  };

  const eliminaSelezionate = async () => {
    const ids = [...selezionateIds].filter((id) => eliminabiliIds.has(id));
    if (!ids.length || azione) return;
    const confermato = await dialog.confirm(
      "Eliminare le comunicazioni selezionate?",
      `${ids.length} ${ids.length === 1 ? "voce sarà rimossa" : "voci saranno rimosse"} dalla cronologia. Gli invii già effettuati non possono essere annullati.`,
      {
        conferma: ids.length === 1 ? "Elimina" : `Elimina ${ids.length}`,
        annulla: "Conserva",
      },
    );
    if (!confermato || azione) return;
    setAzione("eliminazione-batch");
    try {
      const eliminate = await api.comunicazioniElimina(ids);
      const eliminateIds = new Set(ids);
      versioneCaricamentoRef.current += 1;
      setComunicazioni((correnti) =>
        correnti.filter((item) => !eliminateIds.has(item.id)),
      );
      setSelezionateIds(new Set());
      toast.success(
        eliminate === 1
          ? "Comunicazione eliminata."
          : `${eliminate} comunicazioni eliminate.`,
      );
    } catch (error) {
      toast.error(`Eliminazione multipla non riuscita: ${error}`);
    } finally {
      setAzione("");
    }
  };

  const reinviaSelezionate = async () => {
    const ids = [...selezionateIds].filter((id) => eliminabiliIds.has(id));
    if (!ids.length || azione) return;
    const confermato = await dialog.confirm(
      "Inviare di nuovo le comunicazioni selezionate?",
      `Saranno creati ${ids.length} nuovi ${ids.length === 1 ? "invio" : "invii"} con gli stessi destinatari e contenuti. Le comunicazioni originali resteranno nello storico.`,
      {
        conferma: ids.length === 1 ? "Invia di nuovo" : `Reinvia ${ids.length}`,
        annulla: "Annulla",
      },
    );
    if (!confermato || azione) return;
    setAzione("reinvio-batch");
    try {
      const nuove = await api.comunicazioniReinvia(ids);
      versioneCaricamentoRef.current += 1;
      setComunicazioni((correnti) => {
        const perId = new Map(
          correnti.map((comunicazione) => [
            comunicazione.id,
            comunicazione,
          ]),
        );
        for (const comunicazione of nuove) {
          perId.set(comunicazione.id, comunicazione);
        }
        return [...perId.values()];
      });
      setSelezionateIds(new Set());
      toast.success(
        nuove.length === 1
          ? "Nuovo invio aggiunto alla coda."
          : `${nuove.length} nuovi invii aggiunti alla coda.`,
      );
    } catch (error) {
      toast.error(`Reinvio multiplo non riuscito: ${error}`);
    } finally {
      setAzione("");
    }
  };

  const ignoraCampagna = (campagnaId: string) => {
    setCampagneIgnorate((correnti) => {
      const prossime = new Set(correnti);
      prossime.add(campagnaId);
      try {
        window.localStorage.setItem(
          CHIAVE_CAMPAGNE_IGNORATE,
          JSON.stringify([...prossime].slice(-100)),
        );
      } catch {}
      return prossime;
    });
  };

  return (
      <Stack gap="md" style={{ flex: 1, minHeight: 0, height: "100%" }}>
        <Group gap="sm" wrap="nowrap">
          <TextInput
            value={cerca}
            onChange={(event) => setCerca(event.currentTarget.value)}
            placeholder="Cerca destinatario o testo…"
            leftSection={<IconSearch size={16} />}
            style={{ flex: 1 }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => void apriSceltaDestinatario()}
            style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}
          >
            Nuova comunicazione
          </Button>
        </Group>

        <SegmentedControl
          fullWidth
          value={filtro}
          onChange={(value) => setFiltro(value as Filtro)}
          data={[
            { value: "tutte", label: "Tutte" },
            { value: "attive", label: "In corso" },
            { value: "inviate", label: "Inviate" },
            { value: "errori", label: "Errori" },
          ]}
        />

        {campagnaCorrente && !campagneIgnorate.has(campagnaCorrente.id) && (
          <Box
            p="sm"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--mantine-radius-md)",
              background: "var(--mantine-color-body)",
            }}
          >
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={700}>
                    {campagnaCorrente.annullata
                      ? "Campagna annullata"
                      : campagnaCorrente.completata
                        ? "Campagna completata"
                      : "Campagna in corso"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {campagnaCorrente.inviati} inviati
                    {campagnaCorrente.annullati > 0 &&
                      ` · ${campagnaCorrente.annullati} annullati`}
                    {campagnaCorrente.fallitiCerti +
                      campagnaCorrente.fallitiAmbigui >
                      0 &&
                      ` · ${
                        campagnaCorrente.fallitiCerti +
                        campagnaCorrente.fallitiAmbigui
                      } errori`}
                  </Text>
                </Box>
                <Group gap={4} wrap="nowrap">
                  <Badge
                    color={
                      campagnaCorrente.inPausa
                        ? "gray"
                        : campagnaCorrente.annullata
                          ? "gray"
                        : campagnaCorrente.completata
                          ? campagnaCorrente.falliti.length
                            ? "red"
                            : "teal"
                          : "blue"
                    }
                    variant="light"
                  >
                    {campagnaCorrente.inPausa
                      ? "In pausa"
                      : campagnaCorrente.annullata
                        ? "Annullata"
                      : campagnaCorrente.completata
                        ? campagnaCorrente.falliti.length
                          ? "Completata con errori"
                          : "Completata"
                        : "Attiva"}
                  </Badge>
                  {campagnaCorrente.completata && (
                    <Tooltip label="Ignora questo riepilogo">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label="Ignora la campagna completata"
                        onClick={() => ignoraCampagna(campagnaCorrente.id)}
                      >
                        <IconX size={15} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
              <Progress
                value={
                  (campagnaCorrente.terminati /
                    campagnaCorrente.elementi.length) *
                  100
                }
                color={
                  campagnaCorrente.completata
                    ? campagnaCorrente.annullata
                      ? "gray"
                      : campagnaCorrente.falliti.length
                      ? "red"
                      : "teal"
                    : "yellow"
                }
                radius="xl"
                size="sm"
              />
              {campagnaCorrente.falliti.length > 0 && (
                <Box>
                  <Text size="xs" fw={600} c="red">
                    Invii falliti
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {campagnaCorrente.falliti
                      .slice(0, 3)
                      .map((item) => item.recapito)
                      .join(" · ")}
                    {campagnaCorrente.falliti.length > 3
                      ? ` · +${campagnaCorrente.falliti.length - 3} altri`
                      : ""}
                  </Text>
                </Box>
              )}
              <Group justify="flex-end" gap="xs">
                {campagnaCorrente.completata &&
                  campagnaCorrente.fallitiCerti > 0 && (
                    <Button
                      size="compact-xs"
                      variant="light"
                      leftSection={<IconRefresh size={13} />}
                      loading={azione === `campagna:${campagnaCorrente.id}`}
                      onClick={() =>
                        void riprovaFallitiCampagna(
                          campagnaCorrente.id,
                          campagnaCorrente.fallitiCerti
                        )
                      }
                    >
                      Riprova falliti
                    </Button>
                  )}
                {campagnaCorrente.inCoda && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="gray"
                    leftSection={<IconPlayerPause size={13} />}
                    loading={azione === `campagna:${campagnaCorrente.id}`}
                    onClick={() =>
                      void aggiornaCampagna(campagnaCorrente.id, () =>
                        api.campagnaComunicazioneSospendi(campagnaCorrente.id)
                      )
                    }
                  >
                    Pausa
                  </Button>
                )}
                {(campagnaCorrente.inPausa || campagnaCorrente.annullata) && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<IconPlayerPlay size={13} />}
                    loading={azione === `campagna:${campagnaCorrente.id}`}
                    onClick={() =>
                      void aggiornaCampagna(campagnaCorrente.id, () =>
                        api.campagnaComunicazioneRiprendi(campagnaCorrente.id)
                      ).then((riuscita) => {
                        if (riuscita && campagnaCorrente.annullata) {
                          toast.success(
                            campagnaCorrente.annullati === 1
                              ? "L’invio annullato è stato rimesso in coda."
                              : `${campagnaCorrente.annullati} invii annullati sono stati rimessi in coda.`,
                          );
                        }
                      })
                    }
                  >
                    {campagnaCorrente.annullata
                      ? "Riprendi mancanti"
                      : "Riprendi"}
                  </Button>
                )}
                {campagnaCorrente.annullabili && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconX size={13} />}
                    loading={azione === `campagna:${campagnaCorrente.id}`}
                    onClick={() => void annullaCampagna(campagnaCorrente.id)}
                  >
                    Interrompi
                  </Button>
                )}
                {campagnaCorrente.completata && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconTrash size={13} />}
                    loading={azione === `campagna:${campagnaCorrente.id}`}
                    onClick={() =>
                      void eliminaCampagna(
                        campagnaCorrente.id,
                        campagnaCorrente.elementi.length,
                      )
                    }
                  >
                    Scarta batch
                  </Button>
                )}
              </Group>
            </Stack>
          </Box>
        )}

        {eliminabiliVisibiliIds.length > 0 && (
          <Box
            px="sm"
            py={6}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--mantine-radius-md)",
              background: "var(--mantine-color-default-hover)",
            }}
          >
            <Group justify="space-between" gap="sm" wrap="nowrap">
              <Checkbox
                size="xs"
                color="yellow"
                checked={tutteLeVisibiliSelezionate}
                indeterminate={alcuneVisibiliSelezionate}
                onChange={(event) =>
                  selezionaTutteLeVisibili(event.currentTarget.checked)
                }
                label={`Seleziona messaggi (${eliminabiliVisibiliIds.length})`}
                aria-label="Seleziona tutte le comunicazioni eliminabili visibili"
              />
              {selezionateIds.size > 0 && (
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed" visibleFrom="xs">
                    {selezionateIds.size} selezionate
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => setSelezionateIds(new Set())}
                    disabled={Boolean(azione)}
                  >
                    Deseleziona
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="yellow"
                    leftSection={<IconRefresh size={13} />}
                    loading={azione === "reinvio-batch"}
                    disabled={Boolean(azione) && azione !== "reinvio-batch"}
                    onClick={() => void reinviaSelezionate()}
                  >
                    Invia di nuovo
                  </Button>
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="light"
                    leftSection={<IconTrash size={13} />}
                    loading={azione === "eliminazione-batch"}
                    disabled={
                      Boolean(azione) && azione !== "eliminazione-batch"
                    }
                    onClick={() => void eliminaSelezionate()}
                  >
                    Elimina
                  </Button>
                </Group>
              )}
            </Group>
          </Box>
        )}

        {visibili.length ? (
          <VirtualStack
            items={visibili}
            getKey={chiaveComunicazione}
            fill
            gap={5}
            estimateHeight={78}
            overscan={6}
            scrollToKey={evidenziataId}
            renderItem={(comunicazione) => {
              const stato = STATI[comunicazione.stato];
              const inAzione = azione === comunicazione.id;
              const annullabile = [
                "bozza",
                "da_revisionare",
                "in_coda",
                "sospeso",
                "fallito",
              ].includes(comunicazione.stato);
              const evidenziata = comunicazione.id === evidenziataId;
              const eliminabile = comunicazioneEliminabile(comunicazione);
              const selezionata = selezionateIds.has(comunicazione.id);
              return (
                <div>
                  <Box
                    key={
                      evidenziata
                        ? `${comunicazione.id}-${evidenziazione?.nonce ?? 0}`
                        : comunicazione.id
                    }
                    className={
                      evidenziata ? "pt-comunicazione-evidenziata" : undefined
                    }
                    px="sm"
                    py={5}
                    data-comunicazione-id={comunicazione.id}
                    style={{
                      borderStyle: "solid",
                      borderTopWidth: 1,
                      borderRightWidth: 1,
                      borderBottomWidth: 1,
                      borderLeftWidth: 3,
                      borderTopColor: selezionata
                        ? "var(--mantine-color-yellow-5)"
                        : "var(--border)",
                      borderRightColor: selezionata
                        ? "var(--mantine-color-yellow-5)"
                        : "var(--border)",
                      borderBottomColor: selezionata
                        ? "var(--mantine-color-yellow-5)"
                        : "var(--border)",
                      borderLeftColor:
                        comunicazione.canale === "email"
                          ? "var(--mantine-color-blue-5)"
                          : "var(--mantine-color-green-5)",
                      borderRadius: "var(--mantine-radius-md)",
                      background: selezionata
                        ? "var(--mantine-color-yellow-light)"
                        : "var(--mantine-color-body)",
                    }}
                  >
                    <Box className="pt-comunicazione-card-layout">
                      <Box className="pt-comunicazione-card-selezione">
                        {eliminabile ? (
                          <Checkbox
                            size="xs"
                            color="yellow"
                            checked={selezionata}
                            onChange={(event) =>
                              selezionaComunicazione(
                                comunicazione.id,
                                event.currentTarget.checked,
                              )
                            }
                            aria-label={`Seleziona ${
                              comunicazione.oggetto || comunicazione.recapito
                            }`}
                          />
                        ) : (
                          <Box w={16} />
                        )}
                      </Box>
                      <ThemeIcon
                        className="pt-comunicazione-card-icona"
                        variant="light"
                        color={
                          comunicazione.canale === "email" ? "blue" : "green"
                        }
                        size={34}
                        radius="md"
                      >
                        {comunicazione.canale === "email" ? (
                          <IconMail size={15} />
                        ) : (
                          <IconBrandWhatsapp size={15} />
                        )}
                      </ThemeIcon>

                      <Stack
                        className="pt-comunicazione-card-contenuto"
                        gap={4}
                      >
                        <Stack gap={2} style={{ minWidth: 0 }}>
                          <Text fw={700} size="sm" truncate>
                            {comunicazione.oggetto ||
                              (comunicazione.canale === "whatsapp"
                                ? "Messaggio WhatsApp"
                                : "E-mail")}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {comunicazione.recapito}
                          </Text>
                        </Stack>
                        <Box className="pt-comunicazione-card-corpo">
                          <CorpoComunicazioneCompatto
                            corpo={comunicazione.corpo}
                            ultimoErrore={comunicazione.ultimoErrore}
                            erroreFase={comunicazione.erroreFase}
                          />
                        </Box>
                      </Stack>

                      <Stack
                        className="pt-comunicazione-card-controlli"
                        gap={4}
                        align="flex-end"
                        justify="space-between"
                      >
                        <Text size="xs" c="dimmed" truncate maw={220}>
                          {dataOra(
                            comunicazione.inviataMs || comunicazione.creataMs,
                          )}{" "}
                          · {comunicazione.proprietarioUtenteNome}
                        </Text>
                        <Group gap={8} wrap="nowrap">
                          <Badge
                            className="pt-comunicazione-card-stato-badge"
                            color={stato.color}
                            variant="light"
                            size="sm"
                          >
                            {stato.label}
                          </Badge>
                          <Group gap={4} wrap="nowrap">
                          {comunicazione.stato === "bozza" && (
                            <Tooltip label="Invia" withArrow>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="yellow"
                                loading={inAzione}
                                aria-label="Invia comunicazione"
                                onClick={() =>
                                  void esegui(comunicazione.id, () =>
                                    api.comunicazioneMettiInCoda(
                                      comunicazione.id,
                                    )
                                  )
                                }
                              >
                                <IconSend size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {comunicazione.stato === "fallito" && (
                            <Tooltip
                              label={
                                comunicazione.esitoAmbiguo
                                  ? "Controlla e reinvia"
                                  : "Riprova"
                              }
                              withArrow
                            >
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="yellow"
                                loading={inAzione}
                                aria-label={
                                  comunicazione.esitoAmbiguo
                                    ? "Controlla e reinvia"
                                    : "Riprova comunicazione"
                                }
                                onClick={() => void riprova(comunicazione)}
                              >
                                <IconRefresh size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {[
                            "invio_azionato",
                            "consegna_verificata",
                          ].includes(comunicazione.stato) && (
                            <Tooltip label="Invia di nuovo" withArrow>
                              <ActionIcon
                                size="sm"
                                variant="light"
                                color="yellow"
                                loading={inAzione}
                                aria-label="Invia di nuovo"
                                onClick={() => void reinvia(comunicazione)}
                              >
                                <IconRefresh size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {annullabile &&
                            comunicazione.stato !== "fallito" && (
                              <Tooltip label="Annulla" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  loading={inAzione}
                                  aria-label="Annulla comunicazione"
                                  onClick={() =>
                                    void esegui(comunicazione.id, () =>
                                      api.comunicazioneAnnulla(
                                        comunicazione.id,
                                      )
                                    )
                                  }
                                >
                                  <IconX size={15} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          {eliminabile && (
                            <Tooltip
                              label="Elimina dalla cronologia"
                              withArrow
                            >
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                loading={inAzione}
                                aria-label="Elimina comunicazione"
                                onClick={() =>
                                  void eliminaComunicazione(comunicazione)
                                }
                              >
                                <IconTrash size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          </Group>
                        </Group>
                      </Stack>
                    </Box>
                  </Box>
                </div>
              );
            }}
          />
        ) : (
          <Stack align="center" justify="center" gap="xs" style={{ flex: 1 }} ta="center">
            <ThemeIcon size={52} radius="xl" variant="light" color="gray">
              <IconHistory size={25} />
            </ThemeIcon>
            <Text fw={700}>Nessuna comunicazione</Text>
            <Text size="sm" c="dimmed" maw={360}>
              Le bozze e gli invii preparati da clienti, pagamenti e spedizioni
              compariranno qui.
            </Text>
          </Stack>
        )}
        <Modal
          opened={nuovaAperta}
          onClose={() => setNuovaAperta(false)}
          centered
          size="md"
          title={<TitoloNuovaComunicazione />}
          transitionProps={{ transition: "fade", duration: 180 }}
          styles={{
            content: { overflow: "hidden" },
            body: { overflow: "hidden" },
          }}
        >
          <Stack
            gap="md"
            style={{
              height: "min(620px, calc(100dvh - 128px))",
              minHeight: 0,
            }}
          >
            <Text size="sm" c="dimmed">
              Scegli il destinatario. Oggetto e messaggio partiranno vuoti e il
              modello sarà facoltativo.
            </Text>
            <TextInput
              label="Destinatari"
              placeholder="Cerca cliente, medico o recapito…"
              leftSection={<IconSearch size={16} />}
              value={cercaDestinatario}
              onChange={(event) =>
                setCercaDestinatario(event.currentTarget.value)
              }
              disabled={destinatariCaricando}
            />
            <Box
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--mantine-radius-md)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                flex: "1 1 220px",
                minHeight: 0,
              }}
            >
              {destinatariCaricando ? (
                <StatoElencoDestinatari messaggio="Caricamento destinatari…" />
              ) : destinatariVisibili.length ? (
                <VirtualStack
                  items={destinatariVisibili}
                  getKey={(item) => `${item.entita}:${item.id}`}
                  fill
                  estimateHeight={58}
                  overscan={7}
                  renderItem={(item) => {
                    const id = `${item.entita}:${item.id}`;
                    const selezionato = destinatarioIds.has(id);
                    const cambiaSelezione = () =>
                      setDestinatarioIds((correnti) => setConToggle(correnti, id));
                    return (
                      <Box
                        px="sm"
                        py={8}
                        role="button"
                        tabIndex={0}
                        onClick={cambiaSelezione}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          cambiaSelezione();
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto minmax(0, 1fr)",
                          gap: 10,
                          alignItems: "center",
                          cursor: "pointer",
                          background: selezionato
                            ? "var(--mantine-color-yellow-light)"
                            : "transparent",
                        }}
                      >
                        <Checkbox
                          checked={selezionato}
                          onChange={() => {}}
                          tabIndex={-1}
                          aria-hidden
                        />
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={600} truncate>
                            {item.nome}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {item.entita === "cliente" ? "Cliente" : "Medico"}
                            {item.email ? ` · ${item.email}` : ""}
                            {item.telefono ? ` · ${item.telefono}` : ""}
                          </Text>
                        </Box>
                      </Box>
                    );
                  }}
                />
              ) : (
                <StatoElencoDestinatari messaggio="Nessun destinatario trovato" />
              )}
            </Box>
            <Text size="xs" c="dimmed">
              {destinatarioIds.size
                ? `${destinatarioIds.size} ${destinatarioIds.size === 1 ? "destinatario selezionato" : "destinatari selezionati"}`
                : "Puoi selezionare uno o più destinatari."}
            </Text>
            <Group justify="flex-end" className="pt-modal-footer">
              <Button
                variant="default"
                onClick={() => setNuovaAperta(false)}
              >
                Annulla
              </Button>
              <Button
                leftSection={<IconSend size={16} />}
                disabled={!destinatarioIds.size || destinatariCaricando}
                onClick={() => void componiManuale()}
              >
                {destinatarioIds.size > 1 ? "Componi per tutti" : "Componi"}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
  );
}

export function CentroComunicazioniHost() {
  const [aperto, setAperto] = useState(false);
  const [modaleFiglioAperto, setModaleFiglioAperto] = useState(false);
  const [presentazione, setPresentazione] =
    useState<PresentazioneCentroComunicazioni>("laterale");
  const [evidenziazione, setEvidenziazione] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const ultimaRichiestaRef = useRef("");

  useEffect(() => {
    const apri = (
      event?: Event | { payload?: AperturaCentroComunicazioni },
    ) => {
      const dettaglio =
        event && "payload" in event
          ? event.payload
          : (event as CustomEvent<AperturaCentroComunicazioni> | undefined)
              ?.detail;
      if (
        dettaglio?.richiestaId &&
        dettaglio.richiestaId === ultimaRichiestaRef.current
      ) {
        return;
      }
      if (dettaglio?.richiestaId) {
        ultimaRichiestaRef.current = dettaglio.richiestaId;
      }
      setPresentazione(dettaglio?.presentazione ?? "laterale");
      if (dettaglio?.comunicazioneId) {
        setEvidenziazione({
          id: dettaglio.comunicazioneId,
          nonce: Date.now(),
        });
      } else {
        setEvidenziazione(null);
      }
      setAperto(true);
    };
    const apriLocale = (event: Event) => apri(event);
    window.addEventListener(EVENTO_APRI_CENTRO_COMUNICAZIONI, apriLocale);
    const disiscriviTauri = collegaDisiscrizioneAsincrona(
      import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<AperturaCentroComunicazioni>(
          EVENTO_APRI_CENTRO_COMUNICAZIONI,
          apri,
        )
      ),
    );
    return () => {
      window.removeEventListener(
        EVENTO_APRI_CENTRO_COMUNICAZIONI,
        apriLocale
      );
      disiscriviTauri();
    };
  }, []);

  const contenuto = (
    <CentroComunicazioniContenuto
      attivo={aperto}
      onModalStateChange={setModaleFiglioAperto}
      onPrimaComposizione={() => setAperto(false)}
      evidenziazione={evidenziazione}
    />
  );

  if (presentazione === "modale") {
    return (
      <Modal
        opened={aperto}
        onClose={() => setAperto(false)}
        closeOnEscape={!modaleFiglioAperto}
        title={
          <Group gap="sm">
            <ThemeIcon variant="light" color="yellow" radius="md">
              <IconHistory size={18} />
            </ThemeIcon>
            <Text fw={700}>Cronologia comunicazioni</Text>
          </Group>
        }
        size="min(820px, calc(100vw - 32px))"
        centered
        transitionProps={{ transition: "fade", duration: 180 }}
        styles={{
          body: {
            height: "min(680px, calc(100vh - 140px))",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        }}
      >
        {contenuto}
      </Modal>
    );
  }

  return (
    <Drawer
      opened={aperto}
      onClose={() => setAperto(false)}
      closeOnEscape={!modaleFiglioAperto}
      position="right"
      size="min(760px, calc(100vw - 24px))"
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="yellow" radius="md">
            <IconHistory size={18} />
          </ThemeIcon>
          <Text fw={700}>Centro comunicazioni</Text>
        </Group>
      }
      overlayProps={{ backgroundOpacity: 0.28 }}
      styles={{
        body: {
          height: "calc(100% - 68px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
      }}
    >
      {contenuto}
    </Drawer>
  );
}

export function CentroComunicazioniWindow() {
  useRicordaGeometria("comunicazioni");
  const iniziale = new URLSearchParams(window.location.search).get(
    "evidenzia",
  );
  const [evidenziazione, setEvidenziazione] = useState<{
    id: string;
    nonce: number;
  } | null>(
    iniziale ? { id: iniziale, nonce: Date.now() } : null,
  );

  useEffect(() => {
    const disiscriviTauri = collegaDisiscrizioneAsincrona(
      import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) =>
        getCurrentWebviewWindow().listen<AperturaCentroComunicazioni>(
          EVENTO_APRI_CENTRO_COMUNICAZIONI,
          ({ payload }) => {
            if (payload.comunicazioneId) {
              setEvidenziazione({
                id: payload.comunicazioneId,
                nonce: Date.now(),
              });
            } else {
              setEvidenziazione(null);
            }
          },
        ),
      ),
    );
    return disiscriviTauri;
  }, []);

  return (
    <Box
      p="md"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
        overflow: "hidden",
      }}
    >
      <Text fw={800} size="lg" mb="md">
        Cronologia comunicazioni
      </Text>
      <CentroComunicazioniContenuto
        evidenziazione={evidenziazione}
        componiInFinestraSeparata
        onPrimaComposizione={() => void chiudiFinestraCorrente()}
      />
    </Box>
  );
}
