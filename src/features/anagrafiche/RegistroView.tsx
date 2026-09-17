// Vista generica di un registro anagrafico: tabella + form (modale) di CRUD.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Menu,
  MultiSelect,
  Stack,
  Switch,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconHistory,
  IconMessage,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import { api, type RecordDto } from "../../lib/tauri";
import type { OrdineDto } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { Tabella, type DataTableColumn, type DataTableSortStatus } from "../../ui/Tabella";
import { FiltriPopover } from "../../ui/FiltriPopover";
import { StoricoModal } from "../../ui/StoricoModal";
import {
  catturaOrigineCestino,
  volaNelCestino,
  type PuntoVoloCestino,
} from "../../ui/volaCestino";
import { DebouncedInput } from "../../ui/DebouncedInput";
import {
  REGISTRI,
  centsToEurStr,
  type Colonna,
  type ColonnaCtx,
  type Opzione,
  type Registro,
} from "./registri";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { dur, durataSwitchTabelleMs, useAnimazioniRidotte } from "../../ui/motion";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { canRunPremiumAction } from "../../premium/PremiumAction";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import { apriComunicazione, variabiliNomeDestinatario } from "../comunicazioni/apriComunicazione";
import { AnagraficaEditorModal } from "./AnagraficaEditorModal";
import { ContextMenuPuntuale, puntoDaEventoContextMenu } from "../../ui/ContextMenuTarget";
import { MenuAzioniRiga } from "../../ui/MenuAzioniRiga";

const ORDINE_CATEGORIE: Record<string, number> = {
  "immunoterapia": 1,
  "keriba": 2,
  "diagnostica": 3,
};

function getCategoriaPriorita(cat: unknown): number {
  const s = String(cat ?? "").toLowerCase();
  return ORDINE_CATEGORIE[s] ?? 99;
}

// Cache dei record per entità (modulo): switchando registro si mostrano subito i
// dati già visti (niente flash "nessuna anagrafica"); in sottofondo si aggiorna.
const cacheRecords = new Map<string, RecordDto[]>();
const CLIENTI_TUTTI_STORAGE = "pt.anagrafiche.clienti.mostraTutti";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function RegistroView({
  registro,
  attiva = true,
  bloccato,
  nonEliminabile,
  campiDisabilitati,
  azioneExtra,
  intestazione,
  modalExtra,
  modalSize,
  bloccaChiusura,
  apriRecordId,
  apriRecordNonce = 0,
}: {
  registro: Registro;
  attiva?: boolean;
  /** Record di sola lettura: niente menu ⋯, niente modifica/storico (es. conti built-in). */
  bloccato?: (r: RecordDto) => boolean;
  /** Record modificabili ma non eliminabili (es. corrieri built-in): nasconde solo "Elimina". */
  nonEliminabile?: (r: RecordDto) => boolean;
  /** Campi (key) da disabilitare nel form per il record in modifica (null = nuovo record). */
  campiDisabilitati?: (rec: RecordDto | null) => string[];
  /** Azione extra nell'intestazione, accanto a "Nuovo" (es. ⚙️ Preferenze conti). */
  azioneExtra?: ReactNode;
  /** Contenuto extra sopra la tabella (es. card "Prova prezzo" nei Prodotti). */
  intestazione?: ReactNode;
  /** Contenuto extra dentro il modale, dopo i campi (es. regole di prezzo del prodotto). */
  modalExtra?: (rec: RecordDto | null) => ReactNode;
  /** Dimensione del modale (default "lg"). */
  modalSize?: string;
  /** Blocca la chiusura del modale (Esc / click fuori) — es. mentre un modale annidato è aperto. */
  bloccaChiusura?: boolean;
  /** Deep-link da Spotlight: apre in modifica la scheda di questo record (quando caricato). */
  apriRecordId?: string;
  /** Incrementato dal chiamante per riaprire lo stesso record dopo una chiusura manuale. */
  apriRecordNonce?: number;
}) {
  const premium = usePremiumAccess();
  const ridotte = useAnimazioniRidotte();
  const [records, setRecords] = useState<RecordDto[]>(() => cacheRecords.get(registro.entity) ?? []);
  const [caricamento, setCaricamento] = useState(() => !cacheRecords.has(registro.entity));
  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca);
  const [mostraTuttiClienti, setMostraTuttiClienti] = useState(() => localStorage.getItem(CLIENTI_TUTTI_STORAGE) === "1");
  const [filtroAgenti, setFiltroAgenti] = useState<string[]>([]);
  const [filtroMedici, setFiltroMedici] = useState<string[]>([]);
  const [ordini, setOrdini] = useState<OrdineDto[]>([]);

  const [rifOpzioni, setRifOpzioni] = useState<Record<string, Opzione[]>>({});
  const [correlate, setCorrelate] = useState<Record<string, RecordDto[]>>({});

  const rifMappe = useMemo(() => {
    const mappe: Record<string, Map<string, string>> = {};
    for (const [entity, opzioni] of Object.entries(rifOpzioni)) {
      const map = new Map<string, string>();
      for (const opt of opzioni) {
        map.set(opt.value, opt.label);
      }
      mappe[entity] = map;
    }
    return mappe;
  }, [rifOpzioni]);

  const conteggi = useMemo<ColonnaCtx["conteggi"]>(() => {
    const mediciPerAgente = new Map<string, number>();
    for (const medico of correlate.medico ?? []) {
      const agenteId = String(medico.data.agente_id ?? "");
      if (agenteId) mediciPerAgente.set(agenteId, (mediciPerAgente.get(agenteId) ?? 0) + 1);
    }
    return { mediciPerAgente };
  }, [correlate]);

  const ctx = useMemo<ColonnaCtx>(() => ({ rif: rifOpzioni, correlate, rifMappe, conteggi }), [rifOpzioni, correlate, rifMappe, conteggi]);

  const [aperto, setAperto] = useState(false);
  const [modifica, setModifica] = useState<RecordDto | null>(null);
  const [storico, setStorico] = useState<{ id: string; etichetta: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; record: RecordDto } | null>(null);
  const origineMenuAzioniRef = useRef<PuntoVoloCestino | null>(null);
  const [sort, setSort] = useState<DataTableSortStatus<RecordDto>>({
    columnAccessor: registro.entity === "prodotto" ? "categoria" : (registro.colonne[0]?.key ?? "nome"),
    direction: "asc",
  });
  useCloseOnScroll(!!contextMenu, (v) => {
    if (!v) setContextMenu(null);
  });

  const rifEntities = useMemo(
    () => [...new Set(registro.campi.filter((c) => c.rifEntity).map((c) => c.rifEntity!))],
    [registro]
  );
  const correlateEntities = useMemo(
    () => {
      const base = registro.correlate ?? [];
      return registro.entity === "cliente" ? [...new Set([...base, "medico", "agente"])] : base;
    },
    [registro]
  );
  const eventiRicarica = useMemo(
    () =>
      [...new Set([
        `${registro.entity}:salvato`,
        ...rifEntities.map((ent) => `${ent}:salvato`),
        ...correlateEntities.map((ent) => `${ent}:salvato`),
        ...(registro.entity === "cliente" ? ["ordine:salvato"] : []),
      ])],
    [registro.entity, rifEntities, correlateEntities]
  );

  async function caricaRecords() {
    try {
      const data = await api.recordsList(registro.entity);
      cacheRecords.set(registro.entity, data);
      setRecords(data);
    } catch (e) {
      toast.error(`Caricamento non riuscito: ${e}`);
    } finally {
      setCaricamento(false);
    }
  }

  async function caricaDatiRegistro() {
    const entita = [...new Set([registro.entity, ...rifEntities, ...correlateEntities])];
    const [risultati, ordiniCaricati] = await Promise.all([
      Promise.all(
        entita.map(async (entity) => {
          try {
            return { entity, records: await api.recordsList(entity), errore: null };
          } catch (errore) {
            return { entity, records: [] as RecordDto[], errore };
          }
        })
      ),
      registro.entity === "cliente" ? api.ordiniLista().catch(() => []) : Promise.resolve([]),
    ]);

    const perEntita = new Map(risultati.map((r) => [r.entity, r.records]));
    const principale = risultati.find((r) => r.entity === registro.entity);
    if (principale?.errore) {
      toast.error(`Caricamento non riuscito: ${principale.errore}`);
    } else {
      for (const risultato of risultati) {
        if (!risultato.errore) cacheRecords.set(risultato.entity, risultato.records);
      }
      setRecords(perEntita.get(registro.entity) ?? []);
    }

    setRifOpzioni(
      Object.fromEntries(
        rifEntities.map((entity) => {
          const reg = REGISTRI.find((r) => r.entity === entity);
          const opzioni = (perEntita.get(entity) ?? []).map((r) => ({
            value: r.id,
            label: reg ? reg.titolo(r.data) : r.id,
          }));
          return [entity, opzioni];
        })
      )
    );
    setCorrelate(
      Object.fromEntries(
        correlateEntities.map((entity) => [entity, perEntita.get(entity) ?? []])
      )
    );
    setOrdini(ordiniCaricati);
    setCaricamento(false);
  }

  useEffect(() => {
    setCaricamento(true);
    void caricaDatiRegistro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registro.entity]);

  useRicaricaSuEventi(eventiRicarica, caricaDatiRegistro, 180);

  // Deep-link da Spotlight: appena il record richiesto è in lista, apre la sua scheda.
  // Il ref evita di riaprirla se l'utente la chiude (stesso id già gestito).
  const apertoDeepRef = useRef<string | null>(null);
  useEffect(() => {
    const richiesta = apriRecordId ? `${apriRecordId}:${apriRecordNonce}` : "";
    if (!apriRecordId || apertoDeepRef.current === richiesta) return;
    const rec = records.find((r) => r.id === apriRecordId);
    if (rec) {
      apertoDeepRef.current = richiesta;
      apriModifica(rec);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apriRecordId, apriRecordNonce, records]);

  function apriNuovo() {
    setModifica(null);
    setAperto(true);
  }

  function apriModifica(rec: RecordDto) {
    setModifica(rec);
    setAperto(true);
  }

  function comunica(rec: RecordDto) {
    if (registro.entity !== "cliente" && registro.entity !== "medico") return;
    const nome = registro.titolo(rec.data);
    setAperto(false);
    void apriComunicazione({
      destinatarioEntita: registro.entity,
      destinatarioId: rec.id,
      destinatarioNome: nome,
      email: String(rec.data.email ?? ""),
      telefono: String(rec.data.telefono ?? ""),
      variabili: {
        ...variabiliNomeDestinatario(nome),
        nome_medico: registro.entity === "medico" ? nome : "",
      },
    });
  }

  async function elimina(rec: RecordDto, origine?: PuntoVoloCestino) {
    const ok = await dialog.confirmDanger(
      `Eliminare «${registro.titolo(rec.data)}»?`,
      "Il record va nel Cestino: potrà essere ripristinato.",
      { conferma: "Elimina" }
    );
    if (!ok) return;
    try {
      setRecords((correnti) =>
        correnti.filter((record) => record.id !== rec.id),
      );
      await api.recordDelete(registro.entity, rec.id);
      if (!volaNelCestino(origine)) toast.success("Spostato nel Cestino.");
      caricaRecords();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
      caricaRecords();
    }
  }

  const recordsConBlob = useMemo(() => {
    return records.map((r) => {
      const texts = registro.colonne.map((col) => renderTesto(col, r, ctx));
      return {
        ...r,
        _searchBlob: texts.join(" ").toLowerCase(),
      };
    });
  }, [records, registro.colonne, ctx]);

  const clientiCreatiAnnoIds = useMemo(() => {
    if (registro.entity !== "cliente") return new Set<string>();
    const annoCorrente = new Date().getFullYear();
    const set = new Set<string>();
    for (const r of records) {
      if (annoDaUlid(r.id) === annoCorrente) set.add(r.id);
    }
    return set;
  }, [records, registro.entity]);

  const clientiConOrdiniAnnoIds = useMemo(() => {
    if (registro.entity !== "cliente") return new Set<string>();
    const annoCorrente = new Date().getFullYear();
    const set = new Set<string>();
    for (const o of ordini) {
      if (o.clienteId && Number(o.data.slice(0, 4)) === annoCorrente) set.add(o.clienteId);
    }
    return set;
  }, [ordini, registro.entity]);

  const mediciById = useMemo(() => new Map((correlate.medico ?? []).map((m) => [m.id, m])), [correlate.medico]);
  const agentiById = useMemo(() => new Map((correlate.agente ?? []).map((a) => [a.id, a])), [correlate.agente]);
  const mediciPerCliente = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const o of ordini) {
      if (!o.clienteId || !o.medicoId) continue;
      let set = map.get(o.clienteId);
      if (!set) {
        set = new Set<string>();
        map.set(o.clienteId, set);
      }
      set.add(o.medicoId);
    }
    for (const c of records) {
      const ultimo = String(c.data.ultimo_medico_id ?? "");
      if (!ultimo) continue;
      let set = map.get(c.id);
      if (!set) {
        set = new Set<string>();
        map.set(c.id, set);
      }
      set.add(ultimo);
    }
    return map;
  }, [ordini, records]);

  const agentiPerCliente = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const o of ordini) {
      if (!o.clienteId || !o.agenteId) continue;
      let set = map.get(o.clienteId);
      if (!set) {
        set = new Set<string>();
        map.set(o.clienteId, set);
      }
      set.add(o.agenteId);
    }
    for (const [clienteId, mediciIds] of mediciPerCliente) {
      for (const medicoId of mediciIds) {
        const agenteId = String(mediciById.get(medicoId)?.data.agente_id ?? "");
        if (!agenteId) continue;
        let set = map.get(clienteId);
        if (!set) {
          set = new Set<string>();
          map.set(clienteId, set);
        }
        set.add(agenteId);
      }
    }
    return map;
  }, [mediciById, mediciPerCliente, ordini]);

  const filtroAgentiSet = useMemo(() => new Set(filtroAgenti), [filtroAgenti]);
  const filtroMediciSet = useMemo(() => new Set(filtroMedici), [filtroMedici]);

  const opzioniAgenti = useMemo(() => {
    const daRif = rifOpzioni.agente;
    if (daRif?.length) return daRif;
    return [...agentiById.values()].map((a) => ({ value: a.id, label: String(a.data.nome ?? "(agente)") }));
  }, [agentiById, rifOpzioni.agente]);

  const opzioniMedici = useMemo(
    () => (correlate.medico ?? []).map((m) => ({ value: m.id, label: String(m.data.nome ?? "(medico)") })),
    [correlate.medico]
  );

  const filtrati = useMemo(() => {
    const q = cercaDifferita.trim().toLowerCase();
    const compattaClienti =
      registro.entity === "cliente" &&
      !mostraTuttiClienti &&
      !q &&
      clientiCreatiAnnoIds.size > 0;
    return recordsConBlob.filter((r) => {
      if (compattaClienti && !clientiCreatiAnnoIds.has(r.id) && !clientiConOrdiniAnnoIds.has(r.id)) return false;
      if (q && !r._searchBlob.includes(q)) return false;

      if (registro.entity === "cliente") {
        if (filtroMediciSet.size > 0) {
          const medici = mediciPerCliente.get(r.id);
          if (!medici || !intersecaSet(filtroMediciSet, medici)) return false;
        }
        if (filtroAgentiSet.size > 0) {
          const agenti = agentiPerCliente.get(r.id);
          if (!agenti || !intersecaSet(filtroAgentiSet, agenti)) return false;
        }
      } else if (registro.entity === "medico" && filtroAgentiSet.size > 0) {
        const agenteId = String(r.data.agente_id ?? "");
        if (!filtroAgentiSet.has(agenteId)) return false;
      }
      return true;
    });
  }, [
    recordsConBlob,
    cercaDifferita,
    registro.entity,
    mostraTuttiClienti,
    clientiCreatiAnnoIds,
    clientiConOrdiniAnnoIds,
    filtroMediciSet,
    filtroAgentiSet,
    mediciPerCliente,
    agentiPerCliente,
  ]);

  const ordinati = useMemo(() => {
    const col = registro.colonne.find((c) => c.key === sort.columnAccessor);
    if (!col) return filtrati;
    const arr = [...filtrati];
    arr.sort((a, b) => {
      const va = valoreSort(col, a, ctx);
      const vb = valoreSort(col, b, ctx);
      let cmp = 0;
      if (registro.entity === "prodotto" && col.key === "categoria") {
        const pa = getCategoriaPriorita(va);
        const pb = getCategoriaPriorita(vb);
        if (pa !== pb) {
          cmp = pa - pb;
        } else {
          const na = String(a.data.nome ?? "");
          const nb = String(b.data.nome ?? "");
          cmp = na.localeCompare(nb, "it", { numeric: true });
        }
      } else {
        cmp =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : String(va).localeCompare(String(vb), "it", { numeric: true });
      }
      return sort.direction === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [filtrati, sort, registro, ctx]);

  const columns = useMemo<DataTableColumn<RecordDto>[]>(() => {
    const dati: DataTableColumn<RecordDto>[] = registro.colonne.map((col) => ({
      accessor: col.key,
      title: col.label,
      sortable: true,
      resizable: true,
      textAlign: col.tipo === "eur" || col.tipo === "numero" ? "right" : "left",
      cellsClassName: col.tipo === "eur" || col.tipo === "numero" ? "tabular" : undefined,
      render: (r: RecordDto) => renderCella(col, r, ctx),
    }));
    const azioni: DataTableColumn<RecordDto> = {
      accessor: "__azioni",
      title: "",
      width: 40,
      titleClassName: "pt-col-azioni",
      cellsClassName: "pt-col-azioni",
      textAlign: "center",
      render: (r) =>
        bloccato?.(r) ? null : (
          <MenuAzioniRiga onTargetClick={(target) => {
            origineMenuAzioniRef.current = catturaOrigineCestino(target);
          }}>
              <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => apriModifica(r)}>
                Modifica
              </Menu.Item>
              {(registro.entity === "cliente" || registro.entity === "medico") &&
                canRunPremiumAction(premium) && (
                  <Menu.Item leftSection={<IconMessage size={15} />} onClick={() => comunica(r)}>
                    Comunica
                  </Menu.Item>
                )}
              <Menu.Item leftSection={<IconHistory size={15} />} onClick={() => setStorico({ id: r.id, etichetta: registro.titolo(r.data) })}>
                Storico
              </Menu.Item>
              {!nonEliminabile?.(r) && (
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={15} />}
                  onClick={(event) =>
                    elimina(
                      r,
                      origineMenuAzioniRef.current ??
                        catturaOrigineCestino(event),
                    )
                  }
                >
                  Elimina
                </Menu.Item>
              )}
          </MenuAzioniRiga>
        ),
    };
    return [...dati, azioni];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registro, ctx, bloccato, nonEliminabile, premium]);

  const filtriAttivi =
    registro.entity === "cliente"
      ? (filtroAgenti.length > 0 ? 1 : 0) + (filtroMedici.length > 0 ? 1 : 0)
      : registro.entity === "medico" && filtroAgenti.length > 0
        ? 1
        : 0;
  const filtriAnagrafiche = useMemo(() => {
    const filtri = [];
    if (registro.entity === "cliente" || registro.entity === "medico") {
      filtri.push({
        chiave: "agenti",
        larghezza: 190,
        nodo: (
          <MultiSelect
            label="Agenti"
            placeholder={filtroAgenti.length ? "" : "Tutti"}
            data={opzioniAgenti}
            value={filtroAgenti}
            onChange={setFiltroAgenti}
            clearable
            searchable
            comboboxProps={{ withinPortal: false }}
          />
        ),
      });
    }
    if (registro.entity === "cliente") {
      filtri.push({
          chiave: "medici",
          larghezza: 190,
          nodo: (
            <MultiSelect
              label="Medici"
              placeholder={filtroMedici.length ? "" : "Tutti"}
              data={opzioniMedici}
              value={filtroMedici}
              onChange={setFiltroMedici}
              clearable
              searchable
              comboboxProps={{ withinPortal: false }}
            />
          ),
      });
    }
    return filtri;
  }, [filtroAgenti, filtroMedici, opzioniAgenti, opzioniMedici, registro.entity]);

  const tabellaAnagrafiche = useMemo(() => {
    if (caricamento && records.length === 0) {
      return <Box style={{ minHeight: 240 }} />;
    }

    return (
      <Tabella<RecordDto>
        // Con righe: la tabella si stringe sul contenuto. Senza: 240 per centrare l'empty-state.
        minHeight={ordinati.length ? 0 : 240}
        columns={columns}
        records={ordinati}
        caricamentoIniziale={caricamento}
        ridimensionamentoSenzaSfumaturaKey={cercaDifferita}
        idAccessor="id"
        storeColumnsKey={`anagrafica-${registro.entity}`}
        sortStatus={sort}
        onSortStatusChange={setSort}
        onRowClick={({ record }) => {
          if (!bloccato?.(record)) apriModifica(record);
        }}
        onRowContextMenu={({ record, event }) => {
          if (bloccato?.(record)) return;
          setContextMenu({
            ...puntoDaEventoContextMenu(event),
            record,
          });
        }}
        rowStyle={(r) => ({ cursor: bloccato?.(r) ? "default" : "pointer" })}
        emptyState={
          <Stack align="center" gap="xs" py={40}>
            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
              <registro.Icon size={24} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">
              {cerca ? "Nessun risultato per la ricerca." : `Nessun ${registro.singolare} ancora. Crea il primo.`}
            </Text>
            {!cerca && (
              <Button variant="light" color="accent" leftSection={<IconPlus size={16} />} onClick={apriNuovo}>
                Nuovo {registro.singolare}
              </Button>
            )}
          </Stack>
        }
      />
    );
    // Il modale vive nello stesso componente della tabella: memoizziamo il nodo per evitare
    // di ridisegnare migliaia di righe quando cambia solo lo stato del form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caricamento, records, ordinati, columns, sort, registro.entity, registro.singolare, cerca, cercaDifferita, bloccato]);

  const nascosta = !attiva || (caricamento && records.length === 0);

  return (
    <Stack
      gap="sm"
      style={{
        height: "100%",
        opacity: nascosta ? 0 : 1,
        visibility: nascosta ? "hidden" : "visible",
        transition: ridotte || durataSwitchTabelleMs === 0 ? "none" : `opacity ${dur.tab}s ease-out`,
      }}
    >
      <Group justify="space-between" wrap="wrap" align="flex-end">
        <Group gap="xs" wrap="nowrap" align="flex-end" style={{ flex: 1, minWidth: 0 }}>
          <DebouncedInput
            placeholder={`Cerca tra i ${registro.etichetta.toLowerCase()}…`}
            leftSection={<IconSearch size={16} />}
            value={cerca}
            onChange={setCerca}
            style={{ flex: "1 1 200px", maxWidth: 300 }}
          />
          {filtriAnagrafiche.length > 0 && (
            <FiltriPopover
              attivi={filtriAttivi}
              onAzzera={() => {
                setFiltroAgenti([]);
                setFiltroMedici([]);
              }}
              filtri={filtriAnagrafiche}
              width={340}
            />
          )}
        </Group>
        <Group gap="xs" wrap="wrap" align="center" style={{ minHeight: 36 }}>
          {azioneExtra}
          {registro.entity === "cliente" && (
            <Switch
              size="sm"
              checked={mostraTuttiClienti}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setMostraTuttiClienti(checked);
                localStorage.setItem(CLIENTI_TUTTI_STORAGE, checked ? "1" : "0");
              }}
              label="Tutti i clienti"
            />
          )}
          <Button color="accent" leftSection={<IconPlus size={18} />} onClick={apriNuovo}>
            Nuovo {registro.singolare}
          </Button>
        </Group>
      </Group>

      {intestazione}

      {/* Le anagrafiche sono liste brevi: la tabella si adatta al contenuto (niente
          altezza piena che lascerebbe un grosso riquadro vuoto sotto poche righe). Se
          la lista cresce, scorre la pagina. minHeight di Tabella tiene l'empty-state. */}
      <Box>
        {tabellaAnagrafiche}
      </Box>

      <AnagraficaEditorModal
        opened={aperto}
        registro={registro}
        record={modifica}
        onClose={() => {
          setAperto(false);
          setModifica(null);
        }}
        onSaved={(rec, modalita) => {
          void caricaRecords();
          if (modalita === "unificato") {
            setModifica(rec);
          } else {
            setModifica(null);
            setAperto(false);
          }
        }}
        onInvalidated={() => void caricaRecords()}
        campiDisabilitati={campiDisabilitati}
        modalExtra={modalExtra}
        size={modalSize}
        bloccaChiusura={bloccaChiusura}
      />

      {storico && (
        <StoricoModal
          entity={registro.entity}
          id={storico.id}
          etichetta={storico.etichetta}
          onClose={() => setStorico(null)}
          onChanged={caricaRecords}
        />
      )}

      {contextMenu && (
        <ContextMenuPuntuale punto={contextMenu} onClose={() => setContextMenu(null)}>
            <Menu.Item leftSection={<IconPencil size={15} />} onClick={() => { apriModifica(contextMenu.record); setContextMenu(null); }}>
              Modifica
            </Menu.Item>
            {(registro.entity === "cliente" || registro.entity === "medico") &&
              canRunPremiumAction(premium) && (
                <Menu.Item
                  leftSection={<IconMessage size={15} />}
                  onClick={() => {
                    comunica(contextMenu.record);
                    setContextMenu(null);
                  }}
                >
                  Comunica
                </Menu.Item>
              )}
            <Menu.Item leftSection={<IconHistory size={15} />} onClick={() => { setStorico({ id: contextMenu.record.id, etichetta: registro.titolo(contextMenu.record.data) }); setContextMenu(null); }}>
              Storico
            </Menu.Item>
            {!nonEliminabile?.(contextMenu.record) && (
              <Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={() => {
                const { record, x, y } = contextMenu;
                setContextMenu(null);
                elimina(record, { x, y });
              }}>
                Elimina
              </Menu.Item>
            )}
        </ContextMenuPuntuale>
      )}
    </Stack>
  );
}

// ---- Rendering celle ----

/** Valore per l'ordinamento: numerico per importi/numeri, testo altrimenti. */
function valoreSort(col: Colonna, r: RecordDto, ctx: ColonnaCtx): string | number {
  if (col.calcola) {
    const v = col.calcola(r, ctx);
    return typeof v === "number" ? v : String(v).toLowerCase();
  }
  if (col.tipo === "eur" || col.tipo === "numero") {
    const raw = r.data[col.key];
    return typeof raw === "number" ? raw : 0;
  }
  return renderTesto(col, r, ctx).toLowerCase();
}

function renderTesto(col: Colonna, r: RecordDto, ctx: ColonnaCtx): string {
  if (col.calcola) {
    const v = col.calcola(r, ctx);
    return v === "" || v == null ? "" : String(v);
  }
  const raw = r.data[col.key];
  if (col.rifEntity) {
    if (ctx.rifMappe?.[col.rifEntity]) {
      return ctx.rifMappe[col.rifEntity].get(raw as string) ?? "";
    }
    const opt = (ctx.rif[col.rifEntity] ?? []).find((o) => o.value === raw);
    return opt?.label ?? "";
  }
  if (raw == null || raw === "") return "";
  if (col.tipo === "eur") return `€ ${centsToEurStr(raw)}`;
  if (col.key === "regione") return normalizzaRegioneVisuale(String(raw));
  return String(raw);
}

function renderCella(col: Colonna, r: RecordDto, ctx: ColonnaCtx) {
  const txt = renderTesto(col, r, ctx);
  if (txt === "") return <Text c="dimmed">—</Text>;
  if (col.badge) {
    return (
      <Badge variant="light" color={col.badge[txt] ?? "gray"}>
        {txt}
      </Badge>
    );
  }
  return txt;
}

function normalizzaRegioneVisuale(s: string): string {
  const n = s.toLowerCase();
  return n.includes("aosta") || n.includes("aoste") ? "Valle D'Aosta" : s;
}

function intersecaSet(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) if (large.has(value)) return true;
  return false;
}

function annoDaUlid(id: string): number | null {
  const tsChars = id.slice(0, 10).toUpperCase();
  if (tsChars.length < 10) return null;
  let ms = 0;
  for (const ch of tsChars) {
    const val = CROCKFORD.indexOf(ch);
    if (val === -1) return null;
    ms = ms * 32 + val;
  }
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
}
