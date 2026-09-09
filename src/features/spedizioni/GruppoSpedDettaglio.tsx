// Contenuto espandibile di un gruppo di spedizioni (lotto) in "Effettuate".
// È LAZY: alla PRIMA apertura del gruppo si calcola on-demand il riepilogo incassi (per
// conto + per agente, esclusi acconti, comando `spedizione_riepilogo`) e — dietro la stessa
// attesa col furgoncino — si rivelano anche i colli (così se sono molti non lampeggiano).
// Poi tutto in cache. «Crea distinta corriere» sta nella riga del gruppo (SpedizioniView).
// Per ogni collo: info al click (medico/agente/indirizzo/telefono/prodotti/note), annulla
// singolo e note di spedizione (matita).
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useIntersection } from "@mantine/hooks";
import {
  IconArrowMerge,
  IconArrowsSplit2,
  IconChevronDown,
  IconChevronRight,
  IconCreditCard,
  IconMapPin,
  IconMessage,
  IconPhone,
  IconPlus,
  IconStethoscope,
  IconTruckDelivery,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import {
  api,
  type Spedizione,
  type SpedizioneRiga,
  type SpedizioneRiepilogo,
} from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { dialog } from "../../ui/dialog/store";
import { centsToEurStr } from "../../lib/money";
import { formattaDataLocale } from "../../lib/date";
import { FurgoncinoLoader } from "./FurgoncinoLoader";
import {
  NoteSpedizionePopover,
  ContrassegnoSpedizionePopover,
  DatiSpedizionePopover,
} from "./ColloAzioni";
import {
  AggiungiColloModal,
  type CorriereAggiuntaCollo,
} from "./AggiungiColloModal";
import { vaiAllaPrincipale } from "../../shell/navigazione";
import {
  PremiumAction,
  canRunPremiumAction,
} from "../../premium/PremiumAction";
import { usePremiumAccess } from "../../premium/PremiumAccess";
import {
  apriComunicazione,
  datiPagamentoComunicazione,
  importoResiduoComunicazione,
  variabiliNomeDestinatario,
} from "../comunicazioni/apriComunicazione";
import {
  rigaHaDatiVaccino,
  spedizioneHaDatiVaccino,
} from "./datiVaccino";

// Cache del riepilogo per lotto (evita di rifare calcolo+animazione riaprendo lo stesso
// gruppo). Va svuotata quando i dati cambiano (annullo/note/aggiunte) → `clearRiepilogoCache`.
const cache = new Map<string, SpedizioneRiepilogo>();
export function clearRiepilogoCache() {
  cache.clear();
}

const eur = (c: number) => `€ ${centsToEurStr(c)}`;
const mezzoLabel = (m: string) =>
  m === "assegno" ? "Assegno" : "Contrassegno";
const SOGLIA_LAZY_COLLI = 12;

function normalizzaDestinatario(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function chiaveDestinatario(s: Spedizione): string {
  if (s.clienteId) return `cliente:${s.clienteId}`;
  return [s.clienteNome, s.indirizzo, s.cap, s.citta, s.prov, s.regione]
    .map(normalizzaDestinatario)
    .join("|");
}

function chiaveCorriere(s: Spedizione): string {
  return (
    s.corriereId || normalizzaDestinatario(s.corriereNome || s.corriereProfilo)
  );
}

function nomeCorriere(s: Spedizione): string {
  return s.corriereNome || s.corriereProfilo.toUpperCase() || "Corriere";
}

function indirizzoDestinatario(s: Spedizione): string {
  return [
    s.indirizzo,
    [s.cap, s.citta].filter(Boolean).join(" "),
    s.prov ? `(${s.prov})` : "",
    s.regione,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const GruppoSpedDettaglio = memo(function GruppoSpedDettaglio({
  spedizioni,
  lotto,
  unito = false,
  onAnnullaCollo,
  onSepara,
  onModificato,
  onAvvisaGruppo,
  matchIds,
}: {
  spedizioni: Spedizione[];
  lotto: string;
  /** Gruppo frutto di un'unione di lotti: mostra «Separa». */
  unito?: boolean;
  onAnnullaCollo: (s: Spedizione) => void;
  onSepara?: (lotto: string) => void;
  onModificato: (spedizione?: Spedizione) => void;
  onAvvisaGruppo: (spedizioni: Spedizione[]) => void;
  matchIds?: Set<string>;
}) {
  // Chiave cache = lotto + firma dei colli/righe: se il gruppo cambia (annullo/aggiunta) la
  // chiave cambia → si ricalcola il riepilogo invece di mostrare quello vecchio. FASE 7.
  const chiave = `${lotto}|${spedizioni.map((s) => `${s.id}:${s.nRighe}`).join(",")}`;
  const [riep, setRiep] = useState<SpedizioneRiepilogo | null>(
    cache.get(chiave) ?? null,
  );
  const [loading, setLoading] = useState(!cache.has(chiave));
  const [agenteAperto, setAgenteAperto] = useState<string | null>(null);
  const [aggiungiAperto, setAggiungiAperto] = useState(false);
  const [destinatariAperto, setDestinatariAperto] = useState(false);
  const vivo = useRef(true);
  const mostraCorriereSuColli = useMemo(() => {
    const corrieri = new Set(spedizioni.map(chiaveCorriere).filter(Boolean));
    return corrieri.size > 1;
  }, [spedizioni]);
  const corrieriAggiunta = useMemo<CorriereAggiuntaCollo[]>(() => {
    const map = new Map<string, CorriereAggiuntaCollo>();
    for (const s of spedizioni) {
      if (!s.corriereId || map.has(s.corriereId)) continue;
      map.set(s.corriereId, {
        id: s.corriereId,
        nome: nomeCorriere(s),
        profilo: s.corriereProfilo || "gls",
      });
    }
    return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  }, [spedizioni]);

  const gruppiUnibili = useMemo(() => {
    const map = new Map<string, Spedizione[]>();
    for (const s of spedizioni) {
      const destinatarioKey = chiaveDestinatario(s);
      if (!destinatarioKey.replace(/[|]/g, "")) continue;
      const key = `${destinatarioKey}|corriere:${chiaveCorriere(s)}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(s);
    }
    return [...map.values()]
      .filter((arr) => arr.length > 1)
      .map((arr) => ({
        key: arr.map((s) => s.id).join(":"),
        spedizioni: arr,
        nome: arr[0].clienteNome || "(destinatario)",
        indirizzo: indirizzoDestinatario(arr[0]),
        corriere: nomeCorriere(arr[0]),
        colli: arr.reduce((n, s) => n + Math.max(1, s.colli || 0), 0),
        haDatiVaccino: arr.some(spedizioneHaDatiVaccino),
        contrassegno: arr.reduce((n, s) => n + s.contrassegno, 0),
      }));
  }, [spedizioni]);

  const destinatariSeparabili = useMemo(
    () => spedizioni.filter((s) => s.destinatariUniti),
    [spedizioni],
  );
  const puoGestireDestinatari =
    gruppiUnibili.length > 0 || destinatariSeparabili.length > 0;
  const labelDestinatari =
    gruppiUnibili.length > 0 && destinatariSeparabili.length > 0
      ? "Unisci / separa"
      : destinatariSeparabili.length > 0
        ? "Separa destinatari"
        : "Unisci destinatari";

  useEffect(() => {
    vivo.current = true;
    if (cache.has(chiave)) return;
    const inizio = Date.now();
    api
      .spedizioneRiepilogo(lotto)
      .then(async (r) => {
        const attesa = Math.max(0, 800 - (Date.now() - inizio));
        await new Promise((res) => setTimeout(res, attesa));
        if (!vivo.current) return;
        cache.set(chiave, r);
        setRiep(r);
        setLoading(false);
      })
      .catch(() => vivo.current && setLoading(false));
    return () => {
      vivo.current = false;
    };
  }, [chiave, lotto]);

  async function unisciDestinatari(ids: string[]) {
    try {
      await api.spedizioneDestinatariUnisci(ids);
      toast.success("Destinatari uniti.");
      setDestinatariAperto(false);
      onModificato();
    } catch (err) {
      toast.error(`Unione destinatari non riuscita: ${err}`);
    }
  }

  async function separaDestinatario(id: string) {
    try {
      await api.spedizioneDestinatariSepara(id);
      toast.success("Destinatari separati.");
      setDestinatariAperto(false);
      onModificato();
    } catch (err) {
      toast.error(`Separazione destinatari non riuscita: ${err}`);
    }
  }

  return (
    <Box className="pt-spedizione-expanded" px="lg" py="sm" bg="var(--bg)">
      {loading || !riep ? (
        <FurgoncinoLoader />
      ) : (
        <>
          <Group justify="flex-end" gap="xs" mb={6}>
            {puoGestireDestinatari && (
              <Button
                size="compact-sm"
                variant="light"
                color="accent"
                leftSection={<IconArrowMerge size={14} />}
                onClick={() => setDestinatariAperto(true)}
              >
                {labelDestinatari}
              </Button>
            )}
            {unito && onSepara && (
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                leftSection={<IconArrowsSplit2 size={14} />}
                onClick={() => onSepara(lotto)}
              >
                Separa
              </Button>
            )}
            <PremiumAction
              leftSection={<IconMessage size={14} />}
              buttonVariant="subtle"
              buttonColor="accent"
              buttonSize="compact-sm"
              lockedPresentation="modal"
              title="Funzionalità extra"
              message="La preparazione e l’invio coordinato degli avvisi a tutti i clienti di questa spedizione è disponibile tra le funzionalità extra."
              style={{ whiteSpace: "nowrap" }}
              onAction={() => onAvvisaGruppo(spedizioni)}
            >
              Avvisa clienti
            </PremiumAction>
            <Button
              size="compact-sm"
              variant="subtle"
              color="accent"
              leftSection={<IconPlus size={14} />}
              onClick={() => setAggiungiAperto(true)}
            >
              {spedizioni.some(spedizioneHaDatiVaccino)
                ? "Aggiungi collo"
                : "Aggiungi spedizione"}
            </Button>
          </Group>
          <Stack gap={4} mb="sm">
            {spedizioni.map((s) => {
              const props = {
                s,
                inEvidenza: matchIds?.has(s.id) ?? false,
                mostraCorriere: mostraCorriereSuColli,
                onAnnulla: () => onAnnullaCollo(s),
                onModificato,
              };
              return spedizioni.length > SOGLIA_LAZY_COLLI ? (
                <ColloRigaLazy key={s.id} {...props} />
              ) : (
                <ColloRiga key={s.id} {...props} />
              );
            })}
          </Stack>

          <Box
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
              paddingTop: 10,
            }}
          >
            <Group justify="space-between" align="baseline" mb={6}>
              <Group gap={8} align="baseline">
                <Text size="sm" fw={600}>
                  Riepilogo incassi
                </Text>
                <Text size="xs" c="dimmed">
                  esclusi gli acconti
                </Text>
              </Group>
              <Button
                size="compact-sm"
                variant="light"
                color="accent"
                leftSection={<IconCreditCard size={14} />}
                onClick={() =>
                  vaiAllaPrincipale({
                    path: "/contabilita",
                    tab: "pagamenti",
                    spedizioneLotti: [lotto],
                  })
                }
              >
                Visualizza crediti
              </Button>
            </Group>

            <Table withRowBorders={false} verticalSpacing={4} fz="sm">
              <Table.Thead>
                <Table.Tr c="dimmed">
                  <Table.Th fw={400}>Conto</Table.Th>
                  <Table.Th fw={400} ta="right">
                    Già incassato
                  </Table.Th>
                  <Table.Th fw={400} ta="right">
                    Da incassare
                  </Table.Th>
                  <Table.Th fw={400} ta="right">
                    Totale
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {riep.perConto.map((c) => (
                  <Table.Tr
                    key={c.contoId}
                    style={{
                      borderTop:
                        "1px solid var(--mantine-color-default-border)",
                    }}
                  >
                    <Table.Td>
                      <Badge
                        size="sm"
                        variant="light"
                        color={
                          c.contoTipo === "contrassegno"
                            ? "grape"
                            : c.contoTipo === "assegno"
                              ? "violet"
                              : "blue"
                        }
                      >
                        {c.contoNome || "(conto)"}
                      </Badge>
                    </Table.Td>
                    <Table.Td
                      ta="right"
                      c={c.giaIncassato ? undefined : "dimmed"}
                    >
                      {eur(c.giaIncassato)}
                    </Table.Td>
                    <Table.Td ta="right">{eur(c.daIncassare)}</Table.Td>
                    <Table.Td ta="right" fw={500}>
                      {eur(c.totale)}
                    </Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr
                  style={{
                    borderTop: "1px solid var(--mantine-color-default-border)",
                  }}
                >
                  <Table.Td fw={500}>Totale</Table.Td>
                  <Table.Td ta="right">{eur(riep.giaIncassato)}</Table.Td>
                  <Table.Td ta="right">{eur(riep.daIncassare)}</Table.Td>
                  <Table.Td ta="right" fw={500}>
                    {eur(riep.totale)}
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>

            {riep.perAgente.length > 0 && (
              <Box mt="sm">
                <Text size="xs" c="dimmed" mb={6}>
                  Per agente
                </Text>
                <Group gap={8}>
                  {riep.perAgente.map((a) => {
                    const sel = agenteAperto === a.agenteId;
                    return (
                      <Button
                        key={a.agenteId}
                        size="compact-sm"
                        variant={sel ? "light" : "default"}
                        color={sel ? "accent" : "gray"}
                        rightSection={
                          sel ? (
                            <IconChevronDown size={13} />
                          ) : (
                            <IconChevronRight size={13} />
                          )
                        }
                        onClick={() => setAgenteAperto(sel ? null : a.agenteId)}
                      >
                        {a.agenteNome} · <b>{eur(a.totale)}</b>
                        <Text span c="dimmed" ml={4}>
                          (già {centsToEurStr(a.giaIncassato)} · da{" "}
                          {centsToEurStr(a.daIncassare)})
                        </Text>
                      </Button>
                    );
                  })}
                </Group>
                {riep.perAgente
                  .filter((a) => a.agenteId === agenteAperto)
                  .map((a) => (
                    <Box
                      key={a.agenteId}
                      mt={8}
                      p="xs"
                      style={{
                        background: "var(--mantine-color-default-hover)",
                        borderRadius: 8,
                      }}
                    >
                      <Text size="xs" c="dimmed" mb={4}>
                        {a.agenteNome} · da questa spedizione (esclusi acconti)
                      </Text>
                      <Table withRowBorders={false} verticalSpacing={2} fz="sm">
                        <Table.Tbody>
                          {a.conti.map((c) => (
                            <Table.Tr key={c.contoId}>
                              <Table.Td>{c.contoNome}</Table.Td>
                              <Table.Td ta="right" c="dimmed">
                                già {eur(c.giaIncassato)}
                              </Table.Td>
                              <Table.Td ta="right">
                                da {eur(c.daIncassare)}
                              </Table.Td>
                              <Table.Td ta="right" fw={500}>
                                tot {eur(c.totale)}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Box>
                  ))}
              </Box>
            )}
          </Box>
        </>
      )}

      <Modal
        opened={destinatariAperto}
        onClose={() => setDestinatariAperto(false)}
        title={<Text fw={700}>Unisci / separa destinatari</Text>}
        size="lg"
        zIndex={1350}
        transitionProps={{ transition: "fade", duration: 180 }}
      >
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="md">
              {gruppiUnibili.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Destinatari unibili
                  </Text>
                  {gruppiUnibili.map((g) => (
                    <Box
                      key={g.key}
                      p="sm"
                      style={{
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: 8,
                        background: "var(--mantine-color-default-hover)",
                      }}
                    >
                      <Group
                        justify="space-between"
                        align="flex-start"
                        wrap="nowrap"
                        gap="sm"
                      >
                        <Group
                          gap="sm"
                          align="flex-start"
                          wrap="nowrap"
                          style={{ minWidth: 0 }}
                        >
                          <Checkbox
                            checked
                            readOnly
                            mt={3}
                            aria-label="Destinatari selezionati per l'unione"
                          />
                          <Box style={{ minWidth: 0 }}>
                            <Group gap={6} wrap="wrap">
                              <Text fw={700} size="sm">
                                {g.nome}
                              </Text>
                              <Badge size="sm" variant="light" color="accent">
                                {g.spedizioni.length}{" "}
                                {g.haDatiVaccino
                                  ? "colli"
                                  : g.spedizioni.length === 1
                                    ? "spedizione"
                                    : "spedizioni"}
                              </Badge>
                              <Badge
                                size="sm"
                                variant="light"
                                color="indigo"
                                leftSection={<IconTruckDelivery size={10} />}
                              >
                                {g.corriere}
                              </Badge>
                              {g.haDatiVaccino && (
                                <Badge size="sm" variant="light" color="gray">
                                  {g.colli} {g.colli === 1 ? "collo" : "colli"}{" "}
                                  totali
                                </Badge>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed" truncate>
                              {g.indirizzo || "Destinatario senza indirizzo"}
                            </Text>
                            {g.contrassegno > 0 && (
                              <Text size="xs" c="dimmed">
                                Alla consegna: {eur(g.contrassegno)}
                              </Text>
                            )}
                          </Box>
                        </Group>
                        <Button
                          size="compact-sm"
                          color="accent"
                          leftSection={<IconArrowMerge size={14} />}
                          onClick={() =>
                            unisciDestinatari(g.spedizioni.map((s) => s.id))
                          }
                        >
                          Unisci
                        </Button>
                      </Group>
                    </Box>
                  ))}
                </Stack>
              )}

          {gruppiUnibili.length > 0 && destinatariSeparabili.length > 0 && <Divider />}

          {destinatariSeparabili.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Destinatari già uniti
              </Text>
              {destinatariSeparabili.map((s) => (
                <Box
                  key={s.id}
                  p="sm"
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: 8,
                    background: "var(--mantine-color-body)",
                  }}
                >
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Box style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="wrap">
                        <Text fw={700} size="sm">
                          {s.clienteNome || "(destinatario)"}
                        </Text>
                        <Badge size="sm" variant="light" color="accent">
                          unito
                        </Badge>
                        <Badge size="sm" variant="light" color="indigo" leftSection={<IconTruckDelivery size={10} />}>
                          {nomeCorriere(s)}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" truncate>
                        {indirizzoDestinatario(s) || "Destinatario senza indirizzo"}
                      </Text>
                    </Box>
                    <Button
                      size="compact-sm"
                      variant="light"
                      color="gray"
                      leftSection={<IconArrowsSplit2 size={14} />}
                      onClick={() => separaDestinatario(s.id)}
                    >
                      Separa
                    </Button>
                  </Group>
                </Box>
              ))}
            </Stack>
          )}

              {!puoGestireDestinatari && (
                <Text size="sm" c="dimmed">
                  Non ci sono destinatari doppi in questo gruppo.
                </Text>
              )}
            </Stack>
          </Box>
        </Box>
      </Modal>

      <AggiungiColloModal
        lotto={aggiungiAperto ? lotto : null}
        data={spedizioni[0]?.data ?? ""}
        corrieri={corrieriAggiunta}
        onClose={() => setAggiungiAperto(false)}
        onDone={() => {
          setAggiungiAperto(false);
          onModificato();
        }}
      />
    </Box>
  );
});

const ColloRigaLazy = memo(function ColloRigaLazy(
  props: React.ComponentProps<typeof ColloRiga>,
) {
  const { ref, entry } = useIntersection({
    root: null,
    rootMargin: "700px 0px 700px 0px",
    threshold: 0,
  });
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [altezza, setAltezza] = useState(38);
  const visibile = entry?.isIntersecting ?? false;

  useLayoutEffect(() => {
    if (!visibile || !innerRef.current) return;
    const h = innerRef.current.offsetHeight;
    if (h > 0 && Math.abs(h - altezza) > 0.5) setAltezza(h);
  });

  return (
    <Box ref={ref}>
      {visibile ? (
        <Box ref={innerRef}>
          <ColloRiga {...props} />
        </Box>
      ) : (
        <Box h={altezza} aria-hidden />
      )}
    </Box>
  );
});

const ColloRiga = memo(function ColloRiga({
  s,
  inEvidenza = false,
  mostraCorriere = false,
  onAnnulla,
  onModificato,
}: {
  s: Spedizione;
  inEvidenza?: boolean;
  mostraCorriere?: boolean;
  onAnnulla: () => void;
  onModificato: (spedizione?: Spedizione) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const premium = usePremiumAccess();
  const haDatiVaccino = spedizioneHaDatiVaccino(s);
  const comunica = async () => {
    try {
      const ordini = [
        ...new Set(s.righe.map((riga) => riga.ordineNumero).filter(Boolean)),
      ];
      const data = s.data
        ? formattaDataLocale(new Date(`${s.data}T12:00:00`))
        : "";
      const conti = await api.recordsList("conto");
      const pagamenti = s.pagamenti.filter((pagamento) => !pagamento.saldato);
      await apriComunicazione({
        destinatarioEntita: "cliente",
        destinatarioId: s.clienteId,
        destinatarioNome: s.clienteNome,
        email: s.email,
        telefono: s.telefono,
        tipo: "preavviso_spedizione",
        origineEntita: "spedizione",
        origineId: s.id,
        origineFingerprint: s.comunicazioneFingerprint ?? "",
        variabili: {
          ...variabiliNomeDestinatario(s.clienteNome),
          nome_medico: s.medicoNome,
          nome_agente: s.agenteNome,
          riferimento_ordine: ordini.join(", "),
          data_spedizione: data,
          data_spedizione_iso: s.data,
          corriere: nomeCorriere(s),
          tracking: s.numero || "sarà comunicato dal corriere",
          importo_residuo: importoResiduoComunicazione(
            pagamenti.reduce(
              (totale, pagamento) => totale + pagamento.importo,
              0,
            ),
          ),
          ...datiPagamentoComunicazione(
            pagamenti,
            conti,
            "Nessun pagamento richiesto alla consegna.",
          ),
        },
      });
    } catch (error) {
      toast.error(`Apertura dell'avviso non riuscita: ${error}`);
    }
  };

  return (
    <Box className={inEvidenza ? "pt-search-match" : undefined}>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <UnstyledButton
          onClick={() => setAperto((v) => !v)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group gap={8} wrap="nowrap">
            {aperto ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
            <Text fw={600} size="sm" truncate>
              {s.clienteNome || "(cliente)"}
            </Text>
            {haDatiVaccino && (
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {s.colli} {s.colli === 1 ? "collo" : "colli"}
              </Text>
            )}
            {mostraCorriere && (
              <Badge
                size="sm"
                variant="light"
                color="indigo"
                leftSection={<IconTruckDelivery size={10} />}
              >
                {nomeCorriere(s)}
              </Badge>
            )}
            {s.preavviso && (
              <ThemeIcon
                size={18}
                radius="xl"
                variant="light"
                color="teal"
                title="Preavviso telefonico"
              >
                <IconPhone size={11} />
              </ThemeIcon>
            )}
            {haDatiVaccino && s.numero && (
              <Badge size="sm" variant="default">
                n° {s.numero}
              </Badge>
            )}
            {s.mezzo && (
              <Badge
                size="sm"
                variant="light"
                color={s.mezzo === "assegno" ? "violet" : "grape"}
              >
                {mezzoLabel(s.mezzo)} {eur(s.contrassegno)}
              </Badge>
            )}
          </Group>
        </UnstyledButton>
        <Group gap={2} wrap="nowrap">
          {s.clienteId && canRunPremiumAction(premium) && (
            <Tooltip label="Avvisa" withArrow openDelay={350}>
              <Box>
                <PremiumAction
                  ariaLabel="Avvisa"
                  iconOnly
                  leftSection={<IconMessage size={15} />}
                  style={{
                    background: "transparent",
                    borderColor: "transparent",
                    height: 26,
                    minHeight: 26,
                    padding: 0,
                    width: 26,
                  }}
                  onAction={comunica}
                >
                  Avvisa
                </PremiumAction>
              </Box>
            </Tooltip>
          )}
          <ContrassegnoSpedizionePopover
            spedizioneId={s.id}
            ordineId={s.righe[0]?.ordineId}
            spedizioneData={s.data}
            mezzo={s.mezzo}
            contrassegno={s.contrassegno}
            onSalvato={onModificato}
          />
          <DatiSpedizionePopover spedizione={s} onSalvato={onModificato} />
          <NoteSpedizionePopover
            spedizioneId={s.id}
            nota={s.note}
            onSalvato={onModificato}
          />
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            leftSection={<IconX size={13} />}
            onClick={onAnnulla}
          >
            {haDatiVaccino ? "Annulla collo" : "Annulla spedizione"}
          </Button>
        </Group>
      </Group>
      <Collapse expanded={aperto}>
        <Box
          ml={22}
          my={6}
          p="xs"
          style={{
            background: "var(--mantine-color-default-hover)",
            borderRadius: 8,
          }}
        >
          <Group gap="md" wrap="wrap" style={{ rowGap: 4 }}>
            <Info
              Ico={IconStethoscope}
              etichetta="Medico"
              valore={s.medicoNome}
            />
            <Info Ico={IconUser} etichetta="Agente" valore={s.agenteNome} />
            <Info Ico={IconPhone} etichetta="Tel" valore={s.telefono} />
            <Info
              Ico={IconMapPin}
              etichetta="Indirizzo"
              valore={
                [
                  s.indirizzo,
                  [s.cap, s.citta].filter(Boolean).join(" "),
                  s.prov ? `(${s.prov})` : "",
                  s.regione,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"
              }
            />
            <Group
              gap={4}
              wrap="wrap"
              align="baseline"
              style={{ rowGap: 2 }}
            >
              <Text size="xs" c="dimmed">
                Prodotti:
              </Text>
              {s.righe.map((r, i) => (
                <ProdottoRimovibile
                  key={r.rigaId}
                  r={r}
                  ultimo={i === s.righe.length - 1}
                  onModificato={onModificato}
                />
              ))}
            </Group>
          </Group>
          {s.note && (
            <Group gap={6} mt={4} wrap="nowrap">
              <IconTruckDelivery
                size={13}
                color="var(--mantine-color-dimmed)"
              />
              <Text size="xs" c="dimmed">
                Note:{" "}
                <Text span c="bright">
                  {s.note}
                </Text>
              </Text>
            </Group>
          )}
          {s.pagamenti && s.pagamenti.length > 0 && (
            <Group
              gap={6}
              mt={8}
              wrap="wrap"
              style={{
                borderTop: "1px dashed var(--border, #e9ecef)",
                paddingTop: 6,
              }}
            >
              <IconCreditCard size={13} color="var(--mantine-color-dimmed)" />
              <Text
                size="xs"
                c="dimmed"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                Incasso previsto:
              </Text>
              {s.pagamenti.map((p, idx) => {
                const statusLabel = p.saldato ? "pagato" : "da saldare";
                const statusColor = p.saldato ? "teal" : "orange";
                const dataStato = p.saldato
                  ? ""
                  : p.scadenza
                    ? ` entro il ${formattaDataIta(p.scadenza)}`
                    : "";
                const bankInfo = p.contoNome
                  ? ` su ${p.contoNome.replace(/Banca Demo\s+|Poste\s+/i, "")}`
                  : "";
                return (
                  <Badge
                    key={idx}
                    size="xs"
                    variant={p.saldato ? "light" : "outline"}
                    color={statusColor}
                    title={`${p.tipo.toUpperCase()}${dataStato}`}
                  >
                    {p.tipo.toUpperCase()}: € {centsToEurStr(p.importo)}
                    {bankInfo} ({statusLabel})
                  </Badge>
                );
              })}
            </Group>
          )}
        </Box>
      </Collapse>
    </Box>
  );
});

/** Un prodotto del collo: clic → (conferma) → torna fra quelli «da spedire». Diventa rosso
 * al passaggio del mouse, con suggerimento. Mostra il suo numero/lotto se presente. FASE 7. */
function ProdottoRimovibile({
  r,
  ultimo,
  onModificato,
}: {
  r: SpedizioneRiga;
  ultimo: boolean;
  onModificato: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [rimuovendo, setRimuovendo] = useState(false);
  const haDatiVaccino = rigaHaDatiVaccino(r);
  const etichetta = `${r.prodottoNome || "(prodotto)"}${r.qta > 1 ? ` ×${r.qta}` : ""}${
    haDatiVaccino && r.numero ? ` · n° ${r.numero}` : ""
  }`;
  const rimuovi = async () => {
    const ok = await dialog.confirm(
      `Rimuovere il prodotto ${haDatiVaccino ? "dal collo" : "dalla spedizione"}?`,
      `«${r.prodottoNome || "prodotto"}» tornerà fra quelli da spedire. Se è l’ultimo, la spedizione viene annullata.`,
      { conferma: "Rimuovi" },
    );
    if (!ok) return;
    setRimuovendo(true);
    try {
      await api.spedizioneRigaRimuovi(r.rigaId);
      toast.success("Prodotto rimosso dalla spedizione.");
      onModificato();
    } catch (err) {
      toast.error(`Rimozione non riuscita: ${err}`);
    } finally {
      setRimuovendo(false);
    }
  };
  return (
    <Tooltip label="Clicca per rimuovere dalla spedizione" withArrow openDelay={250}>
      <UnstyledButton
        onClick={rimuovi}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        disabled={rimuovendo}
        style={{
          alignItems: "baseline",
          display: "inline-flex",
          lineHeight: "inherit",
          verticalAlign: "baseline",
        }}
      >
        <Text
          span
          size="xs"
          c={hover ? "red" : "dimmed"}
          td={hover ? "line-through" : undefined}
          style={{ transition: "color 120ms" }}
        >
          {etichetta}
          {ultimo ? "" : ","}
        </Text>
      </UnstyledButton>
    </Tooltip>
  );
}

function Info({
  Ico,
  etichetta,
  valore,
}: {
  Ico: typeof IconUser;
  etichetta: string;
  valore: string;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <ThemeIcon size={18} radius="xl" variant="light" color="gray">
        <Ico size={11} />
      </ThemeIcon>
      <Text size="xs" c="dimmed">
        {etichetta}:{" "}
        <Text span c="bright" fw={500}>
          {valore || "—"}
        </Text>
      </Text>
    </Group>
  );
}

function formattaDataIta(iso: string): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
