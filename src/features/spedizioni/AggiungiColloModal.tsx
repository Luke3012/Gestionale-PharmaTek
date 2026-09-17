// «Aggiungi collo» a una spedizione già effettuata (lotto). Due strade:
// 1. Scegli da «Da spedire»: uno o più ordini rimasti fuori entrano in QUESTO lotto
//    (riusa `spedizione_crea` col lotto esistente; mantiene l'eventuale contrassegno).
// 2. Riga manuale: un collo SENZA ordine a sistema, coi dati destinatario a mano (servono
//    per la distinta corriere CORRIERE_B/CORRIERE_A) → `spedizione_collo_manuale`.
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { IconPackageOff, IconSearch, IconTruck } from "@tabler/icons-react";
import { api, type OrdineDaSpedire } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { focusInvalidField } from "../../ui/focusInvalid";
import { useModalSnapshot } from "../../ui/useModalSnapshot";
import { setConToggle } from "../../lib/set";
import { VirtualStack } from "../../ui/VirtualStack";
import { DebouncedInput } from "../../ui/DebouncedInput";
import { FooterAzioniModale } from "../../ui/FooterAzioniModale";
import { calcolaImportoSpedizione, colliDistintaAuto, OPZIONI_PAGAMENTO_CONSEGNA } from "./CreaSpedizioneModal";
import { normalizzaColliPesoCorriere } from "./profiliCorriere";
import { ordineHaDatiVaccino } from "./datiVaccino";

type Mezzo = "prepagato" | "contrassegno" | "assegno";

export interface CorriereAggiuntaCollo {
  id: string;
  nome: string;
  profilo: string;
}

export function AggiungiColloModal({
  lotto,
  data,
  corrieri,
  onClose,
  onDone,
}: {
  /** Lotto a cui aggiungere il collo; `null` = modale chiuso. */
  lotto: string | null;
  data: string;
  corrieri: CorriereAggiuntaCollo[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [lottoMostrato, clearLottoMostrato] = useModalSnapshot(lotto);

  return (
    <Modal
      opened={!!lotto}
      onClose={onClose}
      size="lg"
      zIndex={1320}
      title={<Text fw={700}>Aggiungi collo</Text>}
      transitionProps={{ transition: "fade", duration: 160, onExited: clearLottoMostrato }}
    >
      {lottoMostrato && (
        <Corpo lotto={lottoMostrato} data={data} corrieri={corrieri} onClose={onClose} onDone={onDone} />
      )}
    </Modal>
  );
}

function Corpo({
  lotto,
  data,
  corrieri,
  onClose,
  onDone,
}: {
  lotto: string;
  data: string;
  corrieri: CorriereAggiuntaCollo[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"da_spedire" | "manuale">("da_spedire");
  const [salvando, setSalvando] = useState(false);
  const [corriereId, setCorriereId] = useState(() => corrieri.length === 1 ? corrieri[0].id : "");
  const corriereSelezionato = useMemo(
    () => corrieri.find((c) => c.id === corriereId),
    [corrieri, corriereId]
  );

  // --- Da spedire ---
  const [ordini, setOrdini] = useState<OrdineDaSpedire[]>([]);
  const [caric, setCaric] = useState(true);
  const [cerca, setCerca] = useState("");
  const cercaDifferita = useDeferredValue(cerca);
  // Selezione per riga prodotto: consente una spedizione parziale senza duplicare
  // nell'interfaccia l'intero form pesante di creazione spedizione.
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    api
      .righeDaSpedire()
      .then((d) => setOrdini(d))
      .catch((e) => toast.error(`Caricamento ordini non riuscito: ${e}`))
      .finally(() => setCaric(false));
  }, []);
  const toggleRiga = (id: string) =>
    setSel((corrente) => setConToggle(corrente, id));

  const toggleOrdine = (o: OrdineDaSpedire, checked: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      o.righe.forEach((r) => checked ? n.add(r.rigaId) : n.delete(r.rigaId));
      return n;
    });

  const ordiniFiltrati = useMemo(() => {
    const termini = cercaDifferita.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (termini.length === 0) return ordini;
    return ordini.filter((o) => {
      const testo = [
        o.numero,
        o.clienteNome,
        o.medicoNome,
        o.agenteNome,
        o.citta,
        o.prov,
        o.categoria,
        o.telefono,
        o.telefono?.replace(/\D/g, ""),
        ...o.righe.flatMap((r) => [r.prodottoNome, r.paziente, r.numero]),
      ].join(" ").toLowerCase();
      return termini.every((termine) => testo.includes(termine));
    });
  }, [cercaDifferita, ordini]);

  async function aggiungiDaSpedire() {
    if (!corriereId) {
      toast.warning("Scegli il corriere del nuovo collo.");
      focusInvalidField('[data-pt-field="aggiungi-collo-corriere"]');
      return;
    }
    const scelti = ordini
      .map((ordine) => ({ ordine, righe: ordine.righe.filter((r) => sel.has(r.rigaId)) }))
      .filter((x) => x.righe.length > 0);
    if (scelti.length === 0) {
      toast.warning("Seleziona almeno una riga da spedire.");
      return;
    }
    setSalvando(true);
    try {
      for (const { ordine: o, righe: righeScelte } of scelti) {
        const righeCheck = Object.fromEntries(o.righe.map((r) => [r.rigaId, sel.has(r.rigaId)]));
        const mezzo = o.codMezzo || "";
        const contrassegno = mezzo
          ? (o.codImporto && o.codImporto > 0
              ? o.codImporto
              : o.residuo && o.residuo > 0
                ? o.residuo
                : calcolaImportoSpedizione([o], righeCheck))
          : 0;
        const haDatiVaccino = ordineHaDatiVaccino(o);
        const colli = haDatiVaccino
          ? colliDistintaAuto(corriereSelezionato?.profilo || "gls", righeScelte.length)
          : 1;
        await api.spedizioneCrea({
          lotto,
          data,
          corriereId,
          colli,
          peso: colli,
          servizi: "",
          preavviso: true,
          mezzo,
          contrassegno,
          note: o.noteSpedizione || "",
          numeri: righeScelte.map((r) => ({
            rigaId: r.rigaId,
            numero: haDatiVaccino ? r.numero || "" : "",
          })),
        });
      }
      const usaColli = scelti.some(({ ordine }) => ordineHaDatiVaccino(ordine));
      toast.success(
        usaColli
          ? scelti.length === 1
            ? "Collo aggiunto."
            : `${scelti.length} colli aggiunti.`
          : scelti.length === 1
            ? "Spedizione aggiunta."
            : `${scelti.length} spedizioni aggiunte.`,
      );
      onDone();
    } catch (e) {
      toast.error(`Aggiunta non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  // --- Riga manuale ---
  const [m, setM] = useState({
    cliente: "",
    indirizzo: "",
    cap: "",
    citta: "",
    prov: "",
    regione: "",
    telefono: "",
    email: "",
    numero: "",
    colli: 1 as number | "",
    preavviso: true,
    mezzo: "prepagato" as Mezzo,
    importo: "" as number | "",
    note: "",
  });
  const setF = <K extends keyof typeof m>(k: K, v: (typeof m)[K]) => setM((s) => ({ ...s, [k]: v }));

  async function aggiungiManuale() {
    if (!m.cliente.trim()) {
      toast.warning("Indica il destinatario del collo.");
      focusInvalidField('[data-pt-field="aggiungi-collo-cliente"]');
      return;
    }
    if (!corriereId) {
      toast.warning("Scegli il corriere del nuovo collo.");
      focusInvalidField('[data-pt-field="aggiungi-collo-corriere"]');
      return;
    }
    setSalvando(true);
    try {
      const richiesti = m.colli === "" ? 1 : Number(m.colli);
      const { colli, peso } = normalizzaColliPesoCorriere(
        corriereSelezionato?.profilo || "gls",
        richiesti,
        richiesti
      );
      const mezzo = m.mezzo === "prepagato" ? "" : m.mezzo;
      const contrassegno = mezzo && m.importo !== "" ? eurToCents(Number(m.importo)) : 0;
      await api.spedizioneColloManuale({
        lotto,
        data,
        corriereId,
        numero: m.numero.trim(),
        colli,
        peso,
        preavviso: m.preavviso,
        mezzo,
        contrassegno,
        note: m.note.trim(),
        cliente: m.cliente.trim(),
        indirizzo: m.indirizzo.trim(),
        cap: m.cap.trim(),
        citta: m.citta.trim(),
        prov: m.prov.trim(),
        regione: m.regione.trim(),
        telefono: m.telefono.trim(),
        email: m.email.trim(),
      });
      toast.success("Collo manuale aggiunto.");
      onDone();
    } catch (e) {
      toast.error(`Aggiunta non riuscita: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  const nSel = sel.size;
  const corriereData = useMemo(
    () => corrieri.map((c) => ({ value: c.id, label: c.nome || "(corriere)" })),
    [corrieri]
  );

  return (
    <Box className="pt-modal-shell">
      <Box className="pt-modal-scroll">
        <Stack gap="md">
          <SegmentedControl
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
            data={[
              { value: "da_spedire", label: "Scegli da «Da spedire»" },
              { value: "manuale", label: "Riga manuale" },
            ]}
          />

          {corrieri.length !== 1 && (
            <Box data-pt-field="aggiungi-collo-corriere">
              <Select
                label="Corriere del nuovo collo"
                placeholder="Scegli il corriere…"
                data={corriereData}
                value={corriereId || null}
                onChange={(v) => setCorriereId(v || "")}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true, zIndex: 1400 }}
                required
              />
            </Box>
          )}

          {tab === "da_spedire" ? (
            caric ? (
              <Text size="sm" c="dimmed" ta="center" py="lg">
                Carico gli ordini da spedire…
              </Text>
            ) : ordini.length === 0 ? (
              <Stack align="center" gap={6} py="lg" c="dimmed">
                <IconPackageOff size={28} />
                <Text size="sm">Nessun ordine rimasto da spedire.</Text>
              </Stack>
            ) : (
              <Stack gap="sm">
                <DebouncedInput
                  placeholder="Cerca ordine, cliente, telefono, lotto…"
                  leftSection={<IconSearch size={16} />}
                  value={cerca}
                  onChange={setCerca}
                />
                {ordiniFiltrati.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="lg">
                    Nessun ordine corrisponde alla ricerca.
                  </Text>
                ) : (
                  <VirtualStack
                    items={ordiniFiltrati}
                    getKey={(o) => o.ordineId}
                    maxHeight={360}
                    estimateHeight={128}
                    gap={6}
                    overscan={5}
                    renderItem={(o) => {
                      const selezionate = o.righe.filter((r) => sel.has(r.rigaId)).length;
                      const tutte = o.righe.length > 0 && selezionate === o.righe.length;
                      const alcune = selezionate > 0 && !tutte;
                      return (
                    <Box
                      key={o.ordineId}
                      p="xs"
                      style={{
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: 8,
                        background: selezionate > 0 ? "var(--mantine-color-default-hover)" : undefined,
                      }}
                    >
                      <Checkbox
                        checked={tutte}
                        indeterminate={alcune}
                        onChange={(e) => toggleOrdine(o, e.currentTarget.checked)}
                        label={
                          <Box>
                            <Group gap={6}>
                              <Badge size="sm" variant="light">
                                {o.numero || "—"}
                              </Badge>
                              <Text fw={600} size="sm">
                                {o.clienteNome || "(cliente)"}
                              </Text>
                              {["diagnostica", "keriba"].includes((o.categoria || "").trim().toLowerCase()) && (
                                <Badge size="xs" variant="light" color="orange">
                                  {o.categoria}
                                </Badge>
                              )}
                              {o.codMezzo && (
                                <Badge size="sm" variant="light" color="grape">
                                  € {centsToEurStr(o.codImporto)}
                                </Badge>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {[o.citta, o.prov && `(${o.prov})`, `${o.righe.length} ${o.righe.length === 1 ? "riga" : "righe"}`]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          </Box>
                        }
                      />
                      <Stack gap={4} mt={6} ml={30}>
                        {o.righe.map((r) => (
                          <Checkbox
                            key={r.rigaId}
                            size="xs"
                            checked={sel.has(r.rigaId)}
                            onChange={() => toggleRiga(r.rigaId)}
                            label={
                              <Group gap={6} wrap="nowrap">
                                <Text size="xs" fw={500} truncate>
                                  {r.prodottoNome || "(prodotto)"}
                                </Text>
                                {r.paziente && <Text size="xs" c="dimmed" truncate>· {r.paziente}</Text>}
                                {ordineHaDatiVaccino(o) && r.numero && (
                                  <Badge size="xs" variant="outline">{r.numero}</Badge>
                                )}
                              </Group>
                            }
                          />
                        ))}
                      </Stack>
                    </Box>
                      );
                    }}
                  />
                )}
              </Stack>
            )
          ) : (
            <>
              <Text size="xs" c="dimmed">
                Un collo non legato a un ordine. I dati qui sotto finiscono nella distinta corriere.
              </Text>
              <Box data-pt-field="aggiungi-collo-cliente">
                <TextInput
                  label="Destinatario"
                  placeholder="Nome e cognome / ragione sociale"
                  value={m.cliente}
                  onChange={(e) => setF("cliente", e.currentTarget.value)}
                  required
                />
              </Box>
              <TextInput
                label="Indirizzo"
                value={m.indirizzo}
                onChange={(e) => setF("indirizzo", e.currentTarget.value)}
              />
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                <TextInput label="Cap" value={m.cap} onChange={(e) => setF("cap", e.currentTarget.value)} />
                <TextInput label="Città" value={m.citta} onChange={(e) => setF("citta", e.currentTarget.value)} />
                <TextInput label="Prov" value={m.prov} onChange={(e) => setF("prov", e.currentTarget.value)} />
                <TextInput label="Regione" value={m.regione} onChange={(e) => setF("regione", e.currentTarget.value)} />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput label="Telefono" value={m.telefono} onChange={(e) => setF("telefono", e.currentTarget.value)} />
                <TextInput label="E-mail" value={m.email} onChange={(e) => setF("email", e.currentTarget.value)} />
              </SimpleGrid>
              <Group gap="sm" align="flex-end" wrap="nowrap">
                <TextInput
                  label="Numero"
                  placeholder="vaccino"
                  w={110}
                  value={m.numero}
                  onChange={(e) => setF("numero", e.currentTarget.value)}
                />
                <NumberInput
                  label="Colli"
                  w={80}
                  min={1}
                  value={corriereSelezionato?.profilo === "corriere_a" ? 1 : m.colli}
                  disabled={corriereSelezionato?.profilo === "corriere_a"}
                  onChange={(v) => setF("colli", v === "" ? "" : Number(v))}
                />
                <Switch
                  label="Preavviso telefonico"
                  checked={m.preavviso}
                  onChange={(e) => setF("preavviso", e.currentTarget.checked)}
                  mb={6}
                />
              </Group>
              <Group gap="sm" align="flex-end" wrap="nowrap">
                <Select
                  label="Pagamento alla consegna"
                  w={210}
                  data={OPZIONI_PAGAMENTO_CONSEGNA}
                  value={m.mezzo}
                  onChange={(v) => setF("mezzo", (v as Mezzo) || "prepagato")}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true, zIndex: 1400 }}
                />
                {m.mezzo !== "prepagato" && (
                  <NumberInput
                    label="Importo €"
                    w={140}
                    min={0}
                    decimalScale={2}
                    value={m.importo}
                    onChange={(v) => setF("importo", v === "" ? "" : Number(v))}
                  />
                )}
              </Group>
              <Textarea
                label="Note di spedizione"
                value={m.note}
                onChange={(e) => setF("note", e.currentTarget.value)}
                autosize
                minRows={2}
                maxRows={4}
                placeholder="Cosa vuole il cliente?"
              />
            </>
          )}
        </Stack>
      </Box>

      <FooterAzioniModale>
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          {tab === "da_spedire" ? (
            <Button
              color="accent"
              leftSection={<IconTruck size={16} />}
              loading={salvando}
              disabled={nSel === 0}
              onClick={aggiungiDaSpedire}
            >
              Aggiungi{nSel > 0 ? ` (${nSel})` : ""}
            </Button>
          ) : (
            <Button
              color="accent"
              leftSection={<IconTruck size={16} />}
              loading={salvando}
              disabled={!m.cliente.trim()}
              onClick={aggiungiManuale}
            >
              Aggiungi collo
            </Button>
          )}
      </FooterAzioniModale>
    </Box>
  );
}
