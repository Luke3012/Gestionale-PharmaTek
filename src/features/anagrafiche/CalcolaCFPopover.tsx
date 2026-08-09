// Popover per il calcolo del Codice Fiscale — ancorato al pulsante nel campo CF.
// Design pulito e minimale, in linea con il resto dell'applicazione.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Box,
  Button,
  Group,
  Popover,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCalculator, IconCheck, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  calcolaCodiceFiscale,
  validaCodiceFiscale,
  type InputCF,
} from "../../lib/codice-fiscale";
import { BELFIORE } from "../../data/belfiore";
import { dividiNomeCognomeIntelligente } from "./nomeCognome";

// ── Autocomplete comuni (Belfiore) ──────────────────────────────────

/** Cache lazy della lista nomi comuni per l'autocomplete. */
let _nomiComuni: string[] | null = null;
function nomiComuni(): string[] {
  if (!_nomiComuni) {
    _nomiComuni = Object.keys(BELFIORE).map(capitalizza);
  }
  return _nomiComuni;
}

function capitalizza(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function filtraComuni(query: string): string[] {
  if (query.length < 2) return [];
  const q = query.toLowerCase();
  const lista = nomiComuni();
  const inizia: string[] = [];
  const contiene: string[] = [];
  for (const nome of lista) {
    const n = nome.toLowerCase();
    if (n.startsWith(q)) inizia.push(nome);
    else if (n.includes(q)) contiene.push(nome);
    if (inizia.length >= 8) break;
  }
  return [...inizia, ...contiene].slice(0, 8);
}

import { useCloseOnScroll } from "../../lib/closeOnScroll";

export function CalcolaCFPopover({
  nomeRecord,
  onUsaCF,
}: {
  nomeRecord: string;
  onUsaCF: (cf: string) => void;
}) {
  const [aperto, setAperto] = useState(false);
  useCloseOnScroll(aperto, setAperto);
  const [cognome, setCognome] = useState("");
  const [nome, setNome] = useState("");
  const [dataNascitaStr, setDataNascitaStr] = useState("");
  const [sesso, setSesso] = useState<"M" | "F">("M");
  const [comune, setComune] = useState("");
  const [suggerimentiComuni, setSuggerimentiComuni] = useState<string[]>([]);

  const cognomeRef = useRef<HTMLInputElement>(null);

  // All'apertura: split automatico nome/cognome dalla ragione sociale.
  useEffect(() => {
    if (aperto) {
      const parti = dividiNomeCognomeIntelligente(nomeRecord ?? "");
      setCognome(parti.cognome);
      setNome(parti.nome);
      setTimeout(() => cognomeRef.current?.focus(), 50);
    }
  }, [aperto, nomeRecord]);

  // Calcolo CF dal vivo.
  const risultato = useMemo(() => {
    if (!cognome || !nome || !dataNascitaStr || !comune) return null;
    const dataNascita = new Date(dataNascitaStr);
    if (isNaN(dataNascita.getTime())) return null;

    const input: InputCF = {
      nome,
      cognome,
      dataNascita,
      sesso,
      comuneNascita: comune,
    };
    return calcolaCodiceFiscale(input);
  }, [cognome, nome, dataNascitaStr, sesso, comune]);

  const cfCalcolato = risultato?.cf ?? "";
  const comuneNonTrovato = risultato?.comuneNonTrovato ?? false;
  const cfCompleto = cfCalcolato.length === 16;

  function usaCF() {
    if (cfCompleto) {
      onUsaCF(cfCalcolato);
      setAperto(false);
    }
  }

  return (
    <Popover
      opened={aperto}
      onChange={setAperto}
      width={360}
      position="bottom-end"
      shadow="md"
      radius="md"
      withArrow={false}
      trapFocus
      closeOnClickOutside
      closeOnEscape
      zIndex={1100}
    >
      <Popover.Target>
        <Tooltip label="Calcola Codice Fiscale" withArrow zIndex={1500}>
          <ActionIcon
            variant="subtle"
            color="accent"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setAperto((o) => !o);
            }}
          >
            <IconCalculator size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown
        p="md"
        // Mantine chiude Modal/Popover sull'Escape con un listener su `window` in fase di
        // CAPTURE: gira PRIMA di ogni handler React, perciò `stopPropagation` qui non basta a
        // proteggere il modale ospite (era il nostro tentativo precedente, di fatto inerte —
        // il Popover ignora pure l'onKeyDownCapture quando ha closeOnEscape attivo). L'unico
        // aggancio è l'attributo che lo stesso listener del Modal controlla su `event.target`:
        // marcando l'elemento a fuoco, l'Escape chiude solo questo popover (se ne occupa
        // Mantine) senza risalire a chiudere il «Nuovo/Modifica» che lo ospita. È la stessa
        // tecnica che Mantine usa per i suoi Combobox annidati nei modali.
        data-mantine-stop-propagation="true"
        onFocusCapture={(e) => {
          const t = e.target as HTMLElement | null;
          t?.setAttribute?.("data-mantine-stop-propagation", "true");
        }}
      >
        <Text fw={600} size="sm" mb="sm" c="dimmed">
          Numero/Codice Fiscale
        </Text>

        <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <TextInput
            ref={cognomeRef}
            size="xs"
            label="Cognome"
            value={cognome}
            onChange={(e) => setCognome(e.currentTarget.value)}
            placeholder="es. Rossi"
          />
          <TextInput
            size="xs"
            label="Nome"
            value={nome}
            onChange={(e) => setNome(e.currentTarget.value)}
            placeholder="es. Mario"
          />
          <TextInput
            type="date"
            size="xs"
            label="Data di nascita"
            value={dataNascitaStr}
            onChange={(e) => setDataNascitaStr(e.currentTarget.value)}
          />
          <Box>
            <Text size="xs" fw={500} mb={4}>
              Sesso
            </Text>
            <SegmentedControl
              size="xs"
              fullWidth
              data={[
                { value: "M", label: "M" },
                { value: "F", label: "F" },
              ]}
              value={sesso}
              onChange={(v) => setSesso(v as "M" | "F")}
            />
          </Box>
          <Box style={{ gridColumn: "1 / -1" }}>
            <Autocomplete
              size="xs"
              label="Comune di nascita"
              value={comune}
              onChange={(v) => {
                setComune(v);
                setSuggerimentiComuni(filtraComuni(v));
              }}
              onKeyDown={(e) => {
                if (e.key === "Tab" && suggerimentiComuni.length > 0) {
                  setComune(suggerimentiComuni[0]);
                }
              }}
              data={suggerimentiComuni}
              placeholder="es. Roma"
              limit={8}
              error={comuneNonTrovato ? "Comune non trovato" : undefined}
              comboboxProps={{ zIndex: 1200, withinPortal: false }}
            />
          </Box>
        </Box>

        <Group justify="space-between" align="center" mt="md">
          <Box>
            {cfCompleto ? (
              <Text ff="monospace" size="lg" fw={700} c="var(--mantine-color-accent-6)" style={{ letterSpacing: 1 }}>
                {cfCalcolato}
              </Text>
            ) : (
              <Text size="xs" c="dimmed">Compila tutti i campi</Text>
            )}
          </Box>
          <Button size="xs" color="accent" disabled={!cfCompleto} onClick={usaCF} radius="md">
            Usa
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Badge validazione esposto per l'uso sotto il TextInput in RegistroView */
export function CFValidationBadge({ valoreCF }: { valoreCF: string }) {
  const validazione = useMemo(() => {
    const v = (valoreCF ?? "").trim();
    if (v.length < 11) return null;
    return validaCodiceFiscale(v);
  }, [valoreCF]);

  return (
    <AnimatePresence>
      {validazione && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          <Badge
            size="xs"
            variant="light"
            color={validazione.valido ? "teal" : "red"}
            mt={4}
            leftSection={
              validazione.valido ? <IconCheck size={10} /> : <IconX size={10} />
            }
          >
            {validazione.valido
              ? validazione.tipo === "partita_iva"
                ? "P.IVA valida"
                : "CF valido"
              : "Non valido"}
          </Badge>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
