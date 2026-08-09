import { useEffect, useState } from "react";
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

  // Sincronizza lo stato locale se il valore genitore cambia esternamente (es. deep-link o reset)
  useEffect(() => {
    setLocalValue(parentValue);
  }, [parentValue]);

  // Esegue il debounce dell'input
  useEffect(() => {
    const handler = setTimeout(() => {
      if (localValue !== parentValue) {
        onChange(localValue);
      }
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [localValue, parentValue, onChange, delay]);

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
