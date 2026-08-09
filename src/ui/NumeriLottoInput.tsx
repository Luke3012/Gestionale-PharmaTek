import { useState } from "react";
import { Popover, Stack, Text, TextInput, type TextInputProps } from "@mantine/core";
import { IconListNumbers } from "@tabler/icons-react";

/**
 * I numeri lotto restano compatibili con il campo stringa storico. Per quantità
 * multiple sono separati da newline: non richiede migrazioni e conserva l'ordine
 * lotto ↔ singola unità del prodotto.
 */
export function leggiNumeriLotto(valore: string, quantita: number): string[] {
  const qta = Math.max(1, Math.floor(quantita || 1));
  const letti = String(valore ?? "").replace(/\r/g, "").split("\n");
  return Array.from({ length: qta }, (_, index) => letti[index] ?? "");
}

export function serializzaNumeriLotto(numeri: string[]): string {
  const normalizzati = numeri.map((numero) => numero.replace(/[\r\n]+/g, " "));
  while (normalizzati.length > 0 && !normalizzati[normalizzati.length - 1].trim()) {
    normalizzati.pop();
  }
  return normalizzati.join("\n");
}

type Props = Omit<TextInputProps, "value" | "onChange"> & {
  value: string;
  quantita: number;
  onChange: (value: string) => void;
};

/** Un solo campo nella UI; se qta > 1 apre il piccolo elenco per-unità. */
export function NumeriLottoInput({ value, quantita, onChange, label, placeholder, ...props }: Props) {
  const [aperto, setAperto] = useState(false);
  const qta = Math.max(1, Math.floor(quantita || 1));
  const numeri = leggiNumeriLotto(value, qta);
  const numeriPersistiti = String(value ?? "").replace(/\r/g, "").split("\n");
  const aggiorna = (index: number, numero: string) => {
    // Se la quantità viene temporaneamente ridotta, non perdiamo i lotti che
    // restano nascosti: potranno riapparire ripristinando la quantità precedente.
    const next = Array.from(
      { length: Math.max(qta, numeriPersistiti.length) },
      (_, i) => numeriPersistiti[i] ?? ""
    );
    next[index] = numero;
    onChange(serializzaNumeriLotto(next));
  };

  if (qta <= 1) {
    return (
      <TextInput
        {...props}
        label={label}
        placeholder={placeholder}
        value={numeri[0]}
        onChange={(event) => aggiorna(0, event.currentTarget.value)}
      />
    );
  }

  const compilati = numeri.filter((numero) => numero.trim()).length;
  const extraCompilati = numeriPersistiti.slice(qta).filter((numero) => numero.trim()).length;
  const numeriVisibili = leggiNumeriLotto(value, Math.max(qta, numeriPersistiti.length));

  return (
    <Popover
      opened={aperto}
      onChange={setAperto}
      position="bottom-end"
      withinPortal
      withArrow
      shadow="md"
      width={280}
      zIndex={1600}
    >
      <Popover.Target>
        <TextInput
          {...props}
          label={label}
          placeholder={placeholder || `Inserisci ${qta} lotti`}
          value={compilati > 0 || extraCompilati > 0
            ? `${compilati}/${qta} lotti compilati${extraCompilati > 0 ? ` · ${extraCompilati} extra` : ""}`
            : ""}
          readOnly
          rightSection={<IconListNumbers size={15} />}
          onClick={() => setAperto(true)}
          onFocus={() => setAperto(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setAperto(true);
          }}
          styles={{ input: { cursor: "pointer" } }}
        />
      </Popover.Target>
      <Popover.Dropdown p="sm" data-mantine-stop-propagation="true">
        <Text size="xs" c="dimmed" mb="xs">
          Un numero lotto per ciascuna delle {qta} unità.
        </Text>
        {extraCompilati > 0 && (
          <Text size="xs" c="red" mb="xs">
            Sono presenti lotti oltre la quantità attuale: svuotali oppure ripristina la quantità.
          </Text>
        )}
        <Stack gap={6}>
          {numeriVisibili.map((numero, index) => (
            <TextInput
              key={index}
              size="xs"
              label={index < qta ? `Lotto ${index + 1}` : `Lotto extra ${index + 1 - qta}`}
              error={index >= qta && numero.trim() ? "Oltre la quantità" : undefined}
              value={numero}
              onChange={(event) => aggiorna(index, event.currentTarget.value)}
              autoFocus={index === 0}
            />
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
