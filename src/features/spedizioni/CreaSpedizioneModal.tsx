// Modale "Crea spedizione" (FASE 4A + 4C-2 bundling): dalla schermata Spedizioni → Da
// spedire si selezionano uno o più ordini; qui si scelgono corriere e data (comuni) e, per
// ogni **collo**, il numero (interno del vaccino), i colli, l'eventuale pagamento alla
// consegna (contrassegno/assegno, anche solo una rata parziale) e quali righe includere
// davvero (spunta) — così un ordine può partire **parzialmente**. Ogni collo genera una
// spedizione; tutte condividono un **lotto** = sessione di creazione, con cui le "Effettuate"
// vengono raggruppate. Il preavviso telefonico è un toggle comune.
//
// **Bundling (4C-2):** se più ordini selezionati sono dello **stesso cliente**, in cima si
// propone di **unirli in un unico collo** (colli e contrassegno sommati, righe di tutti gli
// ordini): diventano una sola spedizione (il backend `spedizione_crea` accetta righe di
// ordini diversi).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Indicator,
  Modal,
  NumberInput,
  Popover,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconExternalLink, IconMapPin, IconNote, IconPhone, IconPhoneOff, IconTruck } from "@tabler/icons-react";
import {
  api,
  type BollettazioneConfermaRiga,
  type OrdineDaSpedire,
  type RecordDto,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { focusInvalidField } from "../../ui/focusInvalid";
import { VirtualFlow } from "../../ui/VirtualFlow";
import { NumeriLottoInput } from "../../ui/NumeriLottoInput";
import { normalizzaColliPesoCorriere } from "./profiliCorriere";
import { ordineHaDatiVaccino } from "./datiVaccino";

const oggi = () => {
  // Data locale (NON toISOString: in fuso positivo a notte fonda darebbe il giorno prima).
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Mezzo = "prepagato" | "contrassegno" | "assegno";

/** Bozza per-riga proveniente dall'espansione inline «Da spedire» (FASE 7). */
export interface BozzaRiga {
  numero: string;
  incluso: boolean;
}

/** Stato editabile per un **collo** (uno o più ordini uniti). */
interface PerCollo {
  colli: number | "";
  /** `true` finché l'utente non tocca a mano il nº colli. Per CORRIERE_A il profilo
   * forza comunque sempre colli/peso a 1. */
  colliAuto: boolean;
  mezzo: Mezzo;
  importo: number | ""; // € (contrassegno/assegno), anche parziale
  importoAuto: boolean;
  preavviso: boolean; // preavviso telefonico per questo collo
  note: string; // note di spedizione (auto dal cliente)
  /** Conteggio derivato mantenuto insieme alle spunte: evita di ripercorrere tutte le
   * righe di tutti i colli a ogni carattere digitato in un campo. */
  incluse: number;
  righeCheck: Record<string, boolean>; // rigaId -> incluso
  numeri: Record<string, string>; // rigaId -> numero/lotto del vaccino (FASE 7)
}

/** Un collo da creare = uno o più ordini (uniti se stesso cliente). */
interface Collo {
  key: string;
  clienteId: string;
  ordini: OrdineDaSpedire[];
  unito: boolean;
}

function chiaveCollo(collo: Collo): string {
  return collo.key;
}

/** Default per un collo: righe spuntate, colli = somma, pagamento auto dagli ordini. I
 * numeri/lotti e le esclusioni arrivano dalle bozze inline «Da spedire» (se presenti). */
function defaultPerCollo(ordini: OrdineDaSpedire[], bozze?: Record<string, BozzaRiga>): PerCollo {
  // Auto: dagli ordini con una rata non saldata su contrassegno/assegno propone quel mezzo
  // e la SOMMA dei relativi importi; altrimenti prepagato (fallback importo = somma residui).
  const conMezzo = ordini.filter((o) => o.codMezzo);
  const mezzo = (conMezzo[0]?.codMezzo as Mezzo) || "prepagato";
  const righe = ordini.flatMap((o) => o.righe);
  // Colli = numero di prodotti INCLUSI (un vaccino = un collo); segue le spunte finché non si
  // modifica a mano. Prima usava le righe totali dell'ordine → mostrava più colli del dovuto.
  const inclusi = righe.filter((r) => bozze?.[r.rigaId]?.incluso ?? true).length;
  const righeCheck = Object.fromEntries(righe.map((r) => [r.rigaId, bozze?.[r.rigaId]?.incluso ?? true]));
  const cents = calcolaImportoSpedizione(ordini, righeCheck);
  return {
    colli: inclusi,
    colliAuto: true,
    mezzo,
    importo: cents > 0 ? cents / 100 : "",
    importoAuto: true,
    preavviso: true,
    note: ordini.map((o) => o.noteSpedizione).find(Boolean) || "",
    incluse: inclusi,
    righeCheck,
    numeri: Object.fromEntries(
      ordini.flatMap((ordine) =>
        ordine.righe.map((riga) => [
          riga.rigaId,
          ordineHaDatiVaccino(ordine)
            ? bozze?.[riga.rigaId]?.numero ?? riga.numero ?? ""
            : "",
        ]),
      ),
    ),
  };
}

export function calcolaImportoSpedizione(ordini: OrdineDaSpedire[], righeCheck: Record<string, boolean>): number {
  return ordini.reduce((tot, o) => {
    const spedite = o.righe.filter((r) => righeCheck[r.rigaId]);
    if (spedite.length === 0) return tot;
    const valoreSpedito = spedite.reduce((s, r) => s + (r.prezzo || 0) * (r.qta || 1), 0);
    const totaleProdotti = Math.max(1, o.righe.length);
    const quotaAcconto = Math.round(((o.acconto || 0) / totaleProdotti) * spedite.length);
    return tot + Math.max(0, valoreSpedito - quotaAcconto);
  }, 0);
}

function profiloCorriere(corriere?: RecordDto): string {
  const profilo = String(corriere?.data.profilo || "");
  if (profilo) return profilo;
  const nome = String(corriere?.data.nome || "").toLowerCase();
  return nome.includes("carrai") ? "carrai" : "gls";
}

export function colliDistintaAuto(profilo: string, prodottiInclusi: number): number {
  void prodottiInclusi;
  return normalizzaColliPesoCorriere(profilo, 1, 1).colli;
}

export function CreaSpedizioneModal({
  ordini,
  onClose,
  onDone,
  onApriOrdine,
  sospeso = false,
  bozze,
  bollettazioneRows,
  bollettazioneDataArrivo,
}: {
  ordini: OrdineDaSpedire[] | null;
  onClose: () => void;
  onDone: () => void;
  onApriOrdine?: (ordineId: string) => void;
  /** Tiene il modale montato (stato in lavorazione preservato) ma nascosto: usato mentre
   * si apre l'editor dell'ordine sopra, così «correggi indirizzo» non perde il lavoro. */
  sospeso?: boolean;
  /** Bozze per-riga (numero + incluso) dall'espansione inline «Da spedire». FASE 7. */
  bozze?: Record<string, BozzaRiga>;
  /** Righe già revisionate dalla bollettazione. Se presente, il salvataggio usa la
   * conferma atomica FASE 13 invece di creare i colli uno alla volta. */
  bollettazioneRows?: BollettazioneConfermaRiga[];
  bollettazioneDataArrivo?: string;
}) {
  // Tieni il contenuto montato durante l'animazione di uscita.
  const [mostrati, setMostrati] = useState<OrdineDaSpedire[] | null>(ordini);
  useEffect(() => {
    if (ordini) setMostrati(ordini);
  }, [ordini]);

  return (
    <Modal
      opened={!!ordini}
      onClose={onClose}
      size="xl"
      zIndex={1300}
      // Sospeso: resta "opened" (stato vivo) ma invisibile e inattivo, così l'editor sopra
      // ha fuoco/scroll/Esc tutti per sé e questo non ruba né overlay né focus-trap.
      styles={sospeso ? { root: { display: "none" } } : undefined}
      trapFocus={!sospeso}
      lockScroll={!sospeso}
      closeOnEscape={!sospeso}
      closeOnClickOutside={!sospeso}
      title={
        <Group gap="sm">
          <Text fw={700}>Crea spedizione</Text>
          {mostrati && (
            <Badge variant="light" color="accent">
              {mostrati.length} {mostrati.length === 1 ? "ordine" : "ordini"}
            </Badge>
          )}
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: () => setMostrati(null) }}
    >
      {mostrati && (
        <Form
          ordini={mostrati}
          bozze={bozze}
          bollettazioneRows={bollettazioneRows}
          bollettazioneDataArrivo={bollettazioneDataArrivo}
          onClose={onClose}
          onDone={onDone}
          onApriOrdine={onApriOrdine}
        />
      )}
    </Modal>
  );
}

function Form({
  ordini,
  bozze,
  bollettazioneRows,
  bollettazioneDataArrivo,
  onClose,
  onDone,
  onApriOrdine,
}: {
  ordini: OrdineDaSpedire[];
  bozze?: Record<string, BozzaRiga>;
  bollettazioneRows?: BollettazioneConfermaRiga[];
  bollettazioneDataArrivo?: string;
  onClose: () => void;
  onDone: () => void;
  onApriOrdine?: (ordineId: string) => void;
}) {
  const [corrieri, setCorrieri] = useState<RecordDto[]>([]);
  const [data, setData] = useState(oggi());
  const [corriereId, setCorriereId] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null);
  useCloseOnScroll(openNoteKey !== null, (v) => { if (!v) setOpenNoteKey(null); });
  // Clienti scelti per l'unione (più ordini → un collo).
  const [unisci, setUnisci] = useState<Set<string>>(new Set());
  // Un lotto per questa sessione di creazione (raggruppa le Effettuate).
  const lotto = useRef(crypto.randomUUID()).current;

  // Clienti con più ordini selezionati = candidati all'unione (proposta automatica).
  const clientiDuplicati = useMemo(() => {
    const perCliente = new Map<string, OrdineDaSpedire[]>();
    for (const o of ordini) {
      if (!o.clienteId) continue;
      const a = perCliente.get(o.clienteId) ?? [];
      a.push(o);
      perCliente.set(o.clienteId, a);
    }
    return [...perCliente.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([clienteId, arr]) => ({ clienteId, nome: arr[0].clienteNome || "(cliente)", n: arr.length }));
  }, [ordini]);

  // Colli da creare: un ordine per collo, salvo i clienti "uniti" (un collo per cliente).
  const colli = useMemo<Collo[]>(() => {
    const perCliente = new Map<string, OrdineDaSpedire[]>();
    for (const o of ordini) {
      const a = perCliente.get(o.clienteId) ?? [];
      a.push(o);
      perCliente.set(o.clienteId, a);
    }
    const out: Collo[] = [];
    const visti = new Set<string>();
    for (const o of ordini) {
      if (visti.has(o.ordineId)) continue;
      const stesso = perCliente.get(o.clienteId)!;
      if (o.clienteId && stesso.length > 1 && unisci.has(o.clienteId)) {
        out.push({ key: `cli:${o.clienteId}`, clienteId: o.clienteId, ordini: stesso, unito: true });
        stesso.forEach((x) => visti.add(x.ordineId));
      } else {
        out.push({ key: `ord:${o.ordineId}`, clienteId: o.clienteId, ordini: [o], unito: false });
        visti.add(o.ordineId);
      }
    }
    return out;
  }, [ordini, unisci]);

  // Stato per-collo. Init = tutti singoli; un effetto lo riallinea quando si unisce/divide.
  const [stato, setStato] = useState<Record<string, PerCollo>>(() => {
    const m: Record<string, PerCollo> = {};
    for (const o of ordini) m[`ord:${o.ordineId}`] = defaultPerCollo([o], bozze);
    return m;
  });
  useEffect(() => {
    setStato((prev) => {
      const next: Record<string, PerCollo> = {};
      for (const c of colli) next[c.key] = prev[c.key] ?? defaultPerCollo(c.ordini, bozze);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colli]);

  useEffect(() => {
    api.recordsList("corriere").then(setCorrieri).catch(() => {});
  }, []);

  const corriereData = useMemo(
    () => corrieri.map((c) => ({ value: c.id, label: (c.data.nome as string) || "(corriere)" })),
    [corrieri]
  );
  const profiloSelezionato = useMemo(
    () => profiloCorriere(corrieri.find((c) => c.id === corriereId)),
    [corrieri, corriereId]
  );
  const colliPerChiave = useMemo(
    () => new Map(colli.map((collo) => [collo.key, collo])),
    [colli]
  );

  useEffect(() => {
    setStato((s) => {
      const n = { ...s };
      for (const c of colli) {
        const ps = n[c.key];
        if (!ps?.colliAuto) continue;
        const inclusi = c.ordini.flatMap((o) => o.righe).filter((r) => ps.righeCheck[r.rigaId]).length;
        n[c.key] = { ...ps, colli: colliDistintaAuto(profiloSelezionato, inclusi) };
      }
      return n;
    });
  }, [colli, profiloSelezionato]);

  const patch = useCallback((key: string, p: Partial<PerCollo>) => {
    setStato((s) => ({ ...s, [key]: { ...s[key], ...p } }));
  }, []);

  const toggleRiga = useCallback((key: string, rigaId: string, v: boolean) =>
    setStato((s) => {
      const ps = s[key];
      const righeCheck = { ...ps.righeCheck, [rigaId]: v };
      // Se il nº colli segue i prodotti (auto), aggiornalo al nuovo numero di inclusi.
      const collo = colliPerChiave.get(key);
      const inclusi = collo
        ? collo.ordini.flatMap((o) => o.righe).filter((r) => righeCheck[r.rigaId]).length
        : ps.incluse;
      const importoCents = collo ? calcolaImportoSpedizione(collo.ordini, righeCheck) : 0;
      return {
        ...s,
        [key]: {
          ...ps,
          incluse: Number(inclusi) || 0,
          righeCheck,
          colli: ps.colliAuto ? colliDistintaAuto(profiloSelezionato, Number(inclusi) || 0) : ps.colli,
          importo: ps.importoAuto ? (importoCents > 0 ? importoCents / 100 : "") : ps.importo,
        },
      };
    }), [colliPerChiave, profiloSelezionato]);

  const setNumero = useCallback((key: string, rigaId: string, v: string) =>
    setStato((s) => ({
      ...s,
      [key]: { ...s[key], numeri: { ...s[key].numeri, [rigaId]: v } },
    })), []);

  const setUnione = (clienteId: string, v: boolean) =>
    setUnisci((prev) => {
      const n = new Set(prev);
      if (v) n.add(clienteId);
      else n.delete(clienteId);
      return n;
    });

  // Master "preavviso per tutti": acceso se tutti i colli ce l'hanno.
  const preavvisoTutti = colli.every((c) => stato[c.key]?.preavviso);
  const setPreavvisoTutti = (v: boolean) =>
    setStato((s) => {
      const n = { ...s };
      for (const c of colli) if (n[c.key]) n[c.key] = { ...n[c.key], preavviso: v };
      return n;
    });

  const totIncluse = useMemo(
    () => colli.reduce((n, c) => n + (stato[c.key]?.incluse ?? 0), 0),
    [colli, stato]
  );
  const salva = async () => {
    if (!corriereId) {
      toast.warning("Scegli un corriere.");
      focusInvalidField('[data-pt-field="crea-spedizione-corriere"]');
      return;
    }
    if (!data) {
      toast.warning("Indica la data di spedizione.");
      focusInvalidField('[data-pt-field="crea-spedizione-data"]');
      return;
    }
    const lavori = colli
      .map((c) => {
        const ps = stato[c.key];
        const numeri = c.ordini
          .flatMap((o) => o.righe)
          .filter((r) => ps?.righeCheck[r.rigaId])
          .map((r) => ({ rigaId: r.rigaId, numero: (ps?.numeri[r.rigaId] ?? "").trim() }));
        return {
          ps,
          numeri,
          haDatiVaccino: c.ordini.some(ordineHaDatiVaccino),
        };
      })
      .filter((x) => x.ps && x.numeri.length > 0);

    if (lavori.length === 0) {
      toast.warning("Nessuna riga selezionata da spedire.");
      return;
    }

    setSalvando(true);
    try {
      const shipments = lavori.map(({ ps, numeri, haDatiVaccino }) => {
        const colliN = !haDatiVaccino || profiloSelezionato === "carrai"
          ? 1
          : ps!.colliAuto
            ? colliDistintaAuto(profiloSelezionato, numeri.length)
            : ps!.colli === ""
              ? colliDistintaAuto(profiloSelezionato, numeri.length)
              : ps!.colli;
        const mezzo = ps!.mezzo === "prepagato" ? "" : ps!.mezzo;
        const contrassegno = mezzo && ps!.importo !== "" ? eurToCents(Number(ps!.importo)) : 0;
        return {
          data,
          corriereId,
          colli: colliN,
          peso: colliN, // legacy: peso = colli (modificabile in futuro)
          servizi: "",
          preavviso: ps!.preavviso,
          mezzo,
          contrassegno,
          note: ps!.note.trim(),
          rowIds: numeri.map((numero) => numero.rigaId),
          numeri,
        };
      });
      if (bollettazioneRows) {
        const includedRows = new Set(
          shipments.flatMap((shipment) => shipment.rowIds),
        );
        await api.bollettazioneConferma({
          mode: "spedizione",
          dataArrivo: bollettazioneDataArrivo || data,
          rows: bollettazioneRows.filter((row) =>
            includedRows.has(row.rowId),
          ),
          shipments: shipments.map(({ numeri: _numeri, ...shipment }) => shipment),
        });
      } else {
        for (const shipment of shipments) {
          await api.spedizioneCrea({
            lotto,
            data: shipment.data,
            corriereId: shipment.corriereId,
            colli: shipment.colli,
            peso: shipment.peso,
            servizi: shipment.servizi,
            preavviso: shipment.preavviso,
            mezzo: shipment.mezzo,
            contrassegno: shipment.contrassegno,
            note: shipment.note,
            numeri: shipment.numeri,
          });
        }
      }
      toast.success(lavori.length === 1 ? "Spedizione creata." : `${lavori.length} spedizioni create.`);
      onDone();
    } catch (e) {
      toast.error(`Creazione spedizione non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  };

  const cambiaNotaAperta = useCallback((key: string | null) => {
    setOpenNoteKey(key);
  }, []);
  const renderCollo = useCallback((collo: Collo) => {
    const perCollo = stato[collo.key];
    if (!perCollo) return null;
    return (
      <ColloSpedizioneCard
        collo={collo}
        perCollo={perCollo}
        profiloCorriere={profiloSelezionato}
        notaAperta={openNoteKey === collo.key}
        onNotaAperta={cambiaNotaAperta}
        onPatch={patch}
        onToggleRiga={toggleRiga}
        onSetNumero={setNumero}
        onApriOrdine={onApriOrdine}
      />
    );
  }, [
    cambiaNotaAperta,
    onApriOrdine,
    openNoteKey,
    patch,
    profiloSelezionato,
    setNumero,
    stato,
    toggleRiga,
  ]);

  return (
    <Box className="pt-modal-shell">
      <Box className="pt-modal-scroll">
        <Stack gap="md">
          <SimpleGrid cols={2} spacing="md">
            <Box data-pt-field="crea-spedizione-data">
              <TextInput
                label="Data spedizione"
                type="date"
                value={data}
                onChange={(e) => setData(e.currentTarget.value)}
              />
            </Box>
            <Box data-pt-field="crea-spedizione-corriere">
              <Select
                label="Corriere"
                placeholder="Scegli…"
                data={corriereData}
                value={corriereId || null}
                onChange={(v) => setCorriereId(v || "")}
                allowDeselect={false}
                nothingFoundMessage="Nessun corriere in anagrafica"
                comboboxProps={{ withinPortal: true, zIndex: 1400 }}
              />
            </Box>
          </SimpleGrid>
          <Switch
            label="Preavviso telefonico per tutti"
            description="Aggiunge «PREAVVISO TELEFONICO …». Puoi poi attivarlo/disattivarlo per il singolo collo."
            checked={preavvisoTutti}
            onChange={(e) => setPreavvisoTutti(e.currentTarget.checked)}
          />

      {clientiDuplicati.length > 0 && (
        <Box
          p="sm"
          style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, background: "var(--mantine-color-default-hover)" }}
        >
          <Text size="sm" fw={600}>
            Stesso cliente, più ordini
          </Text>
          <Text size="xs" c="dimmed" mb={8}>
            Puoi riunirli in un’unica spedizione, mantenendo tutte le righe e sommando il contrassegno.
          </Text>
          <Stack gap={6}>
            {clientiDuplicati.map((d) => (
              <Switch
                key={d.clienteId}
                size="sm"
                label={`Unisci «${d.nome}» — ${d.n} ordini in una spedizione`}
                checked={unisci.has(d.clienteId)}
                onChange={(e) => setUnione(d.clienteId, e.currentTarget.checked)}
              />
            ))}
          </Stack>
        </Box>
      )}

      <Divider label="Spedizioni da creare" labelPosition="left" />

      <VirtualFlow
        items={colli}
        getKey={chiaveCollo}
        estimateHeight={260}
        gap={8}
        overscan={3}
        renderItem={renderCollo}
      />

        </Stack>
      </Box>

      <div className="pt-modal-footer">
        <Text size="sm" c="dimmed">
          {totIncluse} {totIncluse === 1 ? "riga inclusa" : "righe incluse"} ·{" "}
          {colli.some((collo) => collo.ordini.some(ordineHaDatiVaccino))
            ? `${colli.length} ${colli.length === 1 ? "collo" : "colli"}`
            : `${colli.length} ${colli.length === 1 ? "spedizione" : "spedizioni"}`}
        </Text>
        <Group>
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          <Button
            color="accent"
            leftSection={<IconTruck size={16} />}
            loading={salvando}
            disabled={totIncluse === 0}
            onClick={salva}
          >
            Crea spedizione
          </Button>
        </Group>
      </div>
    </Box>
  );
}

const ColloSpedizioneCard = memo(function ColloSpedizioneCard({
  collo,
  perCollo,
  profiloCorriere,
  notaAperta,
  onNotaAperta,
  onPatch,
  onToggleRiga,
  onSetNumero,
  onApriOrdine,
}: {
  collo: Collo;
  perCollo: PerCollo;
  profiloCorriere: string;
  notaAperta: boolean;
  onNotaAperta: (key: string | null) => void;
  onPatch: (key: string, patch: Partial<PerCollo>) => void;
  onToggleRiga: (key: string, rigaId: string, incluso: boolean) => void;
  onSetNumero: (key: string, rigaId: string, numero: string) => void;
  onApriOrdine?: (ordineId: string) => void;
}) {
  const primo = collo.ordini[0];
  const indirizzoMancante = !primo.indirizzo || !primo.cap || !primo.citta;
  const residuoTot = collo.ordini.reduce((somma, ordine) => somma + ordine.residuo, 0);
  const haDatiVaccino = collo.ordini.some(ordineHaDatiVaccino);
  // Indirizzo su una riga, via inclusa: «Via Roma 12 · 81034 Mondragone (CE)».
  const indirizzo =
    [
      primo.indirizzo,
      [primo.cap, primo.citta].filter(Boolean).join(" ") + (primo.prov ? ` (${primo.prov})` : ""),
    ]
      .map((parte) => parte.trim())
      .filter(Boolean)
      .join(" · ") || "Indirizzo mancante";

  const rigaCheck = (riga: OrdineDaSpedire["righe"][number]) => {
    const incluso = !!perCollo.righeCheck[riga.rigaId];
    return (
      <Box key={riga.rigaId} className="pt-crea-spedizione-riga-prodotto">
        <Checkbox
          size="xs"
          aria-label={`Includi ${riga.prodottoNome || "prodotto"}`}
          checked={incluso}
          onChange={(evento) => onToggleRiga(collo.key, riga.rigaId, evento.currentTarget.checked)}
          style={{ marginTop: 5 }}
        />
        <Text
          size="sm"
          truncate
          c={incluso ? undefined : "dimmed"}
          onClick={() => onToggleRiga(collo.key, riga.rigaId, !incluso)}
          style={{ cursor: "pointer", minWidth: 0 }}
        >
          {riga.prodottoNome || "(prodotto)"}
          {riga.qta > 1 ? ` ×${riga.qta}` : ""}
          {riga.paziente ? (
            <Text span c="dimmed">
              {" "}
              · {riga.paziente}
            </Text>
          ) : null}
        </Text>
        {collo.ordini.some(
          (ordine) =>
            ordineHaDatiVaccino(ordine) &&
            ordine.righe.some((elemento) => elemento.rigaId === riga.rigaId),
        ) && (
          <NumeriLottoInput
            size="xs"
            placeholder="N. vaccino"
            aria-label={`Numero/lotto di ${riga.prodottoNome || "prodotto"}`}
            leftSection={<Text size="xs" c="dimmed">№</Text>}
            disabled={!incluso}
            value={perCollo.numeri[riga.rigaId] ?? ""}
            quantita={riga.qta}
            onChange={(numero) => onSetNumero(collo.key, riga.rigaId, numero)}
            style={{ minWidth: 0 }}
          />
        )}
      </Box>
    );
  };

  return (
    <Box className="pt-crea-spedizione-card" p="sm">
      {/* Riga 1 — intestazione: ordine + cliente a sinistra, controlli a destra */}
      <Group justify="space-between" wrap="nowrap" align="center" gap="sm">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {collo.unito ? (
            <Badge size="sm" variant="light" color="accent" style={{ flexShrink: 0 }}>
              {collo.ordini.length} ordini
            </Badge>
          ) : (
            <Badge size="sm" variant="light" style={{ flexShrink: 0 }}>
              {primo.numero || "—"}
            </Badge>
          )}
          <Text fw={600} size="sm" truncate>
            {primo.clienteNome || "(cliente)"}
          </Text>
        </Group>
        <Group gap={6} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          {haDatiVaccino && (
            <Tooltip label="Numero di colli" withinPortal zIndex={1500}>
              <NumberInput
                size="xs"
                aria-label="Numero di colli"
                w={70}
                min={1}
                leftSection={<Text size="xs" c="dimmed">×</Text>}
                value={profiloCorriere === "carrai" ? 1 : perCollo.colli}
                disabled={profiloCorriere === "carrai"}
                onChange={(valore) =>
                  onPatch(collo.key, {
                    colli: valore === "" ? "" : Number(valore),
                    colliAuto: false,
                  })
                }
              />
            </Tooltip>
          )}
          <Tooltip
            label={
              perCollo.preavviso
                ? "Preavviso telefonico: attivo"
                : "Preavviso telefonico: disattivato"
            }
            withinPortal
            zIndex={1500}
          >
            <ActionIcon
              size="lg"
              aria-label="Preavviso telefonico per questo collo"
              variant={perCollo.preavviso ? "light" : "subtle"}
              color={perCollo.preavviso ? "teal" : "gray"}
              onClick={() => onPatch(collo.key, { preavviso: !perCollo.preavviso })}
            >
              {perCollo.preavviso ? <IconPhone size={16} /> : <IconPhoneOff size={16} />}
            </ActionIcon>
          </Tooltip>
          <Popover
            opened={notaAperta}
            onChange={(aperto) => onNotaAperta(aperto ? collo.key : null)}
            position="bottom-end"
            withinPortal
            width={280}
            trapFocus
            zIndex={1450}
          >
            <Popover.Target>
              <Tooltip label="Note di spedizione" withinPortal zIndex={1500}>
                <Indicator size={7} color="teal" disabled={!perCollo.note} offset={4}>
                  <ActionIcon
                    size="lg"
                    aria-label="Note di spedizione per questo collo"
                    variant="subtle"
                    color="gray"
                    onClick={() => onNotaAperta(collo.key)}
                  >
                    <IconNote size={16} />
                  </ActionIcon>
                </Indicator>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              <Text size="sm" fw={500} mb={6}>
                Note di spedizione
              </Text>
              <Textarea
                value={perCollo.note}
                onChange={(evento) => onPatch(collo.key, { note: evento.currentTarget.value })}
                autosize
                minRows={2}
                maxRows={5}
                placeholder="Cosa vuole il cliente?"
              />
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Group>

      {/* Riga 2 — indirizzo (via inclusa) + telefono, con «Apri ordine» a destra */}
      <Group justify="space-between" wrap="nowrap" align="center" gap="sm" mt={6}>
        <Group
          gap={6}
          wrap="nowrap"
          style={{ minWidth: 0 }}
          c={indirizzoMancante ? "red" : "dimmed"}
        >
          <IconMapPin size={13} style={{ flexShrink: 0 }} />
          <Text size="xs" truncate>
            {indirizzo}
            {primo.telefono ? ` · ☎ ${primo.telefono}` : ""}
          </Text>
        </Group>
        {onApriOrdine && (
          // Indirizzo condiviso fra gli ordini uniti → un solo link (gli "apri" dei
          // singoli ordini stanno accanto ai rispettivi prodotti qui sotto).
          <Anchor
            component="button"
            type="button"
            size="xs"
            style={{ flexShrink: 0 }}
            onClick={() => onApriOrdine(primo.ordineId)}
          >
            <Group gap={3} wrap="nowrap">
              <IconExternalLink size={12} />
              {indirizzoMancante
                ? "Correggi indirizzo"
                : collo.unito
                  ? "Indirizzo"
                  : "Apri ordine"}
            </Group>
          </Anchor>
        )}
      </Group>

      {/* Riga 3 — pagamento alla consegna + residuo */}
      <Group wrap="nowrap" align="flex-end" gap="xs" mt={8}>
        <Select
          label="Pagamento alla consegna"
          size="xs"
          w={200}
          data={[
            { value: "prepagato", label: "Prepagato (nessuno)" },
            { value: "contrassegno", label: "Contrassegno" },
            { value: "assegno", label: "Assegno" },
          ]}
          value={perCollo.mezzo}
          onChange={(valore) =>
            onPatch(collo.key, { mezzo: (valore as Mezzo) || "prepagato" })
          }
          allowDeselect={false}
          comboboxProps={{ withinPortal: true, zIndex: 1400 }}
        />
        {perCollo.mezzo !== "prepagato" && (
          <NumberInput
            label="Importo €"
            size="xs"
            w={130}
            min={0}
            decimalScale={2}
            value={perCollo.importo}
            onChange={(valore) =>
              onPatch(collo.key, {
                importo: valore === "" ? "" : Number(valore),
                importoAuto: false,
              })
            }
          />
        )}
        {residuoTot > 0 && (
          <Badge size="sm" variant="light" color="orange" style={{ flexShrink: 0 }}>
            residuo € {centsToEurStr(residuoTot)}
          </Badge>
        )}
      </Group>

      {/* Riga 4 — prodotti da includere. Singolo = lista piatta; unito = griglia di
          blocchi per ordine (sfrutta lo spazio orizzontale, accorcia la card). */}
      {collo.unito ? (
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" verticalSpacing="xs" mt={8}>
          {collo.ordini.map((ordine) => (
            <Box key={ordine.ordineId} p={6} className="pt-crea-spedizione-ordine">
              <Group gap={4} wrap="nowrap" mb={2}>
                <Text size="xs" c="dimmed" fw={500} truncate>
                  Ordine {ordine.numero || "—"}
                </Text>
                {onApriOrdine && (
                  <Tooltip label="Apri ordine" withinPortal zIndex={1500}>
                    <Anchor
                      component="button"
                      type="button"
                      onClick={() => onApriOrdine(ordine.ordineId)}
                      style={{ display: "inline-flex", flexShrink: 0 }}
                      aria-label={`Apri ordine ${ordine.numero || ""}`}
                    >
                      <IconExternalLink size={12} />
                    </Anchor>
                  </Tooltip>
                )}
              </Group>
              {ordine.righe.map(rigaCheck)}
            </Box>
          ))}
        </SimpleGrid>
      ) : (
        <Stack gap={2} mt={8}>
          {primo.righe.map(rigaCheck)}
        </Stack>
      )}
    </Box>
  );
});
