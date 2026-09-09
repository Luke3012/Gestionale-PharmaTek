import { NumberInput, type NumberInputProps } from "@mantine/core";

/** NumberInput con la formattazione monetaria italiana usata nell'app. */
export function EuroInput(props: NumberInputProps) {
  return (
    <NumberInput
      {...props}
      prefix="€ "
      decimalScale={2}
      fixedDecimalScale
      thousandSeparator="."
      decimalSeparator=","
    />
  );
}
