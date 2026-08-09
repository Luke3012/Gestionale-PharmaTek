import {
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconClipboardText,
  IconFileInvoice,
  IconPlus,
  IconSparkles,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  type AliasPreventivo,
  type Preventivo,
  type RecordDto,
} from "../../lib/tauri";
import { oggiIso } from "../../lib/date";
import { centsToEurStr } from "../../lib/money";
import { usePrefs } from "../../lib/prefs";
import { toast } from "../../ui/toast/store";
import { ultimoMedicoClienteValido } from "../anagrafiche/medicoCliente";
import { SelettoreCategoriaNuovoOrdine } from "../giornaliero/categoriaOrdine";
import {
  interpretaPreventivo,
  type RigaInterpretataPreventivo,
} from "./parserPreventivo";
import type { BozzaPreventivoDaZero } from "./bozzaPreventivo";

type Origine = "giornaliero" | "zero";

function AltezzaAnimata({
  children,
  ridotta,
  onRidimensionamento,
}: {
  children: ReactNode;
  ridotta: boolean;
  onRidimensionamento: (attivo: boolean) => void;
}) {
  const contenutoRef = useRef<HTMLDivElement>(null);
  const [altezza, setAltezza] = useState<number | null>(null);

  useLayoutEffect(() => {
    const elemento = contenutoRef.current;
    if (!elemento) return;
    const misura = () => setAltezza(elemento.getBoundingClientRect().height);
    misura();
    const observer = new ResizeObserver(misura);
    observer.observe(elemento);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ridotta) onRidimensionamento(false);
  }, [onRidimensionamento, ridotta]);

  return (
    <motion.div
      animate={
        ridotta
          ? { height: "auto" }
          : altezza !== null
            ? { height: altezza }
            : undefined
      }
      transition={{
        duration: ridotta ? 0 : 0.3,
        ease: [0.22, 1, 0.36, 1],
      }}
      onAnimationStart={() => {
        if (!ridotta) onRidimensionamento(true);
      }}
      onAnimationComplete={() => onRidimensionamento(false)}
      style={{
        overflow: ridotta ? "visible" : "hidden",
      }}
    >
      <div ref={contenutoRef}>{children}</div>
    </motion.div>
  );
}

const OPZIONI_ORIGINE: Array<{
  value: Origine;
  titolo: string;
  descrizione: string;
  icona: typeof IconClipboardText;
}> = [
  {
    value: "giornaliero",
    titolo: "Da un ordine",
    descrizione: "Riprendi cliente, prodotti e pagamenti dal Giornaliero.",
    icona: IconClipboardText,
  },
  {
    value: "zero",
    titolo: "Crea da zero",
    descrizione: "Scegli linea e destinatari, oppure parti da un testo.",
    icona: IconPlus,
  },
];

function opzioni(records: RecordDto[]) {
  return records
    .map((record) => ({
      value: record.id,
      label: String(record.data.nome ?? record.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
}

function opzioniDestinatari(clienti: RecordDto[], medici: RecordDto[]) {
  return [
    {
      group: "Clienti",
      items: opzioni(clienti).map((item) => ({
        value: `cliente:${item.value}`,
        label: item.label,
      })),
    },
    {
      group: "Medici",
      items: opzioni(medici).map((item) => ({
        value: `medico:${item.value}`,
        label: item.label,
      })),
    },
  ];
}

function esempioCompilazione(linea: string): string {
  if (linea === "Diagnostica") {
    return [
      "2 DPF € 15 per Mario Rossi;",
      "1 DPT € 15 per Lucia Bianchi",
    ].join("\n");
  }
  if (linea === "Keriba") {
    return [
      "2 Keriba Forte € 60 per Mario Rossi;",
      "1 Keriba Sport € 60 per Lucia Bianchi",
    ].join("\n");
  }
  return [
    "Sublinguale 2 fiale € 280, 2+2, parietaria, d.pter per Mario Rossi;",
    "Lisato batterico 3 fiale € 280, 3+3, h.influenzae per Lucia Bianchi",
  ].join("\n");
}

export function NuovoPreventivoModal({
  opened,
  disponibili,
  onClose,
  onOrdinePreparato,
  onBozzaPreparata,
  dentroFinestra = false,
}: {
  opened: boolean;
  disponibili: Preventivo[];
  onClose: () => void;
  onOrdinePreparato: (ordineId: string) => void;
  onBozzaPreparata: (bozza: BozzaPreventivoDaZero) => void;
  /** Nella Webview aperta da Spotlight mostra una pagina, non un modale annidato. */
  dentroFinestra?: boolean;
}) {
  const { ridurreAnimazioni } = usePrefs();
  const [origine, setOrigine] = useState<Origine>("giornaliero");
  const [ordineId, setOrdineId] = useState<string | null>(null);
  const [linea, setLinea] = useState("Immunoterapia");
  const [destinatario, setDestinatario] = useState<string | null>(null);
  const [medicoClienteId, setMedicoClienteId] = useState<string | null>(null);
  const [testo, setTesto] = useState("");
  const [note, setNote] = useState("");
  const [righe, setRighe] = useState<RigaInterpretataPreventivo[]>([]);
  const [prodotti, setProdotti] = useState<RecordDto[]>([]);
  const [prodottiProduzione, setProdottiProduzione] = useState<RecordDto[]>([]);
  const [medici, setMedici] = useState<RecordDto[]>([]);
  const [clienti, setClienti] = useState<RecordDto[]>([]);
  const [aliases, setAliases] = useState<AliasPreventivo[]>([]);
  const [caricando, setCaricando] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [ridimensionando, setRidimensionando] = useState(false);
  const richiestaPrezziRef = useRef(0);
  const [tipoDestinatario, destinatarioId = ""] =
    destinatario?.split(":", 2) ?? [];
  const medicoId =
    tipoDestinatario === "medico"
      ? destinatarioId
      : tipoDestinatario === "cliente"
        ? medicoClienteId
        : null;
  const clienteId =
    tipoDestinatario === "cliente" ? destinatarioId : null;

  useEffect(() => {
    if (!opened) return;
    setOrdineId(null);
    setDestinatario(null);
    setMedicoClienteId(null);
    setRighe([]);
    setNote("");
    setCaricando(true);
    Promise.all([
      api.recordsList("prodotto"),
      api.recordsList("medico"),
      api.recordsList("cliente"),
      api.recordsList("prodotto_produzione"),
      api.preventivoAliasLista(),
    ])
      .then(
        ([
          catalogo,
          mediciCaricati,
          clientiCaricati,
          produzioneCaricata,
          aliasCaricati,
        ]) => {
        setProdotti(catalogo);
        setMedici(mediciCaricati);
        setClienti(clientiCaricati);
        setProdottiProduzione(produzioneCaricata);
        setAliases(aliasCaricati);
        },
      )
      .catch((error) =>
        toast.error(`Preparazione nuovo preventivo non riuscita: ${error}`),
      )
      .finally(() => setCaricando(false));
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    setOrdineId((corrente) =>
      corrente &&
      disponibili.some((preventivo) => preventivo.ordineId === corrente)
        ? corrente
        : (disponibili[0]?.ordineId ?? null),
    );
  }, [disponibili, opened]);

  const aliasByProdotto = useMemo(() => {
    const result = new Map<string, string[]>();
    aliases.forEach((alias) =>
      result.set(alias.prodottoId, [
        ...(result.get(alias.prodottoId) ?? []),
        alias.alias,
      ]),
    );
    return result;
  }, [aliases]);
  const destinatariDisponibili = useMemo(
    () => opzioniDestinatari(clienti, medici),
    [clienti, medici],
  );
  const suggerimentiAllergeni = useMemo(
    () =>
      prodottiProduzione
        .filter((record) =>
          ["allergene", "ceppo"].includes(String(record.data.tipo ?? "")),
        )
        .map((record) => String(record.data.valore ?? "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" })),
    [prodottiProduzione],
  );
  const suggerimentiFormulazioni = useMemo(
    () =>
      prodottiProduzione
        .filter(
          (record) => String(record.data.tipo ?? "") === "formulazione",
        )
        .map((record) => String(record.data.valore ?? "").trim())
        .filter(Boolean),
    [prodottiProduzione],
  );
  const suggerimentiPosologie = useMemo(
    () =>
      prodottiProduzione
        .filter((record) => String(record.data.tipo ?? "") === "posologia")
        .map((record) => String(record.data.valore ?? "").trim())
        .filter(Boolean),
    [prodottiProduzione],
  );
  const riepilogoInterpretazione = useMemo(
    () => ({
      prodotti: righe.length,
      quantita: righe.reduce((totale, riga) => totale + riga.qta, 0),
      pazienti: righe.filter((riga) => riga.paziente.trim()).length,
      allergeni: righe.reduce(
        (totale, riga) => totale + riga.allergeni.length,
        0,
      ),
      totale: righe.reduce(
        (totale, riga) => totale + (riga.prezzo ?? 0) * riga.qta,
        0,
      ),
    }),
    [righe],
  );

  useEffect(() => {
    if (
      !opened ||
      origine !== "zero" ||
      righe.length === 0
    ) {
      return;
    }
    const richiesta = ++richiestaPrezziRef.current;
    const righeConProdotto = righe.filter(
      (riga) => riga.prodottoId && !riga.prezzoEsplicito,
    );
    if (righeConProdotto.length === 0) return;

    void api
      .prezziSuggeritiBatch(
        [...new Set(righeConProdotto.map((riga) => riga.prodottoId))],
        medicoId,
      )
      .then((suggeriti) => {
        if (richiesta !== richiestaPrezziRef.current) return;
        const prezzoImmunoMedico =
          linea === "Immunoterapia"
            ? Number(
                medici.find((record) => record.id === medicoId)?.data
                  .prezzo_immuno_default,
              ) || 0
            : 0;
        const prezzi = new Map(
          suggeriti.map((suggerito) => [
            suggerito.prodottoId,
            prezzoImmunoMedico > 0 && suggerito.fonte === "default"
              ? prezzoImmunoMedico
              : suggerito.prezzo,
          ]),
        );
        setRighe((correnti) =>
          correnti.map((riga) =>
            riga.prezzoEsplicito || !prezzi.has(riga.prodottoId)
              ? riga
              : { ...riga, prezzo: prezzi.get(riga.prodottoId) ?? riga.prezzo },
          ),
        );
      })
      .catch(() => {});
  }, [medicoId]);

  async function interpreta() {
    if (!testo.trim() || interpretando) return null;
    setInterpretando(true);
    const animazioneMinima = ridurreAnimazioni
      ? Promise.resolve()
      : new Promise<void>((resolve) => window.setTimeout(resolve, 480));
    try {
      const dellaLinea = prodotti.filter(
        (record) => String(record.data.categoria ?? "") === linea,
      );
      const suggeriti = await api.prezziSuggeritiBatch(
        dellaLinea.map((record) => record.id),
        medicoId,
      );
      const prezzoImmunoMedico =
        linea === "Immunoterapia"
          ? Number(
              medici.find((record) => record.id === medicoId)?.data
                .prezzo_immuno_default,
            ) || 0
          : 0;
      const prezzi = new Map(
        suggeriti.map((suggerito) => [
          suggerito.prodottoId,
          prezzoImmunoMedico > 0 && suggerito.fonte === "default"
            ? prezzoImmunoMedico
            : suggerito.prezzo,
        ]),
      );
      const result = interpretaPreventivo(testo, {
        lineeOrdine: [linea],
        dettagliProduzione: {
          formulazioni: suggerimentiFormulazioni,
          posologie: suggerimentiPosologie,
          allergeni: suggerimentiAllergeni,
        },
        prodotti: dellaLinea.map((record) => ({
          id: record.id,
          nome: String(record.data.nome ?? ""),
          categoria: linea,
          alias: aliasByProdotto.get(record.id) ?? [],
          prezzoSuggerito: prezzi.get(record.id) ?? 0,
        })),
      });
      // Consente alla micro-animazione richiesta di essere percepibile anche quando
      // l'analisi locale termina nello stesso frame. Nessuna attesa con movimento ridotto.
      await animazioneMinima;
      // Nell'UI Immunoterapia ogni riga rappresenta già una formulazione distinta:
      // anche un eventuale numero scritto nel testo non diventa una quantità.
      const righeInterpretate =
        linea === "Immunoterapia"
          ? result.righe.map((riga) => ({ ...riga, qta: 1 }))
          : result.righe;
      setRighe(righeInterpretate);
      if (result.note) setNote(result.note);
      if (righeInterpretate.length === 0) {
        toast.warning("Non ho individuato prodotti nel testo.");
      } else if (result.ambigue > 0) {
        toast.warning(
          `${result.ambigue} ${result.ambigue === 1 ? "riga richiede" : "righe richiedono"} una verifica.`,
        );
      } else {
        toast.success("Testo interpretato: controlla il riepilogo.");
      }
      return righeInterpretate;
    } finally {
      setInterpretando(false);
    }
  }

  function patchRiga(
    index: number,
    patch: Partial<RigaInterpretataPreventivo>,
  ) {
    setRighe((correnti) =>
      correnti.map((riga, corrente) =>
        corrente === index ? { ...riga, ...patch } : riga,
      ),
    );
  }

  async function continuaDaZero() {
    if (!destinatario || (!medicoId && !clienteId)) {
      toast.warning("Seleziona il destinatario del preventivo.");
      return;
    }
    if (clienteId && !medicoId) {
      toast.warning("Seleziona il medico associato al cliente.");
      return;
    }
    let pronte = righe;
    if (testo.trim() && pronte.length === 0) {
      pronte = (await interpreta()) ?? [];
      if (pronte.length === 0) return;
    }
    if (pronte.some((riga) => !riga.prodottoNome.trim())) {
      toast.warning("Verifica le righe evidenziate prima di continuare.");
      return;
    }
    if (pronte.some((riga) => riga.richiedeRevisione)) {
      pronte = pronte.map((riga) => ({
        ...riga,
        richiedeRevisione: false,
      }));
      setRighe(pronte);
    }
    const medico = medici.find((record) => record.id === medicoId);
    onBozzaPreparata({
      data: oggiIso(),
      linea,
      clienteId: clienteId ?? "",
      medicoId: medicoId ?? "",
      agenteId: String(medico?.data.agente_id ?? ""),
      note: note.trim(),
      righe: pronte.map((riga) => ({
        key: crypto.randomUUID(),
        prodottoId: riga.prodottoId,
        prodottoNome: riga.prodottoNome.trim(),
        qta: riga.qta,
        prezzo: Math.max(0, riga.prezzo ?? 0) / 100,
        paziente: riga.paziente.trim(),
        tipoTest: linea === "Diagnostica" ? "PRICK TEST" : "",
        ml: "",
        codice: "",
        formulazione: riga.formulazione.trim(),
        posologia: riga.posologia.trim(),
        numero: "",
        allergeni: riga.allergeni,
      })),
    });
  }

  const titolo = (
    <Group gap="sm">
      <ThemeIcon color="yellow" variant="light" radius="xl">
        <IconFileInvoice size={18} />
      </ThemeIcon>
      <Text fw={700}>Nuovo preventivo</Text>
    </Group>
  );
  const contenuto = (
      <AltezzaAnimata
        ridotta={ridurreAnimazioni}
        onRidimensionamento={setRidimensionando}
      >
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            {OPZIONI_ORIGINE.map((opzione) => {
              const selezionata = origine === opzione.value;
              const Icona = opzione.icona;
              return (
                <UnstyledButton
                  key={opzione.value}
                  className="pt-preventivo-scelta-origine"
                  data-selected={selezionata || undefined}
                  aria-pressed={selezionata}
                  onClick={() => setOrigine(opzione.value)}
                >
                  <Group wrap="nowrap" gap="sm" align="center">
                    <ThemeIcon
                      size={42}
                      radius="xl"
                      color={selezionata ? "yellow" : "gray"}
                      variant={selezionata ? "filled" : "light"}
                      style={{ flexShrink: 0 }}
                    >
                      <Icona
                        size={20}
                        color={selezionata ? "#171717" : undefined}
                      />
                    </ThemeIcon>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Text fw={750} size="sm">
                        {opzione.titolo}
                      </Text>
                      <Text size="xs" c="dimmed" lh={1.35}>
                        {opzione.descrizione}
                      </Text>
                    </Box>
                    <ThemeIcon
                      size={23}
                      radius="xl"
                      color={selezionata ? "yellow" : "gray"}
                      variant={selezionata ? "filled" : "outline"}
                      className="pt-preventivo-scelta-check"
                    >
                      {selezionata && <IconCheck size={14} stroke={3} />}
                    </ThemeIcon>
                  </Group>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>

          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={origine}
              initial={
                ridurreAnimazioni ? false : { opacity: 0, y: 8 }
              }
              animate={{ opacity: 1, y: 0 }}
              exit={
                ridurreAnimazioni
                  ? { opacity: 1 }
                  : { opacity: 0, y: -5 }
              }
              transition={{ duration: ridurreAnimazioni ? 0 : 0.18 }}
              style={{ width: "100%" }}
            >
              {origine === "giornaliero" ? (
                <Stack gap="sm">
                  <Box>
                    <Text fw={700}>Scegli l’ordine da trasformare</Text>
                    <Text size="sm" c="dimmed">
                      Trovi soltanto gli ordini Nuovo che non hanno ancora un
                      preventivo.
                    </Text>
                  </Box>
            {disponibili.length ? (
              <Select
                searchable
                placeholder="Cerca per numero, destinatario o importo…"
                data={disponibili.map((ordine) => ({
                  value: ordine.ordineId,
                  label: `${ordine.ordineNumero} · ${
                    ordine.clienteNome || ordine.medicoNome || "senza destinatario"
                  } · € ${centsToEurStr(ordine.totale)}`,
                }))}
                value={ordineId}
                onChange={setOrdineId}
              />
            ) : (
              <Alert color="gray">
                Non ci sono ordini Nuovo senza preventivo. Puoi comunque partire da zero.
              </Alert>
            )}
                </Stack>
              ) : (
                <Stack gap="md">
            <Paper withBorder p="md" radius="md">
              <Group justify="space-between" align="center">
                <Stack gap={2}>
                  <Text fw={700}>Linea e destinatario</Text>
                  <Text size="xs" c="dimmed">
                    La data del preventivo sarà l’istante della sua creazione.
                  </Text>
                </Stack>
                <SelettoreCategoriaNuovoOrdine
                  value={linea}
                  haContenuto={
                    testo.trim() !== "" || note.trim() !== "" || righe.length > 0
                  }
                  tipo="preventivo"
                  onChange={(value) => {
                    setLinea(value);
                    setRighe([]);
                    setTesto("");
                    setNote("");
                  }}
                />
              </Group>
              <Select
                mt="md"
                label="Destinatario del preventivo"
                description="Cerca e seleziona un cliente oppure un medico."
                placeholder="Cerca cliente o medico…"
                searchable
                clearable
                data={destinatariDisponibili}
                value={destinatario}
                onChange={(value) => {
                  setDestinatario(value);
                  const [tipo, id = ""] = value?.split(":", 2) ?? [];
                  setMedicoClienteId(
                    tipo === "cliente"
                      ? ultimoMedicoClienteValido(id, clienti, medici) || null
                      : null,
                  );
                }}
              />
              {tipoDestinatario === "cliente" && (
                <Select
                  mt="md"
                  required
                  searchable
                  clearable
                  label="Medico di riferimento"
                  description="Proposto dall’ultimo ordine del cliente; puoi cambiarlo."
                  placeholder="Cerca il medico…"
                  data={opzioni(medici)}
                  value={medicoClienteId}
                  onChange={setMedicoClienteId}
                />
              )}
            </Paper>

            <Paper
              withBorder
              p="md"
              radius="md"
              style={{
                background: "var(--mantine-color-yellow-0)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <AnimatePresence>
                {interpretando && !ridurreAnimazioni && (
                  <motion.div
                    key="scansione-testo"
                    initial={{ opacity: 0, top: "10%" }}
                    animate={{
                      opacity: [0, 0.9, 0.65, 0],
                      top: ["10%", "28%", "72%", "90%"],
                    }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: 0.82,
                      ease: "easeInOut",
                    }}
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 16,
                      right: 16,
                      height: 2,
                      zIndex: 2,
                      pointerEvents: "none",
                      borderRadius: 99,
                      background:
                        "linear-gradient(90deg, transparent, var(--mantine-color-yellow-5) 18%, var(--mantine-color-yellow-6) 82%, transparent)",
                      boxShadow: "0 0 12px rgba(246, 200, 0, .5)",
                    }}
                  />
                )}
              </AnimatePresence>
              <Group align="flex-start" wrap="nowrap">
                <Box style={{ marginTop: 22 }}>
                  <ThemeIcon color="yellow" variant="filled" radius="xl">
                    <IconSparkles size={17} color="#171717" />
                  </ThemeIcon>
                </Box>
                <Textarea
                  style={{ flex: 1 }}
                  label="Compila da testo"
                  description={
                    linea === "Immunoterapia"
                      ? "Scrivi prodotto e dettagli; separa allergeni e ceppi con virgole."
                      : "Scrivi prodotto, quantità e dettagli; separa allergeni e ceppi con virgole."
                  }
                  placeholder={esempioCompilazione(linea)}
                  minRows={2}
                  autosize
                  maxRows={4}
                  styles={{
                    input: {
                      overflowY: "auto",
                    },
                  }}
                  value={testo}
                  readOnly={interpretando}
                  onChange={(event) => {
                    setTesto(event.currentTarget.value);
                    setRighe([]);
                  }}
                />
                <Button
                  mt={48}
                  color="yellow"
                  variant="light"
                  loading={interpretando}
                  disabled={!testo.trim()}
                  onClick={() => void interpreta()}
                >
                  Analizza
                </Button>
              </Group>
              {righe.length > 0 && (
                <Group gap="xs" mt="sm">
                  <Badge color="yellow" variant="light">
                    {riepilogoInterpretazione.prodotti} prodotti
                  </Badge>
                  {linea !== "Immunoterapia" && (
                    <Badge color="gray" variant="light">
                      {riepilogoInterpretazione.quantita} pezzi
                    </Badge>
                  )}
                  <Badge color="blue" variant="light">
                    {riepilogoInterpretazione.pazienti} pazienti
                  </Badge>
                  <Badge color="teal" variant="light">
                    {riepilogoInterpretazione.allergeni} allergeni / ceppi
                  </Badge>
                  <Badge color="dark" variant="light">
                    € {centsToEurStr(riepilogoInterpretazione.totale)}
                  </Badge>
                </Group>
              )}
            </Paper>

            {righe.map((riga, index) => (
              <Paper
                key={`${riga.segmento}-${index}`}
                withBorder
                p="sm"
                radius="md"
                style={{
                  borderColor: riga.richiedeRevisione
                    ? "var(--mantine-color-orange-5)"
                    : undefined,
                }}
              >
                <Group align="flex-end" wrap="nowrap">
                  <Select
                    style={{ flex: 1 }}
                    label="Prodotto interpretato"
                    searchable
                    data={prodotti
                      .filter(
                        (record) => String(record.data.categoria ?? "") === linea,
                      )
                      .map((record) => ({
                        value: record.id,
                        label: String(record.data.nome ?? ""),
                      }))}
                    value={riga.prodottoId || null}
                    onChange={(value) => {
                      const record = prodotti.find((item) => item.id === value);
                      patchRiga(index, {
                        prodottoId: value ?? "",
                        prodottoNome: String(record?.data.nome ?? ""),
                        richiedeRevisione: false,
                        livello: "alta",
                      });
                    }}
                  />
                  {linea !== "Immunoterapia" && (
                    <NumberInput
                      label="Q.tà"
                      w={86}
                      min={1}
                      value={riga.qta}
                      onChange={(value) =>
                        patchRiga(index, { qta: Math.max(1, Number(value || 1)) })
                      }
                    />
                  )}
                  <NumberInput
                    label="Prezzo"
                    w={130}
                    prefix="€ "
                    decimalScale={2}
                    fixedDecimalScale
                    min={0}
                    value={(riga.prezzo ?? 0) / 100}
                    onChange={(value) =>
                      patchRiga(index, {
                        prezzo: Math.max(0, Math.round(Number(value || 0) * 100)),
                        prezzoEsplicito: true,
                      })
                    }
                  />
                  <TextInput
                    label="Paziente"
                    w={190}
                    value={riga.paziente}
                    onChange={(event) =>
                      patchRiga(index, { paziente: event.currentTarget.value })
                    }
                  />
                  {riga.richiedeRevisione ? (
                    <Button
                      variant="light"
                      color="orange"
                      size="compact-sm"
                      mb={7}
                      onClick={() => patchRiga(index, { richiedeRevisione: false })}
                    >
                      Conferma riga
                    </Button>
                  ) : (
                    <Badge color="teal" mb={8}>
                      verificata
                    </Badge>
                  )}
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
                  <Autocomplete
                    label="Formulazione"
                    placeholder="Facoltativa"
                    data={suggerimentiFormulazioni}
                    value={riga.formulazione}
                    onChange={(value) =>
                      patchRiga(index, { formulazione: value })
                    }
                  />
                  <Autocomplete
                    label="Posologia"
                    placeholder="Facoltativa"
                    data={suggerimentiPosologie}
                    value={riga.posologia}
                    onChange={(value) =>
                      patchRiga(index, { posologia: value })
                    }
                  />
                </SimpleGrid>
                <TagsInput
                  mt="xs"
                  label="Allergeni / ceppi"
                  placeholder={
                    riga.allergeni.length ? undefined : "Aggiungi fino a 10 valori"
                  }
                  data={suggerimentiAllergeni}
                  value={riga.allergeni}
                  maxTags={10}
                  clearable
                  onChange={(value) =>
                    patchRiga(index, { allergeni: value })
                  }
                />
                {riga.richiedeRevisione && (
                  <Group gap={5} mt="xs">
                    <IconAlertTriangle size={15} color="var(--mantine-color-orange-7)" />
                    <Text size="xs" c="orange.8">
                      {riga.motivazioni.join(" · ")}
                    </Text>
                  </Group>
                )}
              </Paper>
            ))}
                </Stack>
              )}
            </motion.div>
          </AnimatePresence>

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              Annulla
            </Button>
            <Button
              color="accent"
              loading={caricando}
              disabled={
                origine === "giornaliero"
                  ? !ordineId
                  : !destinatario ||
                    (tipoDestinatario === "cliente" && !medicoClienteId)
              }
              onClick={() => {
                if (origine === "giornaliero" && ordineId) {
                  onOrdinePreparato(ordineId);
                } else {
                  void continuaDaZero();
                }
              }}
            >
              Continua
            </Button>
          </Group>
        </Stack>
      </AltezzaAnimata>
  );

  if (dentroFinestra) {
    if (!opened) return null;
    return (
      <Box
        p="lg"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <Box mb="md" style={{ flex: "0 0 auto" }}>
          {titolo}
        </Box>
        <Box className="pt-window-form">
          <Box className="pt-modal-shell">
            <Box className="pt-modal-scroll">{contenuto}</Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="min(900px, calc(100vw - 48px))"
      transitionProps={{ transition: "fade", duration: 200 }}
      title={titolo}
      closeButtonProps={{ tabIndex: -1 }}
      classNames={{
        content: ridimensionando
          ? "pt-nuovo-preventivo-ridimensionamento"
          : undefined,
        body: ridimensionando
          ? "pt-nuovo-preventivo-ridimensionamento"
          : undefined,
      }}
    >
      {contenuto}
    </Modal>
  );
}
