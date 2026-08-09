import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Group, Select, Tooltip } from "@mantine/core";
import { IconPencil, IconUserPlus } from "@tabler/icons-react";

/** Select anagrafica con modifica e creazione rapida del testo non trovato. */
export function SelectConNuovo({
  label,
  placeholder,
  data,
  value,
  onChange,
  entita,
  onNuovo,
  onModifica,
  modificaTitle,
  withAsterisk,
}: {
  label: string;
  placeholder: string;
  data: { value: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  entita: string;
  onNuovo: (nome: string) => void;
  onModifica?: () => void;
  modificaTitle?: string;
  withAsterisk?: boolean;
}) {
  const [search, setSearch] = useState("");
  const term = search.trim();
  const nonTrovato = useMemo(() => {
    if (!term || value) return false;
    const testo = term.toLowerCase();
    return !data.some((opzione) => opzione.label.toLowerCase().includes(testo));
  }, [term, value, data]);

  const [shake, setShake] = useState(false);
  const eraNonTrovato = useRef(false);
  useEffect(() => {
    if (nonTrovato && !eraNonTrovato.current) {
      setShake(true);
      const id = setTimeout(() => setShake(false), 500);
      eraNonTrovato.current = true;
      return () => clearTimeout(id);
    }
    if (!nonTrovato) eraNonTrovato.current = false;
  }, [nonTrovato]);

  const ultimoTestoRef = useRef("");
  useEffect(() => {
    if (term) ultimoTestoRef.current = term;
  }, [term]);
  useEffect(() => {
    if (value) ultimoTestoRef.current = "";
  }, [value]);

  return (
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <Select
        label={label}
        placeholder={placeholder}
        data={data}
        value={value || null}
        onChange={(next) => onChange(next ?? "")}
        searchable
        clearable
        onSearchChange={setSearch}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey && !value && term) {
            const testo = term.toLowerCase();
            const opzione =
              data.find((voce) => voce.label.toLowerCase().startsWith(testo)) ??
              data.find((voce) => voce.label.toLowerCase().includes(testo));
            if (opzione) onChange(opzione.value);
          } else if (event.key === "Backspace" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        limit={100}
        allowDeselect={false}
        withAsterisk={withAsterisk}
        nothingFoundMessage="Nessun risultato — usa «Nuovo» per crearla"
        style={{ flex: 1 }}
      />
      {onModifica && (
        <Button
          variant="default"
          leftSection={<IconPencil size={16} />}
          disabled={!value}
          onClick={onModifica}
          title={modificaTitle}
        >
          Modifica
        </Button>
      )}
      <Tooltip
        label={`«${term || ultimoTestoRef.current}» non è in elenco. Crea ${entita}?`}
        opened={nonTrovato}
        position="top-end"
        withArrow
        color="dark"
        multiline
        maw={220}
      >
        <Button
          variant={nonTrovato ? "filled" : "default"}
          color="accent"
          leftSection={<IconUserPlus size={16} />}
          onClick={() => onNuovo(ultimoTestoRef.current || term)}
          className={shake ? "pt-shake" : undefined}
        >
          Nuovo
        </Button>
      </Tooltip>
    </Group>
  );
}
