// Giornaliero: lista ordini con filtri, badge stato, numero (provvisorio) e azioni.
// Tabella universale (mantine-datatable): resize colonne, sort cliccando l'header,
// header/filtri sempre visibili (solo il corpo scrolla).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconBan,
  IconCashBanknote,
  IconClipboardList,
  IconDotsVertical,
  IconFlagOff,
  IconGift,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconReceiptRefund,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { api, inTauri, type Identity, type OrdineDto, type Rimborso, type Spedizione } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { catturaOrigineCestino, volaNelCestino, type PuntoVoloCestino } from "../../ui/volaCestino";
import { usePrefs } from "../../lib/prefs";
import { useDeepLink } from "../../shell/navigazione";
import { Pagina } from "../../pages/Pagina";
import { Tabella, type DataTableColumn, type DataTableSortStatus } from "../../ui/Tabella";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { STATI_ORDINE, statoDef, isSpedito } from "./stati";
import { MARCATORI } from "./marcatori";
import { CATEGORIE_PRODOTTO } from "../anagrafiche/categorie";
import type { EditorTarget } from "./OrdineEditor";
import { NuovoOrdineMenu } from "./NuovoOrdineMenu";
import { SostituzioneModal } from "./SostituzioneModal";
import { rifiutaOrdine } from "./rifiuta";
import { PagamentoModal, type PagamentoModalTarget } from "../contabilita/PagamentoModal";
import { RimborsoModal, type RimborsoModalTarget } from "../contabilita/RimborsoModal";
import { mappaRimborsiExtra, statoRimborsoDef } from "../contabilita/statiRimborso";
import { apriFinestraOrdine } from "./apriFinestra";
import { COLONNE, ColonneDominioProvider, useColonneGiornaliero } from "./colonne";
import { ColonneMenu } from "./ColonneMenu";
import { EsportaTabella, colonneEsportabili } from "../../ui/esporta/EsportaTabella";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { riattivaNotifichePerUtenti, scarta } from "../notifiche/notifiche";
import { mappaLottiPerOrdine, opzioniLottiSpedizione } from "../spedizioni/filtriSpedizione";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import { PremiumPaywallModal } from "../../premium/PremiumAction";

const OrdineEditorLazy = lazy(() =>
  import("./OrdineEditor").then((m) => ({ default: m.OrdineEditor }))
);
const SchedaClienteModalLazy = lazy(() =>
  import("../preventivi/SchedaClienteModal").then((m) => ({
    default: m.SchedaClienteModal,
  }))
);

const GETTER_SORT: Record<string, (o: OrdineDto) => string | number> = {
  numero: (o) => o.numero,
  ...Object.fromEntries(COLONNE.filter((c) => c.sortAccessor).map((c) => [c.key, c.sortAccessor!])),
};

const EVENTI_RICARICA = [
  "ordine:salvato",
  "pagamento:salvato",
  "rimborso:salvato",
  "spedizione:salvato",
  "cliente:salvato",
  "medico:salvato",
  "agente:salvato",
  "prodotto:salvato",
] as const;

export function GiornalieroView({ identity }: { identity: Identity }) {
  const [ordini, setOrdini] = useState<OrdineDto[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [cerca, setCerca] = useState("");

  const [filtroStati, setFiltroStati] = useState<string[]>([]);
  const [filtroLinee, setFiltroLinee] = useState<string[]>([]);
  const [filtroSpedito, setFiltroSpedito] = useState<"tutti" | "spediti" | "non">("tutti");
  const [filtroSpedizioni, setFiltroSpedizioni] = useState<string[]>([]);
  const [filtroMarcatori, setFiltroMarcatori] = useState<string[]>([]);
  const [filtroCritici, setFiltroCritici] = useState(false);
  const [filtroMedici, setFiltroMedici] = useState<string[]>([]);
  // Filtri regione/agente/periodo: controlli reali nel popover, popolati anche dal
  // deep-link della dashboard (regione/agente/dal-al).
  const [filtroRegione, setFiltroRegione] = useState<string | null>(null);
  const [filtroAgente, setFiltroAgente] = useState<string | null>(null);
  const [filtroDal, setFiltroDal] = useState("");
  const [filtroAl, setFiltroAl] = useState("");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editorCaricato, setEditorCaricato] = useState(false);
  const [sostituzione, setSostituzione] = useState<OrdineDto | null>(null);
  const [salda, setSalda] = useState<PagamentoModalTarget | null>(null);
  const [rimborsoExtra, setRimborsoExtra] = useState<RimborsoModalTarget | null>(null);
  // Rimborsi "extra" già esistenti per ordine: per non rigenerarli e mostrarne lo stato.
  const [rimborsiExtra, setRimborsiExtra] = useState<Map<string, Rimborso>>(new Map());
  const [spedizioni, setSpedizioni] = useState<Spedizione[]>([]);
  // Default: dal più recente al meno recente (per data). L'utente può ri-ordinare cliccando.
  const [sort, setSort] = useState<DataTableSortStatus<OrdineDto>>({ columnAccessor: "data", direction: "desc" });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; record: OrdineDto } | null>(null);
  const origineMenuAzioniRef = useRef<PuntoVoloCestino | null>(null);
  const [schedaCliente, setSchedaCliente] = useState<{ id: string; numero: string } | null>(null);
  const [paywallScheda, setPaywallScheda] = useState(false);
  const { ordineFinestra, anno } = usePrefs();
  const premium = usePremiumAccess();
  const colonne = useColonneGiornaliero();
  useCloseOnScroll(!!contextMenu, (v) => {
    if (!v) setContextMenu(null);
  });

  // Deep-link da Spotlight/Dashboard: prefilla ricerca e filtri (stato/regione/agente/periodo).
  const { link: deepLink, consuma } = useDeepLink("/giornaliero");
  useEffect(() => {
    if (!deepLink) return;
    if (deepLink.cerca !== undefined) setCerca(deepLink.cerca);
    if (deepLink.stati) setFiltroStati(deepLink.stati);
    if (deepLink.spedito) setFiltroSpedito(deepLink.spedito);
    setFiltroSpedizioni(deepLink.spedizioneLotti ?? []);
    if (deepLink.marcatori) setFiltroMarcatori(deepLink.marcatori);
    setFiltroCritici(deepLink.critici === true);
    setFiltroRegione(deepLink.regione ?? null);
    setFiltroAgente(deepLink.agente ?? null);
    setFiltroDal(deepLink.dal ?? "");
    setFiltroAl(deepLink.al ?? "");
    consuma();
  }, [deepLink, consuma]);

  async function carica() {
    try {
      const [o, rimb, sped] = await Promise.all([
        api.ordiniLista(),
        api.rimborsiLista(),
        api.spedizioniLista(),
      ]);
      setOrdini(o);
      setRimborsiExtra(mappaRimborsiExtra(rimb));
      setSpedizioni(sped);
    } catch (e) {
      toast.error(`Caricamento non riuscito: ${e}`);
    } finally {
      setCaricamento(false);
    }
  }

  async function apri(ordineId: string | null, numero?: string, categoria?: string) {
    // Default: nuovo ordine → modale (veloce); apertura/modifica → finestra.
    const usaFinestra = ordineFinestra === "sempre" || (ordineFinestra === "modifica" && ordineId !== null);
    if (usaFinestra && (await apriFinestraOrdine(ordineId, numero, identity, categoria))) return;
    setEditorCaricato(true);
    setEditor({ ordineId, numero, categoria });
  }

  function apriSchedaCliente(o: Pick<OrdineDto, "id" | "numero">) {
    if (!premium.enabled) {
      setPaywallScheda(true);
      return;
    }
    setSchedaCliente({ id: o.id, numero: o.numero });
  }

  useEffect(() => {
    carica();
    const iv = setInterval(carica, 8000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRicaricaSuEventi(EVENTI_RICARICA, carica);

  // Conferma eliminazione con la via d'uscita "rifiuta invece": un ordine non andato a
  // buon fine spesso va contrassegnato Rifiutato, non cancellato. Eliminare = "annullare"
  // (Cestino, ripristinabile); l'ordine annullato sparisce da ogni vista.
  async function elimina(o: OrdineDto, origine?: PuntoVoloCestino) {
    const haPreventivo = premium.enabled
      ? await api
          .preventivoGet(o.id)
          .then((preventivo) => preventivo.esiste)
          .catch(() => false)
      : false;
    const scelta = await dialog.open<"annulla" | "rifiuta" | "elimina">({
      tipo: "warning",
      titolo: `Eliminare l'ordine ${o.numero}?`,
      contenuto:
        `Verrà annullato e spostato nel Cestino (ripristinabile).${
          haPreventivo
            ? " Anche il preventivo collegato verrà spostato e sarà ripristinato insieme all’ordine."
            : ""
        } ` +
        "Se invece il cliente ha rifiutato, contrassegnalo come rifiutato: resterà consultabile.",
      valoreAnnulla: "annulla",
      bottoni: [
        { label: "Annulla", variante: "secondario", value: "annulla" },
        ...(o.stato !== "Rifiutato"
          ? [{ label: "Contrassegna come rifiutato, invece", variante: "primario" as const, value: "rifiuta" as const }]
          : []),
        { label: "Sposta nel Cestino", variante: "pericolo", value: "elimina" },
      ],
    });
    if (scelta === "rifiuta") {
      if (await rifiutaOrdine(o)) carica();
      return;
    }
    if (scelta !== "elimina") return;
    setOrdini((os) => os.filter((x) => x.id !== o.id)); // ottimistico: sparisce subito
    try {
      await api.recordDelete("ordine", o.id);
      // Il toast coprirebbe l'animazione «vola nel cestino»: se l'animazione parte
      // (icona presente + animazioni attive) è già esplicativa, niente toast.
      if (!volaNelCestino(origine)) toast.success("Ordine annullato (nel Cestino).");
      carica();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
      carica();
    }
  }

  // Ripristina un ordine rifiutato dal Giornaliero (→ Nuovo/Confermato secondo l'acconto).
  async function ripristina(o: OrdineDto) {
    try {
      const nuovo = await api.ordineRipristina(o.id);
      toast.success(`Ordine ${o.numero} ripristinato (${nuovo}).`);
      carica();
    } catch (e) {
      toast.error(`Ripristino non riuscito: ${e}`);
    }
  }

  // Imposta/azzera la segnalazione (urgente/anomalia) di un ordine dal menu ⋯.
  async function segna(o: OrdineDto, marcatore: string) {
    setOrdini((os) => os.map((x) => (x.id === o.id ? { ...x, marcatore } : x))); // ottimistico
    const notificaId = `marcatore:${o.id}`;
    if (marcatore) {
      await scarta(notificaId, identity).catch(() => {});
    }
    try {
      await api.recordUpdate("ordine", o.id, {
        marcatore,
        marcatore_origine_device: marcatore ? identity.deviceId : "",
      });
      if (marcatore) {
        const altriUtenti = await api
          .getUsers()
          .then((users) => users.map((u) => u.id).filter((id) => id && id !== identity.userId))
          .catch(() => []);
        if (altriUtenti.length > 0) {
          await riattivaNotifichePerUtenti([notificaId], altriUtenti).catch(() => {});
        }
      }
      if (inTauri) void api.notificheCheck().catch(() => {});
    } catch (e) {
      toast.error(`Aggiornamento non riuscito: ${e}`);
      carica();
    }
  }

  const ordiniConBlob = useMemo(() => {
    return ordini.map((o) => ({
      ...o,
      _searchBlob: [
        o.numero,
        o.clienteNome,
        o.medicoNome,
        o.clienteCitta,
        o.clienteTelefono,
        o.clienteTelefono?.replace(/\D/g, ""),
        ...(o.numeriLotto ?? []),
      ]
        .join(" ")
        .toLowerCase(),
    }));
  }, [ordini]);

  const lottiPerOrdine = useMemo(() => mappaLottiPerOrdine(spedizioni), [spedizioni]);
  const spedizioniSet = useMemo(() => new Set(filtroSpedizioni), [filtroSpedizioni]);
  const spedizioniOpzioni = useMemo(
    () => opzioniLottiSpedizione(spedizioni, anno),
    [spedizioni, anno]
  );

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    const periodoAttivo = !!(filtroDal || filtroAl);
    return ordiniConBlob.filter((o) => {
      // Periodo: l'intervallo dal/al (impostato a mano o da deep-link) prevale sul
      // filtro anno della sidebar.
      if (periodoAttivo) {
        if (filtroDal && o.data < filtroDal) return false;
        if (filtroAl && o.data > filtroAl) return false;
      } else if (anno !== 0 && Number(o.data.slice(0, 4)) !== anno) {
        return false;
      }
      if (filtroStati.length > 0 && !filtroStati.includes(o.stato)) return false;
      // Linea: l'ordine compare se ha almeno una riga di una linea selezionata.
      if (filtroLinee.length > 0 && !o.linee.some((l) => filtroLinee.includes(l))) return false;
      if (
        spedizioniSet.size > 0 &&
        ![...(lottiPerOrdine.get(o.id) ?? [])].some((lotto) => spedizioniSet.has(lotto))
      ) return false;
      if (filtroSpedito === "spediti" && !isSpedito(o.stato)) return false;
      if (filtroSpedito === "non" && isSpedito(o.stato)) return false;
      if (
        filtroCritici &&
        o.marcatore !== "urgente" &&
        o.marcatore !== "anomalia" &&
        o.marcatore !== "sollecito" &&
        o.statoPagamento !== "da_controllare" &&
        o.statoPagamento !== "saldato_da_verificare"
      ) {
        return false;
      }
      if (filtroMarcatori.length > 0 && !filtroMarcatori.includes(o.marcatore)) return false;
      if (filtroMedici.length > 0 && !filtroMedici.includes(o.medicoNome ?? "")) return false;
      if (filtroAgente && o.agenteNome !== filtroAgente) return false;
      if (filtroRegione && (o.clienteRegione || "Altre zone") !== filtroRegione) return false;
      if (!q) return true;
      return o._searchBlob.includes(q);
    });
  }, [ordiniConBlob, cerca, filtroStati, filtroLinee, filtroSpedito, spedizioniSet, lottiPerOrdine, filtroCritici, filtroMarcatori, filtroMedici, filtroAgente, filtroRegione, filtroDal, filtroAl, anno]);

  // Opzioni regione/agente derivate dagli ordini caricati (niente fetch extra).
  const regioniOpz = useMemo(() => {
    const set = new Set<string>();
    ordini.forEach((o) => set.add(o.clienteRegione || "Altre zone"));
    return [...set].sort((a, b) => a.localeCompare(b, "it"));
  }, [ordini]);
  const agentiOpz = useMemo(() => {
    const set = new Set<string>();
    ordini.forEach((o) => o.agenteNome && set.add(o.agenteNome));
    return [...set].sort((a, b) => a.localeCompare(b, "it"));
  }, [ordini]);

  const mediciOpz = useMemo(() => {
    const set = new Set<string>();
    ordini.forEach((o) => o.medicoNome && set.add(o.medicoNome));
    return [...set].sort((a, b) => a.localeCompare(b, "it"));
  }, [ordini]);

  const ordinati = useMemo(() => {
    const getter = GETTER_SORT[sort.columnAccessor as string];
    if (!getter) return filtrati;
    const arr = [...filtrati];
    arr.sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      let cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "it", { numeric: true });
      if (cmp === 0) {
        cmp = a.numero.localeCompare(b.numero, "it", { numeric: true });
      }
      return sort.direction === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [filtrati, sort]);

  const columns = useMemo<DataTableColumn<OrdineDto>[]>(() => {
    // N° con badge prov./omaggio (gli altri usano il render base).
    const renderNumero = (o: OrdineDto) => (
      <Stack gap={2} align="flex-start">
        {o.omaggio && (
          <Tooltip label="Omaggio / sostituzione (escluso dalle provvigioni)" withArrow>
            <Badge size="xs" color="grape" variant="light" leftSection={<IconGift size={10} />}>
              omaggio
            </Badge>
          </Tooltip>
        )}
        <Group gap={6} wrap="nowrap">
          <Text fw={600} className="tabular">
            {o.numero}
          </Text>
          {o.provvisorio && (
            <Tooltip label="Numero provvisorio (creato offline)" withArrow>
              <Badge size="xs" color="yellow" variant="light">
                prov.
              </Badge>
            </Tooltip>
          )}
        </Group>
      </Stack>
    );

    const dati: DataTableColumn<OrdineDto>[] = colonne.visibili.map((c) => ({
      accessor: c.key,
      title: c.label,
      textAlign: c.align === "right" ? "right" : c.align === "center" ? "center" : "left",
      sortable: !!c.sortAccessor,
      resizable: true,
      width: c.width,
      render: (o: OrdineDto) => (c.key === "numero" ? renderNumero(o) : c.render(o)),
    }));

    const azioni: DataTableColumn<OrdineDto> = {
      accessor: "azioni",
      title: "",
      width: 36,
      textAlign: "center",
      render: (o) => (
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={(e) => {
                e.stopPropagation();
                origineMenuAzioniRef.current = catturaOrigineCestino(
                  e.currentTarget,
                );
              }}
            >
              <IconDotsVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          {/* stopPropagation: i click delle voci, anche se il dropdown è in un portal,
              risalgono per l'albero React fino all'`onRowClick` della riga (aprirebbe
              l'ordine). Lo fermiamo qui, una volta per tutto il menu. */}
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => apri(o.id, o.numero)}>
              Apri / modifica
            </Menu.Item>
            <Menu.Item leftSection={<IconPrinter size={15} />} onClick={() => apriSchedaCliente(o)}>
              Stampa scheda cliente
            </Menu.Item>
            <Menu.Item
              leftSection={<IconCashBanknote size={15} />}
              onClick={async () => {
                try {
                  const pagamenti = await api.pagamentiOrdine(o.id);
                  const prossimo = pagamenti
                    .filter((p) => !p.saldato && (p.tipo === "acconto" || p.tipo === "saldo" || p.tipo === "rata"))
                    .sort((a, b) => {
                      const prioritaA = a.tipo === "acconto" ? 0 : 1;
                      const prioritaB = b.tipo === "acconto" ? 0 : 1;
                      return prioritaA - prioritaB ||
                        (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31") ||
                        a.id.localeCompare(b.id);
                    })[0];
                  setSalda(
                    prossimo
                      ? { pagamento: prossimo, saldaSubito: true }
                      : {
                          nuovo: {
                            ordineId: o.id,
                            numero: o.numero,
                            tipo: "saldo",
                            importo: o.residuo > 0 ? o.residuo : 0,
                            saldato: true,
                          },
                        }
                  );
                } catch (e) {
                  toast.error(`Apertura pagamento non riuscita: ${e}`);
                }
              }}
            >
              Registra pagamento
            </Menu.Item>
            {(() => {
              const esistente = rimborsiExtra.get(o.id);
              if (o.residuo >= 0 && !esistente) return null;
              return (
                <Menu.Item
                  leftSection={<IconReceiptRefund size={15} />}
                  onClick={() =>
                    setRimborsoExtra(
                      esistente
                        ? { rimborso: esistente }
                        : { nuovoExtra: { ordineId: o.id, numero: o.numero } }
                    )
                  }
                >
                  {esistente ? `Rimborso ${statoRimborsoDef(esistente.stato).label.toLowerCase()}` : "Rimborsa extra"}
                </Menu.Item>
              );
            })()}
            <Menu.Item leftSection={<IconGift size={15} />} onClick={() => setSostituzione(o)}>
              Sostituzione prodotto
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Segnalazione</Menu.Label>
            {MARCATORI.map((m) => (
              <Menu.Item
                key={m.value}
                leftSection={<m.Ico size={15} color={`var(--mantine-color-${m.color}-6)`} />}
                disabled={o.marcatore === m.value}
                onClick={() => segna(o, m.value)}
              >
                Segna come {m.label.toLowerCase()}
              </Menu.Item>
            ))}
            {o.marcatore && (
              <Menu.Item leftSection={<IconFlagOff size={15} />} onClick={() => segna(o, "")}>
                Togli segnalazione
              </Menu.Item>
            )}
            <Menu.Divider />
            {o.stato === "Rifiutato" ? (
              <Menu.Item
                color="teal"
                leftSection={<IconArrowBackUp size={15} />}
                onClick={() => ripristina(o)}
              >
                Ripristina ordine
              </Menu.Item>
            ) : (
              <Menu.Item
                color="orange"
                leftSection={<IconBan size={15} />}
                onClick={async () => {
                  if (await rifiutaOrdine(o)) carica();
                }}
              >
                Rifiuta ordine
              </Menu.Item>
            )}
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={15} />}
              onClick={(e) =>
                elimina(
                  o,
                  origineMenuAzioniRef.current ?? catturaOrigineCestino(e),
                )
              }
            >
              Elimina
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ),
    };

    return [...dati, azioni];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colonne.visibili, ordineFinestra, premium.enabled, rimborsiExtra]);
  // Numero di filtri attivi nel popover (la ricerca resta inline, non conta qui).
  const nFiltri =
    (filtroStati.length > 0 ? 1 : 0) +
    (filtroLinee.length > 0 ? 1 : 0) +
    (filtroMarcatori.length > 0 ? 1 : 0) +
    (filtroCritici ? 1 : 0) +
    (filtroMedici.length > 0 ? 1 : 0) +
    (filtroSpedito !== "tutti" ? 1 : 0) +
    (filtroSpedizioni.length > 0 ? 1 : 0) +
    (filtroRegione ? 1 : 0) +
    (filtroAgente ? 1 : 0) +
    (filtroDal || filtroAl ? 1 : 0);

  function azzeraFiltri() {
    setFiltroStati([]);
    setFiltroLinee([]);
    setFiltroMarcatori([]);
    setFiltroCritici(false);
    setFiltroMedici([]);
    setFiltroSpedito("tutti");
    setFiltroSpedizioni([]);
    setFiltroRegione(null);
    setFiltroAgente(null);
    setFiltroDal("");
    setFiltroAl("");
  }

  const haFiltri = !!cerca || nFiltri > 0;

  // Colonne esportabili: pre-spuntate = quelle visibili; ordine = quello configurato.
  const colonneExport = useMemo(
    () => colonneEsportabili(colonne.tutte.map((v) => v.def), new Set(colonne.visibili.map((c) => c.key))),
    [colonne.tutte, colonne.visibili]
  );

  return (
    <Pagina
      titolo="Giornaliero"
      differita
      caricamento={caricamento}
      azioni={<NuovoOrdineMenu onNuovo={(categoria) => apri(null, undefined, categoria)} />}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group gap="sm" wrap="nowrap" align="flex-end">
          <DebouncedInput
            placeholder="Cerca numero, cliente, medico, telefono o lotto…"
            leftSection={<IconSearch size={16} />}
            value={cerca}
            onChange={setCerca}
            style={{ flex: "1 1 200px", maxWidth: 300 }}
          />
          <FiltriPopover
            attivi={nFiltri}
            onAzzera={azzeraFiltri}
            width={320}
            filtri={[
              {
                chiave: "stato",
                larghezza: 190,
                nodo: (
                  <MultiSelect
                    label="Stato"
                    placeholder={filtroStati.length === 0 ? "Tutti gli stati" : undefined}
                    data={STATI_ORDINE.map((s) => ({ value: s.value, label: s.label }))}
                    value={filtroStati}
                    onChange={setFiltroStati}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                    renderOption={({ option }) => {
                      const d = statoDef(option.value);
                      return (
                        <Group gap={8} wrap="nowrap">
                          <ThemeIcon size={20} radius="sm" variant="light" color={d.color}>
                            <d.Ico size={13} />
                          </ThemeIcon>
                          <Text size="sm">{option.label}</Text>
                        </Group>
                      );
                    }}
                  />
                ),
              },
              {
                chiave: "linee",
                larghezza: 180,
                nodo: (
                  <MultiSelect
                    label="Linee"
                    placeholder={filtroLinee.length === 0 ? "Tutte le linee" : undefined}
                    data={CATEGORIE_PRODOTTO}
                    value={filtroLinee}
                    onChange={setFiltroLinee}
                    clearable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "segnalazioni",
                larghezza: 170,
                nodo: (
                  <MultiSelect
                    label="Segnalazioni"
                    placeholder={filtroMarcatori.length === 0 ? "Tutte" : undefined}
                    data={MARCATORI.map((m) => ({ value: m.value, label: m.label }))}
                    value={filtroMarcatori}
                    onChange={setFiltroMarcatori}
                    clearable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "spedizioni",
                larghezza: 260,
                nodo: (
                  <MultiSelect
                    label="Spedizioni"
                    placeholder={filtroSpedizioni.length ? "" : "Tutte"}
                    data={spedizioniOpzioni}
                    value={filtroSpedizioni}
                    onChange={setFiltroSpedizioni}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "spedito",
                larghezza: 240,
                nodo: (
                  <Box>
                    <Text size="sm" fw={500} mb={4}>
                      Stato spedizione
                    </Text>
                    <SegmentedControl
                      fullWidth
                      value={filtroSpedito}
                      onChange={(v) => setFiltroSpedito(v as "tutti" | "spediti" | "non")}
                      data={[
                        { value: "tutti", label: "Tutti" },
                        { value: "spediti", label: "Spediti" },
                        { value: "non", label: "Non spediti" },
                      ]}
                    />
                  </Box>
                ),
              },
              {
                chiave: "agente",
                larghezza: 180,
                nodo: (
                  <Select
                    label="Agente"
                    placeholder="Tutti gli agenti"
                    data={agentiOpz}
                    value={filtroAgente}
                    onChange={setFiltroAgente}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "medici",
                larghezza: 180,
                nodo: (
                  <MultiSelect
                    label="Medici"
                    placeholder="Tutti i medici"
                    data={mediciOpz}
                    value={filtroMedici}
                    onChange={setFiltroMedici}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "regione",
                larghezza: 180,
                nodo: (
                  <Select
                    label="Regione"
                    placeholder="Tutte le regioni"
                    data={regioniOpz}
                    value={filtroRegione}
                    onChange={setFiltroRegione}
                    clearable
                    searchable
                    comboboxProps={{ withinPortal: false }}
                  />
                ),
              },
              {
                chiave: "periodo",
                larghezza: 260,
                nodo: (
                  <Group grow gap="sm">
                    <TextInput label="Dal" type="date" value={filtroDal} onChange={(e) => setFiltroDal(e.currentTarget.value)} />
                    <TextInput label="Al" type="date" value={filtroAl} onChange={(e) => setFiltroAl(e.currentTarget.value)} />
                  </Group>
                ),
              },
            ]}
          />
          <Group gap="xs" wrap="nowrap">
            <EsportaTabella nomeBase="giornaliero" foglio="Giornaliero" titolo="Giornaliero ordini" colonne={colonneExport} righe={ordinati} />
            <ColonneMenu
              ordineKeys={colonne.ordineKeys}
              tutte={colonne.tutte}
              riordina={colonne.riordina}
              toggle={colonne.toggle}
              reset={colonne.reset}
            />
          </Group>
        </Group>

        <Box style={{ flex: 1, minHeight: 0 }}>
          <ColonneDominioProvider ordini={ordinati}>
          <Tabella<OrdineDto>
            height="100%"
            columns={columns}
            records={ordinati}
            caricamentoIniziale={caricamento}
            ridimensionamentoSenzaSfumaturaKey={cerca}
            idAccessor="id"
            storeColumnsKey="giornaliero-v5"
            memorizzaLarghezze
            minColumnWidths={{ data: 52, stato: 56, linea: 56, statoPagamento: 58 }}
            sortStatus={sort}
            onSortStatusChange={setSort}
            onRowClick={({ record }) => apri(record.id, record.numero)}
            onRowContextMenu={({ record, event }) => {
              event.preventDefault();
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                record,
              });
            }}
            rowStyle={() => ({ cursor: "pointer" })}
            emptyState={
              caricamento ? (
                <Box />
              ) : (
                <Stack align="center" gap="xs" py={40}>
                  <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                    <IconClipboardList size={24} />
                  </ThemeIcon>
                  <Text c="dimmed" size="sm">
                    {haFiltri ? "Nessun ordine per i filtri." : "Nessun ordine. Registra il primo."}
                  </Text>
                  {!haFiltri && (
                    <Button variant="light" color="accent" leftSection={<IconPlus size={16} />} onClick={() => apri(null, undefined, "Immunoterapia")}>
                      Nuovo ordine
                    </Button>
                  )}
                </Stack>
              )
            }
          />
          </ColonneDominioProvider>
        </Box>
      </Stack>

      {editorCaricato && (
        <Suspense fallback={null}>
          <OrdineEditorLazy
            editor={editor}
            identity={identity}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null);
              carica();
            }}
          />
        </Suspense>
      )}

      <SostituzioneModal
        ordine={sostituzione}
        onClose={() => setSostituzione(null)}
        onCreato={() => {
          setSostituzione(null);
          carica();
        }}
      />

      <PagamentoModal
        target={salda}
        onClose={() => setSalda(null)}
        onChanged={() => {
          setSalda(null);
          carica();
        }}
      />

      <RimborsoModal
        target={rimborsoExtra}
        onClose={() => setRimborsoExtra(null)}
        onChanged={() => {
          setRimborsoExtra(null);
          carica();
        }}
      />

      {premium.enabled && schedaCliente && (
        <Suspense fallback={null}>
          <SchedaClienteModalLazy
            ordineId={schedaCliente.id}
            ordineNumero={schedaCliente.numero}
            opened
            onClose={() => setSchedaCliente(null)}
          />
        </Suspense>
      )}

      <PremiumPaywallModal
        opened={paywallScheda}
        onClose={() => setPaywallScheda(false)}
        title="Stampa scheda cliente"
        message="La compilazione, l’anteprima e la stampa della scheda cliente richiedono un pagamento aggiuntivo."
      />

      {contextMenu && (
        <Menu
          opened={!!contextMenu}
          onClose={() => setContextMenu(null)}
          position="bottom-start"
          offset={0}
        >
          <Menu.Target>
            <div
              style={{
                position: "fixed",
                left: contextMenu.x,
                top: contextMenu.y,
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
          </Menu.Target>
          <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
            <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => { apri(contextMenu.record.id, contextMenu.record.numero); setContextMenu(null); }}>
              Apri / modifica
            </Menu.Item>
            <Menu.Item
              leftSection={<IconPrinter size={15} />}
              onClick={() => {
                apriSchedaCliente(contextMenu.record);
                setContextMenu(null);
              }}
            >
              Stampa scheda cliente
            </Menu.Item>
            <Menu.Item
              leftSection={<IconCashBanknote size={15} />}
              onClick={async () => {
                try {
                  const pagamenti = await api.pagamentiOrdine(contextMenu.record.id);
                  const prossimo = pagamenti
                    .filter((p) => !p.saldato && (p.tipo === "acconto" || p.tipo === "saldo" || p.tipo === "rata"))
                    .sort((a, b) => {
                      const prioritaA = a.tipo === "acconto" ? 0 : 1;
                      const prioritaB = b.tipo === "acconto" ? 0 : 1;
                      return prioritaA - prioritaB ||
                        (a.scadenza || "9999-12-31").localeCompare(b.scadenza || "9999-12-31") ||
                        a.id.localeCompare(b.id);
                    })[0];
                  setSalda(
                    prossimo
                      ? { pagamento: prossimo, saldaSubito: true }
                      : {
                          nuovo: {
                            ordineId: contextMenu.record.id,
                            numero: contextMenu.record.numero,
                            tipo: "saldo",
                            importo: contextMenu.record.residuo > 0 ? contextMenu.record.residuo : 0,
                            saldato: true,
                          },
                        }
                  );
                } catch (e) {
                  toast.error(`Apertura pagamento non riuscita: ${e}`);
                }
                setContextMenu(null);
              }}
            >
              Registra pagamento
            </Menu.Item>
            {(() => {
              const esistente = rimborsiExtra.get(contextMenu.record.id);
              if (contextMenu.record.residuo >= 0 && !esistente) return null;
              return (
                <Menu.Item
                  leftSection={<IconReceiptRefund size={15} />}
                  onClick={() => {
                    setRimborsoExtra(
                      esistente
                        ? { rimborso: esistente }
                        : { nuovoExtra: { ordineId: contextMenu.record.id, numero: contextMenu.record.numero } }
                    );
                    setContextMenu(null);
                  }}
                >
                  {esistente ? `Rimborso ${statoRimborsoDef(esistente.stato).label.toLowerCase()}` : "Rimborsa extra"}
                </Menu.Item>
              );
            })()}
            <Menu.Item
              leftSection={<IconGift size={15} />}
              onClick={() => {
                setSostituzione(contextMenu.record);
                setContextMenu(null);
              }}
            >
              Sostituzione prodotto
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Segnalazione</Menu.Label>
            {MARCATORI.map((m) => (
              <Menu.Item
                key={m.value}
                leftSection={<m.Ico size={15} color={`var(--mantine-color-${m.color}-6)`} />}
                disabled={contextMenu.record.marcatore === m.value}
                onClick={() => {
                  segna(contextMenu.record, m.value);
                  setContextMenu(null);
                }}
              >
                Segna come {m.label.toLowerCase()}
              </Menu.Item>
            ))}
            {contextMenu.record.marcatore && (
              <Menu.Item
                leftSection={<IconFlagOff size={15} />}
                onClick={() => {
                  segna(contextMenu.record, "");
                  setContextMenu(null);
                }}
              >
                Togli segnalazione
              </Menu.Item>
            )}
            <Menu.Divider />
            {contextMenu.record.stato === "Rifiutato" ? (
              <Menu.Item
                color="teal"
                leftSection={<IconArrowBackUp size={15} />}
                onClick={() => {
                  ripristina(contextMenu.record);
                  setContextMenu(null);
                }}
              >
                Ripristina ordine
              </Menu.Item>
            ) : (
              <Menu.Item
                color="orange"
                leftSection={<IconBan size={15} />}
                onClick={async () => {
                  const rec = contextMenu.record;
                  setContextMenu(null);
                  if (await rifiutaOrdine(rec)) carica();
                }}
              >
                Rifiuta ordine
              </Menu.Item>
            )}
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={15} />}
              onClick={() => {
                const { record, x, y } = contextMenu;
                setContextMenu(null);
                elimina(record, { x, y });
              }}
            >
              Elimina
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </Pagina>
  );
}
