import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconUpload,
} from "@tabler/icons-react";
import { motion } from "framer-motion";
import { api, type RecordDto } from "../../lib/tauri";
import { usePrefs } from "../../lib/prefs";
import { EsportaTabella, type ColonnaExport } from "../../ui/esporta/EsportaTabella";
import { toast } from "../../ui/toast/store";
import { FooterAzioniModale } from "../../ui/FooterAzioniModale";
import {
  clienteDaMigrareArubaLegacy,
  clienteGiaEsportatoAruba,
  filtraClientiAruba,
  preparaRigheAruba,
  type RigaAruba,
} from "./exportAruba";

const ARUBA_STATO_ENTITY = "parametri_globali";
const ARUBA_STATO_ID = "aruba_export";
const ARUBA_MIGRAZIONE_VERSIONE = 1;

// Decodifica i primi 10 caratteri di un ULID (Crockford Base-32) come millisecondi epoch
// Alfabeto Crockford: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (no I, L, O, U)
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function dataCreazioneDaId(id: string): Date {
  try {
    const tsChars = id.slice(0, 10).toUpperCase();
    let ms = 0;
    for (let i = 0; i < tsChars.length; i++) {
      const val = CROCKFORD.indexOf(tsChars[i]);
      if (val === -1) return new Date();
      ms = ms * 32 + val;
    }
    if (ms > 0) return new Date(ms);
  } catch {
    // ignore
  }
  return new Date();
}

export function ExportArubaModal({
  aperto,
  onClose,
}: {
  aperto: boolean;
  onClose: () => void;
}) {
  const { ridurreAnimazioni } = usePrefs();
  const [anteprimaExportAperta, setAnteprimaExportAperta] = useState(false);
  const [clients, setClients] = useState<RecordDto[]>([]);
  const lockArubaPreso = useRef(false);
  const idsUltimoExport = useRef<Set<string> | null>(null);
  const cfUltimoExport = useRef<Map<string, string>>(new Map());
  
  // Date filter states (YYYY-MM-DD)
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [generaFake, setGeneraFake] = useState(false);
  
  // Carica i clienti dal database all'apertura
  useEffect(() => {
    if (!aperto) return;
    let annullato = false;
    setAnteprimaExportAperta(false);
    setGeneraFake(false);
    setDal("");
    setAl(new Date().toISOString().slice(0, 10));

    async function caricaEMigra() {
      try {
        const [res, stato] = await Promise.all([
          api.recordsList("cliente"),
          api.recordGet(ARUBA_STATO_ENTITY, ARUBA_STATO_ID),
        ]);
        let caricati = res;
        const versione = Number(stato?.data.migrazione_versione ?? 0);
        if (versione < ARUBA_MIGRAZIONE_VERSIONE) {
          const ultimoIdLegacy = localStorage.getItem("pt.ultimoClienteEsportatoId") || "";
          const migrati = ultimoIdLegacy
            ? res.filter((cliente) => clienteDaMigrareArubaLegacy(cliente, ultimoIdLegacy))
            : [];
          const migratoIl = new Date().toISOString();
          await Promise.all(
            migrati.map((cliente) =>
              api.recordUpdate("cliente", cliente.id, { aruba_esportato_il: migratoIl })
            )
          );
          await api.recordCreateId(ARUBA_STATO_ENTITY, ARUBA_STATO_ID, {
            migrazione_versione: ARUBA_MIGRAZIONE_VERSIONE,
            migrato_il: migratoIl,
          });
          const migratiIds = new Set(migrati.map((cliente) => cliente.id));
          caricati = res.map((cliente) =>
            migratiIds.has(cliente.id)
              ? { ...cliente, data: { ...cliente.data, aruba_esportato_il: migratoIl } }
              : cliente
          );
        }
        if (!annullato) setClients(caricati);
      } catch (e) {
        if (!annullato) toast.error(`Impossibile preparare l'esportazione Aruba: ${e}`);
      }
    }
    void caricaEMigra();
    return () => {
      annullato = true;
    };
  }, [aperto]);

  // I clienti già esportati sono marcati sul record e quindi condivisi fra tutti i PC.
  // Lasciare "Dal" vuoto recupera anche gli esclusi storici che nel frattempo ricevono il CF.
  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      if (clienteGiaEsportatoAruba(c)) return false;
      const d = dataCreazioneDaId(c.id);
      const iso = d.toISOString().slice(0, 10);
      if (dal && iso < dal) return false;
      if (al && iso > al) return false;
      return true;
    });
  }, [clients, dal, al]);

  // Conteggi e controllo CF
  const countMancantiCF = useMemo(() => {
    return filteredClients.filter((c) => !((c.data.cf as string) || "").trim()).length;
  }, [filteredClients]);

  const clientiDaPreparare = useMemo(
    () => filtraClientiAruba(filteredClients, generaFake),
    [filteredClients, generaFake]
  );
  const preparazioneAruba = useMemo(() => preparaRigheAruba(clientiDaPreparare), [clientiDaPreparare]);
  const processedExportRows = preparazioneAruba.righe;

  // Definizione delle 23 colonne Aruba
  const columns: ColonnaExport<RigaAruba>[] = [
    { key: "cod_cliente", label: "Codice cliente", valore: () => "" },
    { key: "tipo_cliente", label: "Tipo cliente", valore: () => "Privato" },
    { key: "ind_telematico", label: "Indirizzo telematico (Codice SDI o PEC)", valore: () => "" },
    { key: "email", label: "Email", valore: (r) => r.email },
    { key: "pec", label: "PEC", valore: () => "" },
    { key: "telefono", label: "Telefono", valore: (r) => r.telefono },
    { key: "id_paese", label: "ID Paese", valore: () => "IT" },
    { key: "piva", label: "Partita Iva   ", valore: () => "" },
    { key: "cf", label: "Codice fiscale", valore: (r) => r.cf },
    { key: "denominazione", label: "Denominazione", valore: (r) => [r.cognome, r.nome].filter(Boolean).join(" ") },
    { key: "nome", label: "Nome", valore: (r) => r.nome },
    { key: "cognome", label: "Cognome", valore: (r) => r.cognome },
    { key: "eori", label: "Codice EORI (solo Privati)", valore: () => "" },
    { key: "nazione", label: "Nazione", valore: () => "IT" },
    { key: "cap", label: "CAP", valore: (r) => r.cap },
    { key: "provincia", label: "Provincia", valore: (r) => r.prov },
    { key: "comune", label: "Comune", valore: (r) => r.citta },
    { key: "indirizzo", label: "Indirizzo", valore: (r) => r.indirizzo },
    { key: "civico", label: "Numero civico", valore: (r) => r.civico },
    { key: "beneficiario", label: "Beneficiario", valore: () => "" },
    { key: "cond_pagamento", label: "Condizioni di pagamento", valore: () => "" },
    { key: "metodo_pagamento", label: "Metodo di pagamento", valore: () => "" },
    { key: "banca", label: "Banca", valore: () => "" },
  ];

  async function preparaExportAggiornato(): Promise<RigaAruba[]> {
    await api.acquisisciLock("esportazione_aruba");
    lockArubaPreso.current = true;

    // Il lock impedisce una seconda esportazione cooperativa; il sync immediato fa sì
    // che il controllo legga anche le marcature appena arrivate dagli altri PC.
    await api.forceSync();
    const correnti = await api.recordsList("cliente");
    setClients(correnti);
    const filtratiCorrenti = correnti.filter((cliente) => {
      if (clienteGiaEsportatoAruba(cliente)) return false;
      const iso = dataCreazioneDaId(cliente.id).toISOString().slice(0, 10);
      if (dal && iso < dal) return false;
      if (al && iso > al) return false;
      return true;
    });
    const preparazioneCorrente = preparaRigheAruba(
      filtraClientiAruba(filtratiCorrenti, generaFake)
    );
    const idsAnteprima = processedExportRows.map((row) => String(row.id)).sort();
    const idsCorrenti = preparazioneCorrente.righe.map((row) => String(row.id)).sort();
    if (JSON.stringify(idsAnteprima) !== JSON.stringify(idsCorrenti)) {
      throw new Error(
        "l'elenco dei clienti è cambiato su un altro PC. L'anteprima è stata aggiornata: controllala e riprova."
      );
    }
    idsUltimoExport.current = new Set(idsCorrenti);
    cfUltimoExport.current = new Map(
      filtratiCorrenti
        .filter((cliente) => idsUltimoExport.current?.has(cliente.id))
        .map((cliente) => [cliente.id, String(cliente.data.cf ?? "").trim().toUpperCase()])
    );
    // Se sono cambiati indirizzo o altri dati, il file usa comunque la versione più recente.
    return preparazioneCorrente.righe;
  }

  async function rilasciaLockAruba() {
    if (!lockArubaPreso.current) return;
    lockArubaPreso.current = false;
    await api.rilasciaLock("esportazione_aruba");
  }

  async function marcaClientiEsportati() {
    const ids = idsUltimoExport.current ?? new Set(processedExportRows.map((row) => String(row.id)));
    if (ids.size === 0) return;
    const esportatoIl = new Date().toISOString();
    try {
      await Promise.all(
        [...ids].map((id) =>
          api.recordUpdate("cliente", id, {
            aruba_esportato_il: esportatoIl,
            aruba_cf_esportato: cfUltimoExport.current.get(id) ?? "",
            aruba_ricandidato_il: "",
          })
        )
      );
      setClients((correnti) =>
        correnti.map((cliente) =>
          ids.has(cliente.id)
            ? {
                ...cliente,
                data: {
                  ...cliente.data,
                  aruba_esportato_il: esportatoIl,
                  aruba_cf_esportato: cfUltimoExport.current.get(cliente.id) ?? "",
                  aruba_ricandidato_il: "",
                },
              }
            : cliente
        )
      );
      const ultimoId = [...ids].sort((a, b) => b.localeCompare(a))[0];
      if (ultimoId) localStorage.setItem("pt.ultimoClienteEsportatoId", ultimoId);
    } catch (e) {
      toast.warning(
        `Il file è stato creato, ma lo stato condiviso Aruba non è stato aggiornato: i clienti resteranno disponibili. ${e}`
      );
    }
  }

  return (
    <Modal
      opened={aperto}
      onClose={onClose}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="teal" radius="md">
            <IconUpload size={18} />
          </ThemeIcon>
          <Text fw={700}>Esportazione Periodica Aruba</Text>
        </Group>
      }
      size="md"
      centered
      transitionProps={{ transition: "fade", duration: 180 }}
      closeOnEscape={!anteprimaExportAperta}
      closeOnClickOutside={!anteprimaExportAperta}
    >
      <motion.div
        initial={ridurreAnimazioni ? {} : { opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Box className="pt-modal-shell">
          <Box className="pt-modal-scroll">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Esporta le anagrafiche dei clienti create in un dato periodo in un file Excel conforme ad Aruba.
              </Text>

              <Group grow gap="xs">
                <TextInput
                  type="date"
                  label="Dal (creazione)"
                  value={dal}
                  onChange={(e) => setDal(e.currentTarget.value)}
                  variant="filled"
                  radius="md"
                />
                <TextInput
                  type="date"
                  label="Al (creazione)"
                  value={al}
                  onChange={(e) => setAl(e.currentTarget.value)}
                  variant="filled"
                  radius="md"
                />
              </Group>

              <Paper withBorder radius="md" p="xs" bg="var(--mantine-color-default)" mt="xs">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>Clienti trovati nel periodo:</Text>
                  <Badge size="md" variant="light" color="gray">{filteredClients.length}</Badge>
                </Group>
            
                <Divider my="xs" variant="dashed" />
            
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {generaFake ? "Clienti da esportare (con FAKE):" : "Clienti da esportare (senza FAKE):"}
                  </Text>
                  <Text size="sm" c={generaFake ? "teal" : "blue"} fw={700}>{processedExportRows.length}</Text>
                </Group>
              </Paper>

              {countMancantiCF > 0 && (
                <Alert color="yellow" variant="light" radius="md" p="xs" icon={<IconAlertTriangle size={18} />} mt="xs">
                  <Text size="sm" fw={600}>
                    {countMancantiCF} clienti non hanno il Codice Fiscale.
                  </Text>
                  <Text size="xs" mt={2} c="dimmed">
                    {generaFake
                      ? <>Il gestionale creerà codici provvisori e aggiungerà <Text component="span" fw={700} inherit>(FAKE)</Text> al cognome nel file. Le anagrafiche originali non vengono modificate.</>
                      : <>Con l'opzione <Text component="span" fw={700} inherit>No FAKE</Text> questi clienti restano esclusi dall'esportazione.</>}
                  </Text>
                </Alert>
              )}

              <Switch
                checked={generaFake}
                onChange={(event) => setGeneraFake(event.currentTarget.checked)}
                label={generaFake ? "Sì FAKE — includi i clienti senza CF" : "No FAKE — escludi i clienti senza CF"}
                description="La scelta riguarda solo il file Aruba e non modifica le anagrafiche."
                color="teal"
              />
            </Stack>
          </Box>

          <FooterAzioniModale>
              <Button variant="subtle" color="gray" onClick={onClose} radius="md">
                Annulla
              </Button>
            
              <EsportaTabella
                aperto={anteprimaExportAperta}
                onApertoChange={setAnteprimaExportAperta}
                nomeBase="ArubaClienti"
                foglio="Clienti"
                colonne={columns}
                righe={processedExportRows}
                colonneFisse={true}
                etichetta="Procedi all'esportazione"
                disabled={processedExportRows.length === 0}
                splitExcel={{
                  maxRigheDatiPerFile: 499,
                  defaultAttivo: true,
                  label: "Dividi automaticamente per Aruba",
                  descrizione: `Aruba accetta massimo 500 righe totali per file: verranno creati file con 1 intestazione + massimo 499 clienti.`,
                }}
                primaDiSalvareExcel={preparaExportAggiornato}
                dopoSalvataggioExcel={rilasciaLockAruba}
                onExcelSuccess={marcaClientiEsportati}
                onSuccess={onClose}
              />
          </FooterAzioniModale>
        </Box>
      </motion.div>
    </Modal>
  );
}
