// Bacheca promemoria del team + to-do dei marcatori (FASE 6C). Componente
// riutilizzabile: la dashboard la usa nella variante completa (sezioni «Da fare»
// + «Promemoria»); editor ordine e Riepilogo la usano in variante `compatta`/
// `collegato` (solo i promemoria di quell'entità, pre-collegando i nuovi). In 6D
// la stessa bacheca entrerà nel pop-over campanella senza modifiche.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Popover,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconBell,
  IconBellPlus,
  IconBellRinging,
  IconCalendarPlus,
  IconCheck,
  IconCircleCheckFilled,
  IconClipboardCheck,
  IconClock,
  IconExternalLink,
  IconPencil,
  IconReceiptRefund,
  IconRepeat,
  IconSend,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import { api, inTauri, type Identity, type OrdineDto, type Rimborso, type UserDto } from "../../lib/tauri";
import { usePrefs } from "../../lib/prefs";
import { centsToEurStr } from "../../lib/money";
import { apriFinestraPromemoria } from "./apriFinestraPromemoria";
import { toast } from "../../ui/toast/store";
import { MARCATORI, marcatoreDef } from "../giornaliero/marcatori";
import { statoDef } from "../giornaliero/stati";
import { apriFinestraOrdine } from "../giornaliero/apriFinestra";
import {
  RimborsoModal,
  SegnaEffettuatoModal,
  type RimborsoModalTarget,
} from "../contabilita/RimborsoModal";
import { apriRiepilogo, type TipoRiepilogo } from "../../shell/apriRiepilogo";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { derivaNotifiche, riattivaNotifichePerUtenti, type Notifica } from "../notifiche/notifiche";
import {
  COLLEGATO_META,
  completaPromemoria,
  isoLocale,
  listaPromemoria,
  ordinaPromemoria,
  posticipaPromemoria,
  prioritaDef,
  statoScadenza,
  type Collegato,
  type Promemoria,
  type StatoScadenza,
} from "./promemoria";
import { PromemoriaModal, type PromemoriaTarget } from "./PromemoriaModal";
import { useAnimazioniRidotte } from "../../ui/motion";
import { useRicaricaSuEventi } from "../../lib/useRicaricaSuEventi";
import { oggiIso } from "../../lib/date";

const EVENTI_RICARICA = [
  "promemoria:salvato",
  "ordine:salvato",
  "pagamento:salvato",
  "rimborso:salvato",
  "cliente:salvato",
  "conto:salvato",
  "medico:salvato",
  "agente:salvato",
] as const;

const COLORE_STATO: Record<StatoScadenza, string> = {
  scaduto: "red",
  oggi: "orange",
  presto: "yellow",
  futuro: "gray",
  nessuna: "gray",
};

const CATEGORIE_NOTIFICA = [
  { value: "solleciti", label: "Pagamenti scaduti" },
  { value: "segnalazioni", label: "Da fare" },
  { value: "promemoria", label: "Promemoria" },
] as const;
type CategoriaNotifica = (typeof CATEGORIE_NOTIFICA)[number]["value"];

function categoriaDiNotifica(n: Notifica): CategoriaNotifica | null {
  if (n.tipo === "sollecito") return "solleciti";
  if (n.tipo === "marcatore") return "segnalazioni";
  if (n.tipo === "promemoria_scaduto" || n.tipo === "promemoria_scadenza") return "promemoria";
  return null;
}

function utentiUnici(users: UserDto[], identity?: Identity): UserDto[] {
  const m = new Map<string, UserDto>();
  if (identity?.userId) {
    m.set(identity.userId, {
      id: identity.userId,
      nome: identity.nome,
      avatarTipo: identity.avatarTipo,
      avatarValore: identity.avatarValore,
    });
  }
  users.forEach((u) => {
    if (u.id) m.set(u.id, u);
  });
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

function nelloAnnoGlobale(data: string, anno: number): boolean {
  return anno === 0 || (!!data && Number(data.slice(0, 4)) === anno);
}

function filtraPromemoriaPerAnno(promemoria: Promemoria[], ordiniAnno: OrdineDto[], anno: number): Promemoria[] {
  if (anno === 0) return promemoria;
  const ordiniIds = new Set(ordiniAnno.map((o) => o.id));
  return promemoria.filter((p) => {
    if (p.collegatoTipo === "ordine" && p.collegatoId) return ordiniIds.has(p.collegatoId);
    if (p.scadenza) return nelloAnnoGlobale(p.scadenza, anno);
    return true;
  });
}

/** Etichetta umana della scadenza in base allo stato. */
function etichettaScadenza(scadenza: string, stato: StatoScadenza): string {
  if (stato === "nessuna") return "senza scadenza";
  if (stato === "oggi") return "Oggi";
  if (!scadenza) return "—";
  const [y, m, d] = scadenza.split("-");
  const breve = `${d}/${m}/${y}`;
  if (stato === "scaduto") return `Scaduto · ${breve}`;
  return breve;
}

function dataBreve(scadenza: unknown): string {
  if (typeof scadenza !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scadenza)) return "";
  const [y, m, d] = scadenza.split("-");
  return `${d}/${m}/${y}`;
}

export function BachecaPromemoria({
  identity,
  collegato,
  compatta = false,
  onApriOrdine,
  onAzione,
  azioneCompatta,
}: {
  identity?: Identity;
  /** Mostra solo i promemoria di questa entità (e pre-collega i nuovi). */
  collegato?: Collegato;
  /** Variante leggera (senza Card) per finestre/editor. */
  compatta?: boolean;
  onApriOrdine?: (id: string, numero?: string) => void;
  /** Chiamato prima delle azioni: il riepilogo modale lo usa per chiudersi. */
  onAzione?: () => void;
  /** Azione contestuale affiancata a «Promemoria» nella sola variante compatta. */
  azioneCompatta?: ReactNode;
}) {
  const soloPromemoria = !!collegato || compatta;
  const ridotte = useAnimazioniRidotte();

  const [promemoria, setPromemoria] = useState<Promemoria[] | null>(null);
  const [ordini, setOrdini] = useState<OrdineDto[] | null>(null);
  const [rimborsi, setRimborsi] = useState<Rimborso[] | null>(null);
  const [target, setTarget] = useState<PromemoriaTarget | null>(null);
  const [rimborsoTarget, setRimborsoTarget] =
    useState<RimborsoModalTarget | null>(null);
  const [effettuaTarget, setEffettuaTarget] = useState<Rimborso | null>(null);
  const [espansoId, setEspansoId] = useState<string | null>(null);
  const [modalNotificaAperto, setModalNotificaAperto] = useState(false);
  // Id "in uscita" (completati): restano renderizzati per l'animazione di check.
  const [uscentiP, setUscentiP] = useState<Set<string>>(new Set());
  const [uscentiM, setUscentiM] = useState<Set<string>>(new Set());

  const carica = useCallback(async () => {
    try {
      const list = await listaPromemoria();
      setPromemoria(list);
    } catch {
      setPromemoria([]);
    }
    if (!soloPromemoria) {
      const [ordiniResult, rimborsiResult] = await Promise.allSettled([
        api.ordiniLista(),
        api.rimborsiLista("richiesto"),
      ]);
      setOrdini(ordiniResult.status === "fulfilled" ? ordiniResult.value : []);
      setRimborsi(rimborsiResult.status === "fulfilled" ? rimborsiResult.value : []);
    } else {
      setOrdini([]);
      setRimborsi([]);
    }
    setUscentiP(new Set());
    setUscentiM(new Set());
  }, [soloPromemoria]);

  useEffect(() => {
    void carica();
  }, [carica]);

  // Si aggiorna quando un promemoria o un ordine viene salvato altrove.
  useRicaricaSuEventi(EVENTI_RICARICA, carica);

  // Promemoria aperti (fatto=false), eventualmente filtrati sull'entità collegata.
  const ordiniVivi = useMemo(() => new Set((ordini ?? []).map((o) => o.id)), [ordini]);
  const aperti = useMemo(() => {
    let list = (promemoria ?? []).filter((p) => !p.fatto);
    if (!soloPromemoria && ordini) {
      list = list.filter((p) => p.collegatoTipo !== "ordine" || !p.collegatoId || ordiniVivi.has(p.collegatoId));
    }
    if (collegato) list = list.filter((p) => p.collegatoTipo === collegato.tipo && p.collegatoId === collegato.id);
    return ordinaPromemoria(list);
  }, [promemoria, collegato, soloPromemoria, ordini, ordiniVivi]);

  useEffect(() => {
    if (espansoId && !aperti.some((p) => p.id === espansoId)) setEspansoId(null);
  }, [aperti, espansoId]);

  const todo = useMemo(
    () => (ordini ?? []).filter((o) => o.marcatore === "urgente" || o.marcatore === "anomalia" || o.marcatore === "sollecito"),
    [ordini]
  );

  const completaP = useCallback(
    async (p: Promemoria) => {
      onAzione?.();
      setEspansoId(null);
      setUscentiP((s) => new Set(s).add(p.id));

      const avviaDB = async () => {
        try {
          const rigenerato = await completaPromemoria(p, identity);
          if (rigenerato) {
            const prossima = dataBreve(rigenerato.data.scadenza);
            toast.info(
              prossima
                ? `Promemoria completato - riceverai nuovamente una notifica il giorno ${prossima}.`
                : "Promemoria completato - riceverai nuovamente una notifica alla prossima occorrenza."
            );
          } else toast.success("Fatto! 🎉");
        } catch (e) {
          toast.error(`Operazione non riuscita: ${e}`);
          await carica();
        }
      };

      if (ridotte) {
        setPromemoria((prev) => prev ? prev.filter((item) => item.id !== p.id) : null);
        void avviaDB();
      } else {
        setTimeout(() => {
          setPromemoria((prev) => prev ? prev.filter((item) => item.id !== p.id) : null);
          void avviaDB();
        }, 400);
      }
    },
    [identity, carica, ridotte, onAzione]
  );

  const completaMarcatore = useCallback(
    async (o: OrdineDto) => {
      setUscentiM((s) => new Set(s).add(o.id));

      const avviaDB = async () => {
        try {
          await api.recordUpdate("ordine", o.id, { marcatore: "" });
          toast.success("Segnalazione risolta.");
        } catch (e) {
          toast.error(`Operazione non riuscita: ${e}`);
          await carica();
        }
      };

      if (ridotte) {
        setOrdini((prev) => prev ? prev.map((item) => item.id === o.id ? { ...item, marcatore: "" } : item) : null);
        void avviaDB();
      } else {
        setTimeout(() => {
          setOrdini((prev) => prev ? prev.map((item) => item.id === o.id ? { ...item, marcatore: "" } : item) : null);
          void avviaDB();
        }, 400);
      }
    },
    [carica, ridotte]
  );

  const snooze = useCallback(
    async (p: Promemoria, nuova: string) => {
      onAzione?.();
      setEspansoId(null);
      try {
        await posticipaPromemoria(p.id, nuova);
        await carica();
      } catch (e) {
        toast.error(`Operazione non riuscita: ${e}`);
      }
    },
    [carica, onAzione]
  );

  const rimborsiDaFare = rimborsi ?? [];
  const caricando =
    promemoria === null || (!soloPromemoria && (ordini === null || rimborsi === null));
  const totale =
    aperti.length + (soloPromemoria ? 0 : todo.length + rimborsiDaFare.length);

  const apriCollegato = useCallback(
    (p: Promemoria) => {
      onAzione?.();
      setEspansoId(null);
      if (!p.collegatoTipo) return;
      if (p.collegatoTipo === "ordine") {
        if (onApriOrdine) onApriOrdine(p.collegatoId, p.collegatoNome || undefined);
        else void apriFinestraOrdine(p.collegatoId, p.collegatoNome, identity);
      } else {
        void apriRiepilogo(p.collegatoTipo as TipoRiepilogo, p.collegatoId, p.collegatoNome, identity);
      }
    },
    [identity, onApriOrdine, onAzione]
  );

  // La pref «Apri in finestra separata» vale anche per i promemoria: in finestra
  // (modifica/sempre) o in modale. In finestra le bacheche si riallineano sull'evento
  // "promemoria:salvato" (già ascoltato qui sopra).
  const { ordineFinestra } = usePrefs();
  const nuovo = () => {
    if (inTauri && ordineFinestra === "sempre") void apriFinestraPromemoria(identity, collegato);
    else setTarget({ collegatoPre: collegato });
  };
  const apriModifica = useCallback(
    (p: Promemoria) => {
      setEspansoId(null);
      if (inTauri && (ordineFinestra === "modifica" || ordineFinestra === "sempre")) {
        void apriFinestraPromemoria(identity, undefined, p.id);
      } else {
        setTarget({ promemoria: p });
      }
    },
    [ordineFinestra, identity]
  );

  const righeDaFare = (
    <Stack gap={6}>
      <AnimatePresence initial={false}>
        {todo.map((o) => (
          <RigaContenitore key={o.id} uscente={uscentiM.has(o.id)}>
            <RigaMarcatore
              o={o}
              uscente={uscentiM.has(o.id)}
              onApri={() => {
                if (onApriOrdine) onApriOrdine(o.id, o.numero);
                else void apriFinestraOrdine(o.id, o.numero, identity);
              }}
              onFatto={() => void completaMarcatore(o)}
            />
          </RigaContenitore>
        ))}
        {rimborsiDaFare.map((rimborso) => (
          <RigaContenitore key={`rimborso-${rimborso.id}`} uscente={false}>
            <RigaRimborso
              rimborso={rimborso}
              onApri={() => setRimborsoTarget({ rimborso })}
              onEffettua={() => setEffettuaTarget(rimborso)}
            />
          </RigaContenitore>
        ))}
      </AnimatePresence>
    </Stack>
  );

  const righePromemoria = (
    <Stack gap={6}>
      <AnimatePresence initial={false}>
        {aperti.map((p) => (
          <RigaContenitore key={p.id} uscente={uscentiP.has(p.id)}>
            <RigaPromemoria
              p={p}
              uscente={uscentiP.has(p.id)}
              mostraCollegato={!collegato}
              ridotte={ridotte}
              espandibile={!soloPromemoria}
              espanso={espansoId === p.id}
              onToggle={() => setEspansoId((corrente) => (corrente === p.id ? null : p.id))}
              onFatto={() => void completaP(p)}
              onSnooze={(nuova) => void snooze(p, nuova)}
              onModifica={() => apriModifica(p)}
              onApriCollegato={() => apriCollegato(p)}
            />
          </RigaContenitore>
        ))}
      </AnimatePresence>
    </Stack>
  );

  const contenuto = (
    <Stack gap={compatta ? "sm" : "md"}>
      {caricando ? (
        <Group justify="center" py="xl">
          <Loader size="sm" color="accent" />
        </Group>
      ) : (
        <>
          {!soloPromemoria ? (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
              <SezioneBacheca
                Ico={IconClipboardCheck}
                colore="red"
                titolo="Da fare"
                conteggio={todo.length + rimborsiDaFare.length}
                vuoto={todo.length === 0 && rimborsiDaFare.length === 0}
                testoVuoto="Nessuna attività aperta"
              >
                {righeDaFare}
              </SezioneBacheca>
              <SezioneBacheca
                Ico={IconBell}
                colore="accent"
                titolo="Promemoria"
                conteggio={aperti.length}
                vuoto={aperti.length === 0}
                testoVuoto="Tutto sotto controllo"
              >
                {righePromemoria}
              </SezioneBacheca>
            </SimpleGrid>
          ) : (
            <>
              {righePromemoria}
              {aperti.length === 0 && (
                <Vuoto testo={collegato ? "Nessun promemoria collegato." : "Nessun promemoria. Tutto sotto controllo. ✨"} />
              )}
            </>
          )}
        </>
      )}

      <PromemoriaModal target={target} identity={identity} onClose={() => setTarget(null)} onSaved={() => { setTarget(null); void carica(); }} />
      <RimborsoModal
        target={rimborsoTarget}
        onClose={() => setRimborsoTarget(null)}
        onChanged={() => {
          setRimborsoTarget(null);
          void carica();
        }}
      />
      <SegnaEffettuatoModal
        rimborso={effettuaTarget}
        onClose={() => setEffettuaTarget(null)}
        onDone={() => {
          const id = effettuaTarget?.id;
          setEffettuaTarget(null);
          if (id) {
            setRimborsi((correnti) =>
              correnti ? correnti.filter((rimborso) => rimborso.id !== id) : correnti
            );
          }
          void carica();
        }}
      />
    </Stack>
  );

  // Variante compatta (embed): intestazione leggera + contenuto, senza Card.
  if (compatta) {
    return (
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            Promemoria {aperti.length > 0 ? `(${aperti.length})` : ""}
          </Text>
          <Group gap="xs" wrap="nowrap">
            {azioneCompatta}
            <Button size="compact-xs" variant="light" color="accent" leftSection={<IconBellPlus size={14} />} onClick={nuovo}>
              Promemoria
            </Button>
          </Group>
        </Group>
        {contenuto}
      </Stack>
    );
  }

  // Variante completa (dashboard): Card prominente con intestazione + azione.
  return (
    <Card p={0} style={{ overflow: "hidden" }}>
      <Box px="md" pt="md" pb="xs">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" color="accent" radius="md" size={42}>
              <IconClipboardCheck size={21} />
            </ThemeIcon>
            <Box style={{ minWidth: 0 }}>
              <Group gap={7} wrap="nowrap">
                <Text fw={750} truncate>
                  Bacheca del team
                </Text>
                {totale > 0 && (
                  <ContatoreBacheca valore={totale} colore="accent" />
                )}
              </Group>
              <Text size="xs" c="dimmed" truncate>
                {totale > 0
                  ? `${totale} cos${totale === 1 ? "a" : "e"} da seguire`
                  : "Attività condivise, promemoria e segnalazioni"}
              </Text>
            </Box>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" leftSection={<IconBellRinging size={16} />} onClick={() => setModalNotificaAperto(true)}>
              Notifica...
            </Button>
            <Button variant="light" color="accent" leftSection={<IconBellPlus size={16} />} onClick={nuovo}>
              Nuovo promemoria
            </Button>
          </Group>
        </Group>
      </Box>
      <Box px="md" pb="md" pt={4}>
        {contenuto}
      </Box>
      <NotificaBachecaModal
        opened={modalNotificaAperto}
        onClose={() => setModalNotificaAperto(false)}
        identity={identity}
      />
    </Card>
  );
}

function NotificaBachecaModal({
  opened,
  onClose,
  identity,
}: {
  opened: boolean;
  onClose: () => void;
  identity?: Identity;
}) {
  const { sogliaSolleciti, anno } = usePrefs();
  const [utenti, setUtenti] = useState<UserDto[]>([]);
  const [disponibili, setDisponibili] = useState<Notifica[]>([]);
  const [categorie, setCategorie] = useState<CategoriaNotifica[]>(CATEGORIE_NOTIFICA.map((c) => c.value));
  const [modoDestinatari, setModoDestinatari] = useState<"tutti" | "specifici">("tutti");
  const [utentiScelti, setUtentiScelti] = useState<string[]>([]);
  const [caricando, setCaricando] = useState(false);
  const [inviando, setInviando] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let vivo = true;
    setCaricando(true);
    setModoDestinatari("tutti");
    setUtentiScelti([]);

    Promise.all([
      api.getUsers().catch(() => [] as UserDto[]),
      api.pagamentiVista().catch(() => []),
      listaPromemoria().catch(() => []),
      api.ordiniLista().catch(() => []),
    ])
      .then(([users, pagamenti, promemoria, ordini]) => {
        if (!vivo) return;
        const ordiniAnno = ordini.filter((o) => nelloAnnoGlobale(o.data, anno));
        const notifichePagamenti = derivaNotifiche({
          pagamenti,
          promemoria: [],
          ordini,
          userId: identity?.userId,
          sogliaSolleciti,
        }).filter((n) => categoriaDiNotifica(n) === "solleciti");
        const notificheContestuali = derivaNotifiche({
          pagamenti: [],
          promemoria: filtraPromemoriaPerAnno(promemoria, ordiniAnno, anno),
          ordini: ordiniAnno,
          userId: identity?.userId,
          sogliaSolleciti,
        }).filter((n) => {
          const categoria = categoriaDiNotifica(n);
          return categoria === "segnalazioni" || categoria === "promemoria";
        });
        const notifiche = [...notifichePagamenti, ...notificheContestuali];
        const iniziali = CATEGORIE_NOTIFICA
          .filter((c) => notifiche.some((n) => categoriaDiNotifica(n) === c.value))
          .map((c) => c.value);
        setUtenti(utentiUnici(users, identity));
        setDisponibili(notifiche);
        setCategorie(iniziali.length > 0 ? iniziali : CATEGORIE_NOTIFICA.map((c) => c.value));
      })
      .catch((e) => {
        if (vivo) toast.error(`Notifiche non disponibili: ${e}`);
      })
      .finally(() => {
        if (vivo) setCaricando(false);
      });
    return () => {
      vivo = false;
    };
  }, [opened, identity, sogliaSolleciti, anno]);

  const conteggi = useMemo<Record<CategoriaNotifica, number>>(() => {
    const out = { solleciti: 0, segnalazioni: 0, promemoria: 0 };
    for (const n of disponibili) {
      const c = categoriaDiNotifica(n);
      if (c) out[c] += 1;
    }
    return out;
  }, [disponibili]);

  const notificaIds = useMemo(() => {
    const scelte = new Set(categorie);
    return [...new Set(disponibili.filter((n) => {
      const c = categoriaDiNotifica(n);
      return c ? scelte.has(c) : false;
    }).map((n) => n.id))];
  }, [categorie, disponibili]);

  const destinatari = useMemo(
    () => (modoDestinatari === "tutti" ? utenti.map((u) => u.id) : utentiScelti),
    [modoDestinatari, utenti, utentiScelti]
  );

  const opzioniUtenti = useMemo(() => utenti.map((u) => ({ value: u.id, label: u.nome || u.id })), [utenti]);
  const puoInviare = !caricando && notificaIds.length > 0 && destinatari.length > 0;

  async function invia() {
    if (!puoInviare) return;
    setInviando(true);
    try {
      const inviati = await riattivaNotifichePerUtenti(notificaIds, destinatari);
      if (inviati === 0) throw new Error("Nessun destinatario ha più una postazione attiva.");
      await api.notificheCheck().catch(() => {});
      toast.success(inviati === 1 ? "Notifica inviata." : "Notifiche inviate.");
      onClose();
    } catch (e) {
      toast.error(`Invio non riuscito: ${e}`);
    } finally {
      setInviando(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!inviando) onClose();
      }}
      closeOnEscape={!inviando}
      closeOnClickOutside={!inviando}
      centered
      size="md"
      zIndex={1300}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconBellRinging size={18} />
          </ThemeIcon>
          <Text fw={700}>Notifica...</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180 }}
    >
      <Stack gap="md">
        <Checkbox.Group
          label="Cosa vuoi notificare"
          value={categorie}
          onChange={(v) => setCategorie(v as CategoriaNotifica[])}
        >
          <Stack gap={6} mt={6}>
            {CATEGORIE_NOTIFICA.map((c) => (
              <Checkbox
                key={c.value}
                value={c.value}
                disabled={conteggi[c.value] === 0}
                label={`${c.label} (${conteggi[c.value]})`}
              />
            ))}
          </Stack>
        </Checkbox.Group>

        <Box>
          <Text size="sm" fw={500} mb={6}>
            Destinatari
          </Text>
          <SegmentedControl
            fullWidth
            value={modoDestinatari}
            onChange={(v) => setModoDestinatari(v as "tutti" | "specifici")}
            data={[
              { value: "tutti", label: "Tutti" },
              { value: "specifici", label: "Scegli utenti" },
            ]}
          />
        </Box>

        {modoDestinatari === "specifici" && (
          <MultiSelect
            label="Utenti"
            placeholder="Scegli uno o più utenti"
            data={opzioniUtenti}
            value={utentiScelti}
            onChange={setUtentiScelti}
            searchable
            clearable
            comboboxProps={{ withinPortal: true, zIndex: 1400 }}
          />
        )}

        <Text size="xs" c={puoInviare ? "dimmed" : "orange.7"}>
          {caricando
            ? "Carico..."
            : notificaIds.length === 0
              ? "Nessuna notifica disponibile per la scelta."
              : destinatari.length === 0
                ? "Scegli almeno un destinatario."
                : `${notificaIds.length} ${notificaIds.length === 1 ? "notifica pronta" : "notifiche pronte"}.`}
        </Text>

        <Group justify="flex-end">
          <Button variant="default" disabled={inviando} onClick={onClose}>
            Annulla
          </Button>
          <Button leftSection={<IconSend size={16} />} loading={inviando} disabled={!puoInviare} onClick={() => void invia()}>
            Invia
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Sezione dashboard compatta e ben distinta; le varianti embed restano leggere. */
function SezioneBacheca({
  Ico,
  colore,
  titolo,
  conteggio,
  vuoto,
  testoVuoto,
  children,
}: {
  Ico: typeof IconBell;
  colore: string;
  titolo: string;
  conteggio: number;
  vuoto: boolean;
  testoVuoto: string;
  children: ReactNode;
}) {
  return (
    <Paper
      withBorder
      radius="lg"
      p="sm"
      style={{
        background: `color-mix(in srgb, var(--mantine-color-${colore}-light) 30%, var(--mantine-color-body))`,
        minWidth: 0,
      }}
    >
      <Group justify="space-between" mb={vuoto ? 0 : "xs"} wrap="nowrap">
        <Group gap={8} wrap="nowrap">
          <ThemeIcon variant="light" color={colore} radius="md" size={30}>
            <Ico size={16} />
          </ThemeIcon>
          <Text size="sm" fw={750}>
            {titolo}
          </Text>
        </Group>
        <ContatoreBacheca valore={conteggio} colore={colore} />
      </Group>
      {vuoto ? (
        <Group justify="center" gap={7} mih={52}>
          <IconCircleCheckFilled
            size={17}
            color="var(--mantine-color-teal-6)"
            aria-hidden
          />
          <Text size="sm" c="dimmed">
            {testoVuoto}
          </Text>
        </Group>
      ) : (
        children
      )}
    </Paper>
  );
}

/** Il Badge `circle` eredita padding/line-height e può disallineare visivamente
 * le cifre. Questa forma fissa centra il numero in entrambi gli assi. */
function ContatoreBacheca({
  valore,
  colore,
}: {
  valore: number;
  colore: string;
}) {
  return (
    <Box
      component="span"
      aria-label={`${valore} elementi`}
      style={{
        alignItems: "center",
        background: `var(--mantine-color-${colore}-light)`,
        borderRadius: 999,
        color: `var(--mantine-color-${colore}-7)`,
        display: "inline-flex",
        flex: "0 0 20px",
        fontSize: 10,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 750,
        height: 20,
        justifyContent: "center",
        lineHeight: 1,
        minWidth: 20,
        paddingInline: valore > 99 ? 4 : 0,
      }}
    >
      {valore}
    </Box>
  );
}

function ConfermaUscita() { return <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.25, 1] }} transition={{ duration: 0.3 }}><IconCircleCheckFilled size={26} color="var(--mantine-color-green-6)" /></motion.div>; }

/** Wrapper con animazione d'ingresso/uscita (layout) per le righe. */
function RigaContenitore({ children, uscente: _uscente }: { children: React.ReactNode; uscente: boolean }) {
  const ridotte = useAnimazioniRidotte();

  return (
    <motion.div
      layout={ridotte ? false : "position"}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, height: 0, marginBottom: -6 }}
      transition={{
        duration: ridotte ? 0 : 0.22,
        ease: "easeOut",
      }}
      style={{ overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}

function RigaPromemoria({
  p,
  uscente,
  mostraCollegato,
  ridotte,
  espandibile,
  espanso,
  onToggle,
  onFatto,
  onSnooze,
  onModifica,
  onApriCollegato,
}: {
  p: Promemoria;
  uscente: boolean;
  mostraCollegato: boolean;
  ridotte: boolean;
  espandibile: boolean;
  espanso: boolean;
  onToggle: () => void;
  onFatto: () => void;
  onSnooze: (nuova: string) => void;
  onModifica: () => void;
  onApriCollegato: () => void;
}) {
  const stato = statoScadenza(p.scadenza, p.avvisoAnticipato);
  const colore = COLORE_STATO[stato];
  const prio = prioritaDef(p.priorita);
  const meta = p.collegatoTipo ? COLLEGATO_META[p.collegatoTipo] : null;
  const urgente = stato === "scaduto" || stato === "oggi";

  return (
    <Paper
      withBorder
      radius="md"
      p="xs"
      onClick={espandibile ? onToggle : undefined}
      aria-expanded={espandibile ? espanso : undefined}
      style={{
        borderLeft: `3px solid var(--mantine-color-${colore}-6)`,
        cursor: espandibile ? "pointer" : undefined,
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
            <Tooltip label={`Priorità ${prio.label.toLowerCase()}`} withArrow>
              <Box w={8} h={8} style={{ borderRadius: 999, background: `var(--mantine-color-${prio.color}-6)`, flex: "0 0 8px" }} />
            </Tooltip>
            <motion.div
              initial={false}
              animate={{ height: espanso ? "auto" : 19 }}
              transition={{ duration: ridotte ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ minWidth: 0, flex: 1, overflow: "hidden" }}
            >
              <Text
                fw={600}
                size="sm"
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  lineHeight: 1.35,
                }}
              >
                {p.testo}
              </Text>
            </motion.div>
          </Group>
          <Group gap={6} mt={4} wrap="wrap" style={{ rowGap: 4 }}>
            <Badge
              size="sm"
              variant={urgente ? "filled" : "light"}
              color={colore}
              leftSection={<IconClock size={11} />}
            >
              {etichettaScadenza(p.scadenza, stato)}
            </Badge>
            {p.ricorrenza !== "nessuna" && (
              <Badge size="sm" variant="light" color="grape" leftSection={<IconRepeat size={11} />}>
                {p.ricorrenza === "settimanale" ? "Settimanale" : p.ricorrenza === "mensile" ? "Mensile" : "Annuale"}
              </Badge>
            )}
            {mostraCollegato && meta && (
              <Badge
                size="sm"
                variant="outline"
                color={meta.color}
                leftSection={<meta.Ico size={11} />}
                style={{ cursor: "pointer" }}
                onClick={(event) => {
                  event.stopPropagation();
                  onApriCollegato();
                }}
              >
                {p.collegatoNome || meta.label}
              </Badge>
            )}
            {p.creatoDaNome && (
              <Text size="xs" c="dimmed">
                · {p.creatoDaNome}
              </Text>
            )}
          </Group>
        </Box>

        <Group gap={2} wrap="nowrap">
          {uscente ? (
            <ConfermaUscita />
          ) : (
            <>
              <Tooltip label="Fatto" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="green"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFatto();
                  }}
                  aria-label="Segna fatto"
                >
                  <IconCheck size={18} />
                </ActionIcon>
              </Tooltip>
              <Box onClick={(event) => event.stopPropagation()}>
                <SnoozeMenu scadenza={p.scadenza} avviso={p.avvisoAnticipato} onSnooze={onSnooze} />
              </Box>
              {meta && (
                <Tooltip label={`Apri ${meta.label.toLowerCase()}`} withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={(event) => {
                      event.stopPropagation();
                      onApriCollegato();
                    }}
                    aria-label="Apri collegato"
                  >
                    <IconExternalLink size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
              <AnimatePresence initial={false}>
                {!espanso && (
                  <motion.div
                    key="modifica-compatta"
                    initial={ridotte ? false : { width: 0, opacity: 0, scale: 0.78 }}
                    animate={{ width: 36, opacity: 1, scale: 1 }}
                    exit={{ width: 0, opacity: ridotte ? 1 : 0, scale: ridotte ? 1 : 0.78 }}
                    transition={{ duration: ridotte ? 0 : 0.16, ease: "easeOut" }}
                    style={{ overflow: "hidden", display: "flex", justifyContent: "center" }}
                  >
                    <Tooltip label="Modifica" withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="md"
                        onClick={(event) => {
                          event.stopPropagation();
                          onModifica();
                        }}
                        aria-label="Modifica"
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </Group>
      </Group>
      <AnimatePresence initial={false}>
        {espandibile && espanso && !uscente && (
          <motion.div
            key="riepilogo"
            initial={ridotte ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: ridotte ? 1 : 0 }}
            transition={{ duration: ridotte ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <Box
              mt="xs"
              pt="xs"
              style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
              onClick={(event) => event.stopPropagation()}
            >
              <Group gap="xs" align="stretch" wrap="wrap">
                <DettaglioPromemoria etichetta="Priorità" valore={prio.label} colore={prio.color} />
                <DettaglioPromemoria
                  etichetta="Anticipo"
                  valore={p.avvisoAnticipato > 0 ? `${p.avvisoAnticipato} giorn${p.avvisoAnticipato === 1 ? "o" : "i"}` : "Nessuno"}
                  colore="blue"
                />
              </Group>
              <Group justify="space-between" gap="xs" mt="sm">
                <Text size="xs" c="dimmed">
                  Vuoi modificare questo promemoria?
                </Text>
                <Button size="compact-sm" variant="light" color="accent" leftSection={<IconPencil size={14} />} onClick={onModifica}>
                  Modifica
                </Button>
              </Group>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Paper>
  );
}

function DettaglioPromemoria({ etichetta, valore, colore }: { etichetta: string; valore: string; colore: string }) {
  return (
    <Box
      px="xs"
      py={5}
      style={{
        minWidth: 112,
        flex: "1 1 112px",
        borderRadius: "var(--mantine-radius-sm)",
        background: `var(--mantine-color-${colore}-light)`,
      }}
    >
      <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
        {etichetta}
      </Text>
      <Text size="xs" fw={600} truncate>
        {valore}
      </Text>
    </Box>
  );
}

/** Menu posticipa (snooze): +1 giorno / +1 settimana / scegli data. */
function SnoozeMenu({
  scadenza,
  avviso,
  onSnooze,
}: {
  scadenza: string;
  /** Avviso anticipato del promemoria: «+N giorni» deve garantire N giorni di silenzio. */
  avviso: number;
  onSnooze: (nuova: string) => void;
}) {
  const [aperto, setAperto] = useState(false);
  useCloseOnScroll(aperto, setAperto);
  const dataRef = useRef<HTMLInputElement>(null);
  const base = scadenza && scadenza >= oggiIso() ? scadenza : oggiIso();

  const addGiorni = (iso: string, g: number) => {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + g);
    return isoLocale(d); // niente toISOString: in fuso positivo "+1 giorno" tornava lo stesso
  };

  const piu = (giorni: number) => {
    let nuova = addGiorni(base, giorni);
    // Se l'avviso anticipato la rimetterebbe subito in finestra (oggi/presto), spingi la
    // scadenza oltre l'anticipo: così «+N giorni» = N giorni di silenzio per davvero.
    if (statoScadenza(nuova, avviso) !== "futuro") nuova = addGiorni(oggiIso(), giorni + avviso);
    onSnooze(nuova);
    setAperto(false);
  };

  return (
    <Popover opened={aperto} onChange={setAperto} position="bottom-end" withArrow shadow="md" width={220}>
      <Popover.Target>
        <Tooltip label="Posticipa" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={() => setAperto((o) => !o)} aria-label="Posticipa">
            <IconCalendarPlus size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap={6}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">
            Posticipa
          </Text>
          <Button size="compact-sm" variant="default" justify="flex-start" onClick={() => piu(1)}>
            +1 giorno
          </Button>
          <Button size="compact-sm" variant="default" justify="flex-start" onClick={() => piu(7)}>
            +1 settimana
          </Button>
          <TextInput
            ref={dataRef}
            type="date"
            size="xs"
            label="Al giorno"
            defaultValue={base}
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v) {
                onSnooze(v);
                setAperto(false);
              }
            }}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

function RigaMarcatore({
  o,
  uscente,
  onApri,
  onFatto,
}: {
  o: OrdineDto;
  uscente: boolean;
  onApri: () => void;
  onFatto: () => void;
}) {
  const md = marcatoreDef(o.marcatore) ?? MARCATORI[0];
  const s = statoDef(o.stato);
  return (
    <Paper
      withBorder
      radius="md"
      p="xs"
      onClick={onApri}
      className="pt-pagamento-row"
      style={{ borderLeft: `3px solid var(--mantine-color-${md.color}-6)`, cursor: "pointer" }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color={md.color} radius="md" size="md">
            <md.Ico size={15} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" className="tabular" truncate>
              {md.label} · {o.numero}
              {o.clienteNome ? ` · ${o.clienteNome}` : ""}
            </Text>
            <Group gap={6} wrap="nowrap">
              <Tooltip label={s.label} withArrow>
                <Badge size="xs" variant="light" color={s.color} leftSection={<s.Ico size={10} />}>
                  {s.label}
                </Badge>
              </Tooltip>
              {o.medicoNome && (
                <Text size="xs" c="dimmed" truncate>
                  {o.medicoNome}
                </Text>
              )}
            </Group>
          </Box>
        </Group>
        <Box onClick={(e) => e.stopPropagation()}>
          {uscente ? (
            <ConfermaUscita />
          ) : (
            <Tooltip label="Risolvi (azzera segnalazione)" withArrow>
              <ActionIcon variant="subtle" color="green" onClick={onFatto} aria-label="Risolvi">
                <IconCheck size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Box>
      </Group>
    </Paper>
  );
}

function RigaRimborso({
  rimborso,
  onApri,
  onEffettua,
}: {
  rimborso: Rimborso;
  onApri: () => void;
  onEffettua: () => void;
}) {
  return (
    <Paper
      withBorder
      radius="md"
      p="xs"
      className="pt-pagamento-row"
      onClick={onApri}
      style={{
        borderLeft: "3px solid var(--mantine-color-orange-6)",
        cursor: "pointer",
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="orange" radius="md" size="md">
            <IconReceiptRefund size={15} />
          </ThemeIcon>
          <Box style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              Rimborso · {rimborso.ragioneSociale || "Senza intestatario"}
            </Text>
            <Group gap={6} wrap="wrap" style={{ rowGap: 3 }}>
              <Badge size="xs" variant="light" color="orange">
                € {centsToEurStr(rimborso.importo)}
              </Badge>
              {rimborso.dataRichiesta && (
                <Text size="xs" c="dimmed">
                  richiesto il {dataBreve(rimborso.dataRichiesta)}
                </Text>
              )}
              {rimborso.ordineNumero && (
                <Badge size="xs" variant="outline" color="gray">
                  Ordine {rimborso.ordineNumero}
                </Badge>
              )}
              {rimborso.motivo && (
                <Text size="xs" c="dimmed" truncate maw={360}>
                  {rimborso.motivo}
                </Text>
              )}
            </Group>
          </Box>
        </Group>
        <Button
          size="compact-xs"
          variant="light"
          color="teal"
          leftSection={<IconCheck size={14} />}
          onClick={(event) => {
            event.stopPropagation();
            onEffettua();
          }}
        >
          Effettua
        </Button>
      </Group>
    </Paper>
  );
}

function Vuoto({ testo }: { testo: string }) {
  return (
    <Text c="dimmed" size="sm" py="sm" ta="center">
      {testo}
    </Text>
  );
}
