import { useCallback } from "react";
import { Autocomplete, Box, Button, Collapse, Group, Popover, Stack, Text, TextInput } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

import {
  cercaCittaSelezionata,
  type ComuneInfo,
} from "../../lib/cap-lookup";
import { CalcolaCFPopover, CFValidationBadge } from "../anagrafiche/CalcolaCFPopover";
import { ScelteCapPopover } from "../../ui/ScelteCapPopover";
import { useScelteCap } from "../../ui/useScelteCap";

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
  const {
    suggerimentiCitta, capAmbiguo, capCittaMultiplo, capPopoverAperto,
    setCapPopoverAperto, dopoSceltaComune, gestisciCap, suggerisciCitta,
  } = useScelteCap();

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
      dopoSceltaComune(info, opzioni.mostraCapMultipli);
    },
    [aggiorna, dopoSceltaComune]
  );

  function cambiaCap(cap: string) {
    aggiorna({ cap });
    gestisciCap(cap, (comune) => usaComune(comune, { capSelezionato: cap }));
  }

  function cambiaCitta(query: string) {
    aggiorna({ citta: query });
    suggerisciCitta(query);
  }

  function selezionaCitta(nome: string) {
    const comune = cercaCittaSelezionata(nome);
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
                <ScelteCapPopover
                  capCittaMultiplo={capCittaMultiplo}
                  capAmbiguo={capAmbiguo}
                  onScegli={usaComune}
                />
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
