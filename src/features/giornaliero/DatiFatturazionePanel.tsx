import { useCallback, useState } from "react";
import { Autocomplete, Box, Button, Collapse, Group, Popover, Stack, Text, TextInput } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

import { cercaPerCAP, cercaPerCitta, type ComuneInfo } from "../../lib/cap-lookup";
import { useCloseOnScroll } from "../../lib/closeOnScroll";
import { CalcolaCFPopover, CFValidationBadge } from "../anagrafiche/CalcolaCFPopover";

export interface DatiFatturazione {
  ragione_sociale: string;
  indirizzo: string;
  citta: string;
  prov: string;
  cap: string;
  piva: string;
}

interface Props {
  expanded: boolean;
  value: DatiFatturazione;
  onToggle: () => void;
  onChange: (value: DatiFatturazione) => void;
}

/** Campi di fatturazione opzionali, inclusa la disambiguazione CAP/città. */
export function DatiFatturazionePanel({ expanded, value, onToggle, onChange }: Props) {
  const [suggerimentiCitta, setSuggerimentiCitta] = useState<string[]>([]);
  const [capAmbiguo, setCapAmbiguo] = useState<ComuneInfo[] | null>(null);
  const [capCittaMultiplo, setCapCittaMultiplo] = useState<ComuneInfo | null>(null);
  const [capPopoverAperto, setCapPopoverAperto] = useState(false);
  useCloseOnScroll(capPopoverAperto, setCapPopoverAperto);

  const aggiorna = useCallback(
    (patch: Partial<DatiFatturazione>) => onChange({ ...value, ...patch }),
    [onChange, value]
  );
  const usaComune = useCallback(
    (
      info: ComuneInfo,
      opzioni: { capSelezionato?: string; mostraCapMultipli?: boolean } = {},
    ) => {
      aggiorna({
        citta: info.nome,
        prov: info.sigla,
        ...(opzioni.capSelezionato
          ? { cap: opzioni.capSelezionato }
          : info.cap.length === 1
            ? { cap: info.cap[0] }
            : {}),
      });
      setCapAmbiguo(null);
      if (opzioni.mostraCapMultipli && info.cap.length > 1) {
        setCapCittaMultiplo(info);
        setCapPopoverAperto(true);
      } else {
        setCapCittaMultiplo(null);
        setCapPopoverAperto(false);
      }
    },
    [aggiorna]
  );

  function cambiaCap(cap: string) {
    aggiorna({ cap });
    if (cap.length === 5 && /^\d{5}$/.test(cap)) {
      const risultato = cercaPerCAP(cap);
      if (risultato?.univoco) {
        usaComune(risultato.comuni[0], { capSelezionato: cap });
      }
      else if (risultato) {
        setCapCittaMultiplo(null);
        setCapAmbiguo(risultato.comuni);
        setCapPopoverAperto(true);
      }
    } else {
      setCapAmbiguo(null);
      setCapCittaMultiplo(null);
      setCapPopoverAperto(false);
    }
  }

  function cambiaCitta(query: string) {
    aggiorna({ citta: query });
    setSuggerimentiCitta(query.length < 2 ? [] : cercaPerCitta(query, 10).map((comune) => comune.nome));
  }

  function selezionaCitta(nome: string) {
    const comune = cercaPerCitta(nome, 1).find((risultato) => risultato.nome.toLowerCase() === nome.toLowerCase());
    if (comune) usaComune(comune, { mostraCapMultipli: true });
  }

  return (
    <Box>
      <Button variant="subtle" color="gray" size="compact-sm" leftSection={expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />} onClick={onToggle}>
        Dati di fatturazione diversi?
      </Button>
      <Collapse expanded={expanded}>
        <Stack gap="xs" mt="xs">
          <TextInput label="Ragione sociale" value={value.ragione_sociale} onChange={(e) => aggiorna({ ragione_sociale: e.currentTarget.value })} />
          <TextInput label="Indirizzo" value={value.indirizzo} onChange={(e) => aggiorna({ indirizzo: e.currentTarget.value })} />
          <Group grow align="flex-start">
            <Autocomplete
              label="Città"
              value={value.citta}
              onChange={cambiaCitta}
              onOptionSubmit={selezionaCitta}
              onKeyDown={(e) => {
                if (e.key === "Tab" && suggerimentiCitta.length > 0) {
                  cambiaCitta(suggerimentiCitta[0]);
                  selezionaCitta(suggerimentiCitta[0]);
                }
              }}
              data={suggerimentiCitta}
              limit={8}
              comboboxProps={{ zIndex: 1400 }}
            />
            <TextInput label="Prov." maxLength={2} value={value.prov} onChange={(e) => aggiorna({ prov: e.currentTarget.value.toUpperCase() })} />
            {capAmbiguo || capCittaMultiplo ? (
              <Popover opened={capPopoverAperto} onChange={setCapPopoverAperto} position="bottom-start" shadow="md" radius="md" width={280} withArrow zIndex={1400}>
                <Popover.Target><TextInput label="CAP" maxLength={5} value={value.cap} onChange={(e) => cambiaCap(e.currentTarget.value)} /></Popover.Target>
                <Popover.Dropdown p="xs" data-mantine-stop-propagation="true">
                  <Text size="xs" fw={600} c="dimmed" mb={4}>
                    {capCittaMultiplo
                      ? `Più CAP per ${capCittaMultiplo.nome}:`
                      : "Più comuni per questo CAP:"}
                  </Text>
                  <Stack gap={2}>
                    {capCittaMultiplo
                      ? capCittaMultiplo.cap.map((cap) => (
                          <Button
                            key={cap}
                            variant="subtle"
                            size="xs"
                            justify="flex-start"
                            fullWidth
                            onClick={() =>
                              usaComune(capCittaMultiplo, {
                                capSelezionato: cap,
                              })
                            }
                          >
                            {cap} — {capCittaMultiplo.nome} ({capCittaMultiplo.sigla})
                          </Button>
                        ))
                      : capAmbiguo?.map((comune) => (
                          <Button key={comune.nome} variant="subtle" size="xs" justify="flex-start" fullWidth onClick={() => usaComune(comune)}>
                            {comune.nome} ({comune.sigla}) — {comune.regione}
                          </Button>
                        ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            ) : (
              <TextInput label="CAP" maxLength={5} value={value.cap} onChange={(e) => cambiaCap(e.currentTarget.value)} />
            )}
          </Group>
          <Box>
            <TextInput label="P.IVA / CF" value={value.piva} onChange={(e) => aggiorna({ piva: e.currentTarget.value.toUpperCase() })} rightSection={<CalcolaCFPopover nomeRecord={value.ragione_sociale} onUsaCF={(cf) => aggiorna({ piva: cf.toUpperCase() })} />} />
            <CFValidationBadge valoreCF={value.piva} />
          </Box>
          <Text size="xs" c="dimmed">Se vuoti, in fatturazione si usano i dati del cliente dell'ordine.</Text>
        </Stack>
      </Collapse>
    </Box>
  );
}
