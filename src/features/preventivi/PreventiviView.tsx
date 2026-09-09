import {
  ActionIcon,
  Box,
  Button,
  Group,
  Indicator,
  Menu,
  MultiSelect,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconBell,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconEye,
  IconFileInvoice,
  IconMail,
  IconPhoto,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DataTableColumn,
  type DataTableSortStatus,
  Tabella,
} from "../../ui/Tabella";
import { Pagina } from "../../pages/Pagina";
import {
  api,
  type ConfigurazioneDocumenti,
  type Identity,
  type Preventivo,
} from "../../lib/tauri";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { toast } from "../../ui/toast/store";
import { centsToEurStr } from "../../lib/money";
import { PreventivoEditorModal } from "./PreventivoEditorModal";
import type { BozzaPreventivoDaZero } from "./bozzaPreventivo";
import { DocumentoPreviewModal } from "./DocumentoPreviewModal";
import {
  creaDocumentoPreventivo,
  documentoPdfBlob,
  documentoPngBlob,
  salvaBlobConPercorso,
  type DocumentoA4,
} from "./rendererDocumenti";
import {
  stampaPreventivoDiretta,
  stampaSchedaClienteDiretta,
} from "./stampaDiretta";
import {
  apriCampagnaComunicazioni,
  apriComunicazione,
  type CampagnaComunicazioneTarget,
  type ComunicazioneTarget,
} from "../comunicazioni/apriComunicazione";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { ContextMenuPuntuale, puntoDaEventoContextMenu } from "../../ui/ContextMenuTarget";
import { FiltroIntervalloDate } from "../../ui/FiltroIntervalloDate";
import { usePrefs } from "../../lib/prefs";
import {
  classificaSollecitiPreventivi,
  type GruppoSollecitiPreventivi,
} from "./sollecitiPreventivi";
import { ColonneMenu } from "../giornaliero/ColonneMenu";
import {
  STORE_LARGHEZZE_PREVENTIVI,
  useColonnePreventivi,
} from "./colonnePreventivi";
import {
  catturaOrigineCestino,
  volaNelCestino,
  type PuntoVoloCestino,
} from "../../ui/volaCestino";
import { dialog } from "../../ui/dialog/store";
import { NuovoPreventivoModal } from "./NuovoPreventivoModal";
import {
  apriFinestraPreventivo,
  apriFinestraPreventivoDaBozza,
} from "./apriFinestraPreventivo";
import { testoRicercaPreventivo } from "./ricercaPreventivi";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { formattaDataOraBreve as dataOra } from "../../lib/date";
import {
  ColonneDominioProvider,
  DataColonnaAdattiva,
  LineeOrdineBadge,
  StatoInvioPreventivoBadge,
  StatoOrdineBadge,
  statoInvioPreventivoDef,
  STATI_INVIO_PREVENTIVO,
  type RigaDominioColonne,
} from "../giornaliero/colonne";
import { RiepilogoLink } from "../../shell/RiepilogoLink";
import { SelettoreSollecitiPreventiviModal } from "./SelettoreSollecitiPreventiviModal";
import { STATI_ORDINE } from "../giornaliero/stati";
import {
  avviaInvioRapidoPreventivo,
  destinatarioPreventivo,
  variabiliPreventivo,
} from "./invioRapidoPreventivo";

const EVENTI_RICARICA = [
  "preventivo:salvato",
  "ordine:salvato",
  "riga_ordine:salvato",
  "pagamento:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "prodotto:salvato",
  "comunicazione:salvato",
  "configurazione_documenti:salvato",
] as const;

function dataCreazioneIso(preventivo: Preventivo): string {
  if (!preventivo.creatoMs) return "";
  const data = new Date(preventivo.creatoMs);
  const parte = (valore: number) => String(valore).padStart(2, "0");
  return `${data.getFullYear()}-${parte(data.getMonth() + 1)}-${parte(data.getDate())}`;
}

function valoriUnici(valori: string[]): string[] {
  return [...new Set(valori.map((valore) => valore.trim()).filter(Boolean))];
}

function prodottiPreventivo(preventivo: Preventivo): string[] {
  return valoriUnici(preventivo.righe.map((riga) => riga.prodottoNome));
}

export function ultimoInvioOModificaPreventivo(preventivo: Preventivo): number {
  return Math.max(preventivo.ultimoInvioMs, preventivo.ultimaModificaMs);
}

function indirizzoCompatto(
  nome: string,
  indirizzo: string,
  cap: string,
  citta: string,
  prov: string,
): string {
  const localita = [
    [cap, citta].filter(Boolean).join(" "),
    prov ? `(${prov})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [nome, indirizzo, localita].filter(Boolean).join(" · ") || "—";
}

type TipoIndirizzoPreventivo = "spedizione" | "fatturazione";

function indirizzoPreventivo(
  preventivo: Preventivo,
  tipo: TipoIndirizzoPreventivo,
): string {
  return tipo === "spedizione"
    ? indirizzoCompatto(
        preventivo.spedizioneNome,
        preventivo.spedizioneIndirizzo,
        preventivo.spedizioneCap,
        preventivo.spedizioneCitta,
        preventivo.spedizioneProv,
      )
    : indirizzoCompatto(
        preventivo.fatturazioneNome,
        preventivo.fatturazioneIndirizzo,
        preventivo.fatturazioneCap,
        preventivo.fatturazioneCitta,
        preventivo.fatturazioneProv,
      );
}

function cellaIndirizzoPreventivo(
  preventivo: Preventivo,
  tipo: TipoIndirizzoPreventivo,
) {
  const valore = indirizzoPreventivo(preventivo, tipo);
  return (
    <Tooltip label={valore} withArrow multiline maw={380}>
      <Text size="sm" truncate>{valore}</Text>
    </Tooltip>
  );
}

function targetComunicazionePreventivo(
  preventivo: Preventivo,
  tipo: ComunicazioneTarget["tipo"],
): ComunicazioneTarget {
  return {
    ...destinatarioPreventivo(preventivo),
    email: preventivo.email,
    telefono: preventivo.telefono,
    tipo,
    origineEntita: "preventivo",
    origineId: preventivo.id,
    origineRevision: preventivo.revision,
    origineFingerprint: preventivo.fingerprintCorrente,
    documentoPreventivo: preventivo,
    variabili: variabiliPreventivo(preventivo),
  };
}

export function PreventiviView({ identity }: { identity: Identity }) {
  const { giorniSollecitoPreventivi, ordineFinestra } = usePrefs();
  const colonne = useColonnePreventivi();
  const [preventivi, setPreventivi] = useState<Preventivo[]>([]);
  const [disponibili, setDisponibili] = useState<Preventivo[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [cerca, setCerca] = useState("");
  const [linee, setLinee] = useState<string[]>([]);
  const [indicazioni, setIndicazioni] = useState<string[]>([]);
  const [stati, setStati] = useState<string[]>([]);
  const [agente, setAgente] = useState<string | null>(null);
  const [prodotti, setProdotti] = useState<string[]>([]);
  const [creatoDal, setCreatoDal] = useState("");
  const [creatoAl, setCreatoAl] = useState("");
  const [sort, setSort] = useState<DataTableSortStatus<Preventivo>>({
    columnAccessor: "creatoMs",
    direction: "desc",
  });
  const [ordineEditor, setOrdineEditor] = useState<string | null>(null);
  const [bozzaEditor, setBozzaEditor] =
    useState<BozzaPreventivoDaZero | null>(null);
  const [selettoreOpened, setSelettoreOpened] = useState(false);
  const [selettoreSollecitiOpened, setSelettoreSollecitiOpened] =
    useState(false);
  const [anteprima, setAnteprima] = useState<DocumentoA4 | null>(null);
  const [preventivoAnteprima, setPreventivoAnteprima] =
    useState<Preventivo | null>(null);
  const [anteprimaDaModifica, setAnteprimaDaModifica] = useState(false);
  const [invioRapidoId, setInvioRapidoId] = useState("");
  const [configDocumenti, setConfigDocumenti] =
    useState<ConfigurazioneDocumenti | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    record: Preventivo;
  } | null>(null);
  const origineMenuAzioniRef = useRef<PuntoVoloCestino | null>(null);
  useCloseOnScroll(!!contextMenu, (opened) => {
    if (!opened) setContextMenu(null);
  });

  const carica = useCallback(async (silente = false) => {
    if (!silente) setCaricamento(true);
    try {
      setPreventivi(await api.preventiviLista());
    } catch (error) {
      toast.error(`Caricamento preventivi non riuscito: ${error}`);
    } finally {
      setCaricamento(false);
    }
  }, []);

  // Questi dati servono soltanto quando si apre il flusso di creazione o
  // l'anteprima: non devono ritardare la comparsa della tabella.
  const caricaRiferimenti = useCallback(async () => {
    const [ordini, config] = await Promise.all([
      api.preventivoOrdiniDisponibili().catch(() => null),
      api.configurazioneDocumentiGet().catch(() => null),
    ]);
    if (ordini) setDisponibili(ordini);
    if (config) setConfigDocumenti(config);
  }, []);

  useEffect(() => {
    void carica();
    void caricaRiferimenti();
    const intervallo = window.setInterval(() => void carica(true), 30_000);
    return () => window.clearInterval(intervallo);
  }, [carica, caricaRiferimenti]);
  useRicaricaSuEventi(EVENTI_RICARICA, () => {
    void carica(true);
    void caricaRiferimenti();
  });

  const preventiviConBlob = useMemo(
    () =>
      preventivi.map((preventivo) => ({
        ...preventivo,
        _searchBlob: testoRicercaPreventivo(preventivo),
      })),
    [preventivi],
  );

  const filtrati = useMemo(() => {
    const query = cerca.trim().toLocaleLowerCase("it");
    return preventiviConBlob.filter((preventivo) => {
      if (query && !preventivo._searchBlob.includes(query)) {
        return false;
      }
      if (linee.length > 0 && !linee.some((linea) => preventivo.linee.includes(linea))) {
        return false;
      }
      if (indicazioni.length > 0 && !indicazioni.includes(preventivo.indicazioneInvio)) {
        return false;
      }
      if (stati.length > 0 && !stati.includes(preventivo.ordineStato)) {
        return false;
      }
      if (agente && preventivo.agenteNome !== agente) {
        return false;
      }
      if (
        prodotti.length > 0 &&
        !prodottiPreventivo(preventivo).some((prodotto) =>
          prodotti.includes(prodotto),
        )
      ) {
        return false;
      }
      const creazione = dataCreazioneIso(preventivo);
      if (creatoDal && creazione < creatoDal) return false;
      if (creatoAl && creazione > creatoAl) return false;
      return true;
    });
  }, [
    preventiviConBlob,
    cerca,
    linee,
    indicazioni,
    stati,
    agente,
    prodotti,
    creatoDal,
    creatoAl,
  ]);

  const agentiOpzioni = useMemo(
    () =>
      valoriUnici(preventivi.map((preventivo) => preventivo.agenteNome)).sort(
        (a, b) => a.localeCompare(b, "it"),
      ),
    [preventivi],
  );
  const prodottiOpzioni = useMemo(
    () =>
      valoriUnici(preventivi.flatMap(prodottiPreventivo)).sort((a, b) =>
        a.localeCompare(b, "it"),
      ),
    [preventivi],
  );

  const ordinati = useMemo(() => {
    const result = [...filtrati];
    const accessor = String(sort.columnAccessor);
    const value = (preventivo: Preventivo): string | number => {
      if (accessor === "creatoMs") return preventivo.creatoMs;
      if (accessor === "totale") return preventivo.totale;
      if (accessor === "acconto") return preventivo.acconto;
      if (accessor === "ultimoInvioMs") {
        return {
          mai_inviato: 0,
          modificato_dopo_invio: 1,
          inviato: 2,
        }[preventivo.indicazioneInvio] ?? 0;
      }
      if (accessor === "clienteNome") {
        return preventivo.clienteNome || preventivo.medicoNome;
      }
      if (accessor === "prodotti") {
        return prodottiPreventivo(preventivo).join(", ");
      }
      if (accessor === "linee") return preventivo.linee.join(", ");
      if (accessor === "spedizione") {
        return indirizzoPreventivo(preventivo, "spedizione");
      }
      if (accessor === "fatturazione") {
        return indirizzoPreventivo(preventivo, "fatturazione");
      }
      return String((preventivo as unknown as Record<string, unknown>)[accessor] ?? "");
    };
    result.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const compare =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "it", { numeric: true });
      return sort.direction === "asc" ? compare : -compare;
    });
    return result;
  }, [filtrati, sort]);

  const classificazioneSolleciti = useMemo(
    () => classificaSollecitiPreventivi(preventivi, giorniSollecitoPreventivi),
    [giorniSollecitoPreventivi, preventivi],
  );

  function mostraAnteprima(
    preventivo: Preventivo,
    documento?: DocumentoA4,
    daModifica = false,
  ) {
    setPreventivoAnteprima(preventivo);
    setAnteprimaDaModifica(daModifica);
    setAnteprima(
      documento ??
        creaDocumentoPreventivo(preventivo, configDocumenti ?? undefined),
    );
  }

  async function stampaSchedaDiretta(preventivo: Preventivo) {
    try {
      await stampaSchedaClienteDiretta(
        preventivo.ordineId,
        preventivo.ordineNumero,
        configDocumenti,
      );
    } catch (error) {
      toast.error(`Stampa scheda cliente non riuscita: ${error}`);
    }
  }

  async function inviaRapido(preventivo: Preventivo) {
    if (invioRapidoId === preventivo.id) return;
    setInvioRapidoId(preventivo.id);
    try {
      await avviaInvioRapidoPreventivo(preventivo);
    } finally {
      setInvioRapidoId("");
    }
  }

  async function salvaImmagine(preventivo: Preventivo) {
    const documento = creaDocumentoPreventivo(
      preventivo,
      configDocumenti ?? undefined,
    );
    if (documento.overflow.length) {
      mostraAnteprima(preventivo, documento);
      return;
    }
    try {
      const blob = await documentoPngBlob(documento);
      await salvaBlobConPercorso(blob, documento.nomeFile.replace(/\.pdf$/i, ".png"));
    } catch (error) {
      toast.error(`Generazione immagine non riuscita: ${error}`);
    }
  }

  async function sollecita(preventivo: Preventivo) {
    const target = destinatarioPreventivo(preventivo);
    if (!target.destinatarioId || !target.destinatarioNome) {
      toast.warning("Il preventivo non ha un destinatario valido.");
      return;
    }
    await apriComunicazione(
      targetComunicazionePreventivo(preventivo, "sollecito_preventivo"),
    );
  }

  async function apriEditorPreventivo(preventivo: Preventivo) {
    if (
      ordineFinestra !== "mai" &&
      (await apriFinestraPreventivo(
        preventivo.ordineId,
        preventivo.numeroPreventivo,
        identity,
      ))
    ) {
      return;
    }
    setOrdineEditor(preventivo.ordineId);
  }

  function nuovoPreventivo() {
    setSelettoreOpened(true);
  }

  async function continuaNuovoDaOrdine(ordineId: string) {
    setSelettoreOpened(false);
    const ordine = disponibili.find((item) => item.ordineId === ordineId);
    if (
      ordineFinestra === "sempre" &&
      (await apriFinestraPreventivo(ordineId, ordine?.ordineNumero, identity))
    ) {
      return;
    }
    window.setTimeout(() => setOrdineEditor(ordineId), 190);
  }

  async function continuaNuovoDaZero(bozza: BozzaPreventivoDaZero) {
    setSelettoreOpened(false);
    if (
      ordineFinestra === "sempre" &&
      (await apriFinestraPreventivoDaBozza(bozza, identity))
    ) {
      return;
    }
    window.setTimeout(() => setBozzaEditor(bozza), 190);
  }

  async function eliminaPreventivo(
    preventivo: Preventivo,
    origine: PuntoVoloCestino,
  ) {
    const conferma = await dialog.confirmDanger(
      "Spostare il preventivo nel Cestino?",
      `${preventivo.numeroPreventivo} verrà eliminato; l’ordine del Giornaliero resterà invariato.`,
      { conferma: "Elimina preventivo" },
    );
    if (!conferma) return;
    try {
      setPreventivi((correnti) =>
        correnti.filter((item) => item.id !== preventivo.id),
      );
      await api.preventivoElimina(preventivo.id, preventivo.revision);
      if (!volaNelCestino(origine))
        toast.success("Preventivo spostato nel Cestino.");
      void carica(true);
    } catch (error) {
      toast.error(`Eliminazione preventivo non riuscita: ${error}`);
      void carica(true);
    }
  }

  async function apriCampagnaSolleciti(
    gruppo: GruppoSollecitiPreventivi,
    selezionati: Preventivo[],
  ) {
    const targets = selezionati.map<CampagnaComunicazioneTarget>((preventivo) => ({
      ...targetComunicazionePreventivo(
        preventivo,
        gruppo === "da_inviare" ? "preventivo" : "sollecito_preventivo",
      ),
      snapshot: [
        { entita: "preventivo", id: preventivo.id, revision: preventivo.revision },
        { entita: "ordine", id: preventivo.ordineId, revision: preventivo.ordineRevision },
      ],
    }));
    if (!(await apriCampagnaComunicazioni(targets))) {
      toast.warning("Nessun destinatario valido per la campagna.");
    }
  }

  function vociMenuPreventivo(
    preventivo: Preventivo,
    chiudi: () => void = () => {},
    origineCestino?: PuntoVoloCestino | null | (() => PuntoVoloCestino | null),
  ) {
    return (
      <>
        <Menu.Item
          leftSection={<IconEdit size={15} />}
          onClick={() => {
            void apriEditorPreventivo(preventivo);
            chiudi();
          }}
        >
          Apri / modifica
        </Menu.Item>
        <Menu.Item
          leftSection={<IconEye size={15} />}
          onClick={() => {
            mostraAnteprima(preventivo);
            chiudi();
          }}
        >
          Anteprima
        </Menu.Item>
        <Menu.Item
          leftSection={<IconFileInvoice size={15} />}
          onClick={() => {
            chiudi();
            try {
              stampaPreventivoDiretta(preventivo, configDocumenti);
            } catch (error) {
              toast.warning(String(error));
            }
          }}
        >
          Stampa preventivo
        </Menu.Item>
        <Menu.Item
          leftSection={<IconDownload size={15} />}
          onClick={() => {
            const documento = creaDocumentoPreventivo(
              preventivo,
              configDocumenti ?? undefined,
            );
            if (documento.overflow.length) {
              mostraAnteprima(preventivo, documento);
            } else {
              void salvaBlobConPercorso(
                documentoPdfBlob(documento),
                documento.nomeFile,
              );
            }
            chiudi();
          }}
        >
          Salva PDF
        </Menu.Item>
        <Menu.Item
          leftSection={<IconPhoto size={15} />}
          onClick={() => {
            void salvaImmagine(preventivo);
            chiudi();
          }}
        >
          Salva immagine
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconMail size={15} />}
          onClick={() => {
            void inviaRapido(preventivo);
            chiudi();
          }}
        >
          Invia
        </Menu.Item>
        <Menu.Item
          leftSection={<IconBell size={15} />}
          disabled={
            preventivo.indicazioneInvio !== "inviato" ||
            preventivo.ordineStato !== "Nuovo"
          }
          onClick={() => {
            void sollecita(preventivo);
            chiudi();
          }}
        >
          Sollecita
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconPrinter size={15} />}
          onClick={() => {
            chiudi();
            void stampaSchedaDiretta(preventivo);
          }}
        >
          Stampa scheda cliente
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<IconTrash size={15} />}
          onClick={(event) => {
            const origine =
              (typeof origineCestino === "function"
                ? origineCestino()
                : origineCestino) ?? catturaOrigineCestino(event);
            chiudi();
            void eliminaPreventivo(preventivo, origine);
          }}
        >
          Elimina preventivo
        </Menu.Item>
      </>
    );
  }

  const tutteLeColumns = useMemo<DataTableColumn<Preventivo>[]>(
    () => [
      {
        accessor: "numeroPreventivo",
        title: "Preventivo",
        sortable: true,
        width: 138,
        render: (preventivo) => (
          <Stack gap={1}>
            <Text fw={700} size="sm">
              {preventivo.numeroPreventivo}
            </Text>
            <Text size="xs" c="dimmed">
              Ordine {preventivo.ordineNumero}
            </Text>
          </Stack>
        ),
      },
      {
        accessor: "creatoMs",
        title: "Creazione",
        sortable: true,
        width: 96,
        render: (preventivo) => (
          <DataColonnaAdattiva iso={dataCreazioneIso(preventivo)} />
        ),
      },
      {
        accessor: "clienteNome",
        title: "Cliente / destinatario",
        sortable: true,
        render: (preventivo) => (
          <Stack gap={1}>
            {(() => {
              const target = destinatarioPreventivo(preventivo);
              return target.destinatarioId && target.destinatarioNome ? (
                <RiepilogoLink
                  tipo={target.destinatarioEntita}
                  id={target.destinatarioId}
                  nome={target.destinatarioNome}
                />
              ) : (
                <Text size="sm" fw={600}>
                  —
                </Text>
              );
            })()}
            {preventivo.clienteNome && preventivo.medicoNome && (
              <Text size="xs" c="dimmed">
                {preventivo.medicoNome}
              </Text>
            )}
          </Stack>
        ),
      },
      {
        accessor: "agenteNome",
        title: "Agente",
        sortable: true,
        render: (preventivo) => (
          <RiepilogoLink
            tipo="agente"
            id={preventivo.agenteId}
            nome={preventivo.agenteNome}
          />
        ),
      },
      {
        accessor: "prodotti",
        title: "Prodotti",
        sortable: true,
        render: (preventivo) => {
          const prodotti = prodottiPreventivo(preventivo);
          const testo = prodotti.join(", ");
          return testo ? (
            <Tooltip label={testo} withArrow multiline maw={360}>
              <Text size="sm" truncate>
                {testo}
              </Text>
            </Tooltip>
          ) : (
            "—"
          );
        },
      },
      {
        accessor: "linee",
        title: "Linea",
        sortable: true,
        textAlign: "center",
        width: 84,
        render: (preventivo) => <LineeOrdineBadge linee={preventivo.linee} />,
      },
      {
        accessor: "ordineStato",
        title: "Stato",
        sortable: true,
        textAlign: "center",
        width: 86,
        render: (preventivo) => (
          <StatoOrdineBadge stato={preventivo.ordineStato} />
        ),
      },
      {
        accessor: "totale",
        title: "Totale",
        sortable: true,
        textAlign: "right",
        width: 112,
        render: (preventivo) => (
          <Text fw={700} size="sm">
            € {centsToEurStr(preventivo.totale)}
          </Text>
        ),
      },
      {
        accessor: "acconto",
        title: "Acconto",
        sortable: true,
        textAlign: "right",
        width: 112,
        render: (preventivo) => (
          <Text size="sm" className="tabular">
            € {centsToEurStr(preventivo.acconto)}
          </Text>
        ),
      },
      {
        accessor: "email",
        title: "E-mail",
        sortable: true,
        render: (preventivo) =>
          preventivo.email ? (
            <Text size="sm" truncate>
              {preventivo.email}
            </Text>
          ) : (
            "—"
          ),
      },
      {
        accessor: "telefono",
        title: "Telefono",
        sortable: true,
        width: 142,
        render: (preventivo) => preventivo.telefono || "—",
      },
      {
        accessor: "spedizione",
        title: "Spedizione",
        sortable: true,
        render: (preventivo) =>
          cellaIndirizzoPreventivo(preventivo, "spedizione"),
      },
      {
        accessor: "fatturazione",
        title: "Fatturazione",
        sortable: true,
        render: (preventivo) =>
          cellaIndirizzoPreventivo(preventivo, "fatturazione"),
      },
      {
        accessor: "ultimoInvioMs",
        title: "Stato invio",
        sortable: true,
        width: 150,
        render: (preventivo) => {
          const statoInvio = statoInvioPreventivoDef(
            preventivo.indicazioneInvio,
          );
          const ultimoEvento =
            preventivo.ultimaModificaMs > preventivo.ultimoInvioMs
              ? `Ultima modifica: ${dataOra(preventivo.ultimaModificaMs)}`
              : preventivo.ultimoInvioMs
                ? `Ultimo invio: ${dataOra(preventivo.ultimoInvioMs)}${
                    preventivo.ultimoInvioCanale
                      ? ` · ${preventivo.ultimoInvioCanale}`
                      : ""
                  }`
                : preventivo.ultimaModificaMs
                  ? `Ultima modifica: ${dataOra(preventivo.ultimaModificaMs)}`
                  : "Nessuna attività registrata";
          const dettagli =
            preventivo.indicazioneInvio === "modificato_dopo_invio" &&
            preventivo.ultimoInvioMs
              ? `${ultimoEvento}. Inviato in precedenza il ${dataOra(
                  preventivo.ultimoInvioMs,
                )}${
                  preventivo.ultimoInvioCanale
                    ? ` via ${preventivo.ultimoInvioCanale}`
                    : ""
                }.`
              : ultimoEvento;
          return (
            <StatoInvioPreventivoBadge
              stato={preventivo.indicazioneInvio}
              tooltip={
                <Stack gap={1}>
                  <Text size="xs" fw={700} c="inherit">
                    {statoInvio.label}
                  </Text>
                  <Text size="xs" c="inherit">
                    {dettagli}
                  </Text>
                </Stack>
              }
            />
          );
        },
      },
      {
        accessor: "azioni",
        title: "",
        width: 42,
        textAlign: "center",
        render: (preventivo) => (
          <Menu position="bottom-end" withArrow>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Azioni ${preventivo.numeroPreventivo}`}
                onClick={(event) => {
                  event.stopPropagation();
                  origineMenuAzioniRef.current = catturaOrigineCestino(
                    event.currentTarget,
                  );
                }}
              >
                <IconDotsVertical size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
              {vociMenuPreventivo(
                preventivo,
                undefined,
                () => origineMenuAzioniRef.current,
              )}
            </Menu.Dropdown>
          </Menu>
        ),
      },
    ],
    [configDocumenti, identity, ordineFinestra],
  );
  const columns = useMemo(() => {
    const perChiave = new Map(
      tutteLeColumns.map((colonna) => [String(colonna.accessor), colonna]),
    );
    return [
      ...colonne.visibili
        .map((chiave) => perChiave.get(chiave))
        .filter((colonna): colonna is DataTableColumn<Preventivo> => !!colonna)
        .map((colonna) => ({ ...colonna, resizable: true })),
      perChiave.get("azioni")!,
    ];
  }, [colonne.visibili, tutteLeColumns]);
  const dominioColonne = useMemo<RigaDominioColonne[]>(
    () =>
      ordinati.map((preventivo) => ({
        stato: preventivo.ordineStato,
        linee: preventivo.linee,
        statoInvio: preventivo.indicazioneInvio,
      })),
    [ordinati],
  );

  const nFiltri =
    (linee.length > 0 ? 1 : 0) +
    (indicazioni.length > 0 ? 1 : 0) +
    (stati.length > 0 ? 1 : 0) +
    (agente ? 1 : 0) +
    (prodotti.length > 0 ? 1 : 0) +
    (creatoDal || creatoAl ? 1 : 0);
  const haFiltri = !!cerca.trim() || nFiltri > 0;

  return (
    <Pagina
      titolo="Preventivi"
      differita
      caricamento={caricamento}
      spazioDopoTitolo={8}
      azioni={
        <Group gap="xs" wrap="nowrap" justify="flex-end">
          <Tooltip
            label={
              classificazioneSolleciti.totale
                ? "Rivedi i preventivi da inviare o sollecitare"
                : "Nessun preventivo da inviare o sollecitare"
            }
          >
            <Button
              aria-label={
                classificazioneSolleciti.totale
                  ? `Solleciti, ${classificazioneSolleciti.totale} da gestire`
                  : "Solleciti"
              }
              variant="default"
              disabled={classificazioneSolleciti.totale === 0}
              leftSection={
                <Indicator
                  label={
                    classificazioneSolleciti.totale > 99
                      ? "99+"
                      : classificazioneSolleciti.totale
                  }
                  size={14}
                  offset={2}
                  color="red"
                  disabled={classificazioneSolleciti.totale === 0}
                >
                  <IconBell size={17} />
                </Indicator>
              }
              onClick={() => setSelettoreSollecitiOpened(true)}
            >
              Solleciti
            </Button>
          </Tooltip>
          <Button
            color="accent"
            leftSection={<IconPlus size={16} />}
            onClick={nuovoPreventivo}
          >
            Nuovo preventivo
          </Button>
        </Group>
      }
    >
      <Stack h="100%" gap="sm">
        <Group gap="sm" wrap="nowrap" align="flex-end">
          <DebouncedInput
            leftSection={<IconSearch size={16} />}
            placeholder="Cerca preventivo, cliente o lotto…"
            value={cerca}
            onChange={setCerca}
            style={{ flex: "0 1 230px", width: 230, maxWidth: "100%" }}
          />
          <FiltriPopover
            attivi={nFiltri}
            onAzzera={() => {
              setLinee([]);
              setIndicazioni([]);
              setStati([]);
              setAgente(null);
              setProdotti([]);
              setCreatoDal("");
              setCreatoAl("");
            }}
            width={320}
            filtri={[
              {
                chiave: "stato",
                larghezza: 210,
                nodo: (
                  <MultiSelect
                    label="Stato ordine"
                    placeholder={stati.length ? undefined : "Tutti gli stati"}
                    data={STATI_ORDINE.map((stato) => ({
                      value: stato.value,
                      label: stato.label,
                    }))}
                    value={stati}
                    onChange={setStati}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "linee",
                larghezza: 230,
                nodo: (
                  <MultiSelect
                    label="Linee"
                    placeholder={linee.length ? undefined : "Tutte le linee"}
                    data={["Immunoterapia", "Diagnostica", "Keriba"]}
                    value={linee}
                    onChange={setLinee}
                    clearable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "invio",
                larghezza: 260,
                nodo: (
                  <MultiSelect
                    label="Stato invio"
                    placeholder={indicazioni.length ? undefined : "Tutti"}
                    data={[
                      ...STATI_INVIO_PREVENTIVO.map(({ value, label }) => ({
                        value,
                        label,
                      })),
                    ]}
                    value={indicazioni}
                    onChange={setIndicazioni}
                    clearable
                    comboboxProps={{ withinPortal: false }}
                    renderOption={({ option }) => {
                      const definizione = statoInvioPreventivoDef(
                        option.value as
                          "mai_inviato" | "inviato" | "modificato_dopo_invio",
                      );
                      return (
                        <Group gap={8} wrap="nowrap">
                          <ThemeIcon
                            size={20}
                            radius="sm"
                            variant="light"
                            color={definizione.color}
                          >
                            <definizione.Ico size={13} />
                          </ThemeIcon>
                          <Text size="sm">{option.label}</Text>
                        </Group>
                      );
                    }}
                  />
                ),
              },
              {
                chiave: "agente",
                larghezza: 210,
                nodo: (
                  <Select
                    label="Agente"
                    placeholder="Tutti gli agenti"
                    data={agentiOpzioni}
                    value={agente}
                    onChange={setAgente}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "prodotti",
                larghezza: 240,
                nodo: (
                  <MultiSelect
                    label="Prodotti"
                    placeholder={prodotti.length ? undefined : "Tutti"}
                    data={prodottiOpzioni}
                    value={prodotti}
                    onChange={setProdotti}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "periodo",
                larghezza: 280,
                nodo: (
                  <FiltroIntervalloDate
                    dal={creatoDal}
                    al={creatoAl}
                    onDalChange={setCreatoDal}
                    onAlChange={setCreatoAl}
                    labelDal="Creato dal"
                  />
                ),
              },
            ]}
          />
          <ColonneMenu
            ordineKeys={colonne.ordineKeys}
            tutte={colonne.tutte}
            riordina={colonne.riordina}
            toggle={colonne.toggle}
            reset={colonne.reset}
          />
        </Group>
        <Box style={{ flex: 1, minHeight: 0 }}>
          <ColonneDominioProvider ordini={dominioColonne}>
            <Tabella<Preventivo>
              className="pt-preventivi-tabella"
              height="100%"
              idAccessor="id"
              records={ordinati}
              columns={columns}
              storeColumnsKey={STORE_LARGHEZZE_PREVENTIVI}
              memorizzaLarghezze
              minColumnWidths={{
                creatoMs: 52,
                linee: 56,
                ordineStato: 56,
              }}
              caricamentoIniziale={caricamento}
              sortStatus={sort}
              onSortStatusChange={setSort}
              onRowClick={({ record }) => void apriEditorPreventivo(record)}
              onRowContextMenu={({ record, event }) => {
                setContextMenu({
                  ...puntoDaEventoContextMenu(event),
                  record,
                });
              }}
              rowStyle={() => ({ cursor: "pointer" })}
              emptyState={
                caricamento ? (
                  <Box />
                ) : (
                  <Stack align="center" gap="xs" py={48}>
                    <ThemeIcon size={52} radius="xl" variant="light" color="yellow">
                      <IconFileInvoice size={26} />
                    </ThemeIcon>
                    <Text c="dimmed" size="sm">
                      {haFiltri
                        ? "Nessun preventivo per i filtri selezionati."
                        : "Nessun preventivo. Creane uno da un ordine Nuovo."}
                    </Text>
                  </Stack>
                )
              }
            />
          </ColonneDominioProvider>
        </Box>
      </Stack>

      <NuovoPreventivoModal
        opened={selettoreOpened}
        disponibili={disponibili}
        onClose={() => setSelettoreOpened(false)}
        onOrdinePreparato={(ordineId) => void continuaNuovoDaOrdine(ordineId)}
        onBozzaPreparata={(bozza) => void continuaNuovoDaZero(bozza)}
      />
      <SelettoreSollecitiPreventiviModal
        opened={selettoreSollecitiOpened}
        daInviare={classificazioneSolleciti.daInviare}
        daSollecitare={classificazioneSolleciti.daSollecitare}
        onClose={() => setSelettoreSollecitiOpened(false)}
        onConferma={(gruppo, selezionati) => {
          setSelettoreSollecitiOpened(false);
          window.setTimeout(
            () => void apriCampagnaSolleciti(gruppo, selezionati),
            190,
          );
        }}
      />

      <PreventivoEditorModal
        ordineId={ordineEditor}
        bozzaIniziale={bozzaEditor}
        opened={!!ordineEditor || !!bozzaEditor}
        onClose={() => {
          setOrdineEditor(null);
          setBozzaEditor(null);
        }}
        onSaved={(salvato) => {
          setPreventivi((correnti) => {
            const senza = correnti.filter((item) => item.id !== salvato.id);
            return [salvato, ...senza];
          });
          mostraAnteprima(salvato, undefined, true);
          void carica(true);
        }}
      />
      <DocumentoPreviewModal
        opened={!!anteprima}
        documento={anteprima}
        onClose={() => {
          setAnteprima(null);
          setPreventivoAnteprima(null);
          setAnteprimaDaModifica(false);
        }}
        azioniAffollate={anteprimaDaModifica}
        azioniExtra={
          preventivoAnteprima ? (
            <Group gap="sm">
              {anteprimaDaModifica && (
                <Button
                  variant="default"
                  leftSection={<IconEdit size={16} />}
                  onClick={() => {
                    const id = preventivoAnteprima.ordineId;
                    setAnteprima(null);
                    setPreventivoAnteprima(null);
                    setAnteprimaDaModifica(false);
                    setOrdineEditor(id);
                  }}
                >
                  Modifica preventivo
                </Button>
              )}
              <Button
                variant="default"
                leftSection={<IconSend size={16} />}
                loading={invioRapidoId === preventivoAnteprima.id}
                disabled={
                  !!anteprima?.overflow.length ||
                  (!!invioRapidoId && invioRapidoId !== preventivoAnteprima.id)
                }
                onClick={() => void inviaRapido(preventivoAnteprima)}
              >
                Invia preventivo
              </Button>
            </Group>
          ) : null
        }
      />
      {contextMenu && (
        <ContextMenuPuntuale
          punto={contextMenu}
          onClose={() => setContextMenu(null)}
        >
          {vociMenuPreventivo(contextMenu.record, () => setContextMenu(null), {
            x: contextMenu.x,
            y: contextMenu.y,
          })}
        </ContextMenuPuntuale>
      )}
    </Pagina>
  );
}
