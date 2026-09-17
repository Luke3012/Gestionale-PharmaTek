import { useEffect, useRef, useState } from "react";
import { ActionIcon, TextInput, type TextInputProps } from "@mantine/core";
import { IconX } from "@tabler/icons-react";

interface DebouncedInputProps extends Omit<TextInputProps, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  delay?: number;
}

export function DebouncedInput({
  value: parentValue,
  onChange,
  delay = 220,
  rightSection,
  rightSectionPointerEvents,
  ...props
}: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(parentValue);
  const ultimoInviatoRef = useRef(parentValue);

  // Sincronizza lo stato locale SOLO se il valore genitore cambia esternamente (es. deep-link o reset)
  // e NON per effetto della notifica inviata dal debounce stesso.
  useEffect(() => {
    if (parentValue !== ultimoInviatoRef.current) {
      ultimoInviatoRef.current = parentValue;
      setLocalValue(parentValue);
    }
  }, [parentValue]);

  // Esegue il debounce dell'input
  useEffect(() => {
    const handler = setTimeout(() => {
      if (localValue !== ultimoInviatoRef.current) {
        ultimoInviatoRef.current = localValue;
        onChange(localValue);
      }
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [localValue, onChange, delay]);

  return (
    <TextInput
      {...props}
      value={localValue}
      onChange={(e) => setLocalValue(e.currentTarget.value)}
      rightSection={
        localValue ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Azzera ricerca"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              ultimoInviatoRef.current = "";
              setLocalValue("");
              onChange("");
            }}
          >
            <IconX size={15} />
          </ActionIcon>
        ) : (
          rightSection
        )
      }
      rightSectionPointerEvents={localValue ? "all" : rightSectionPointerEvents}
    />
  );
}
