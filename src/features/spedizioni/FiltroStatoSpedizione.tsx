import { Box, SegmentedControl, Text } from "@mantine/core";

export type FiltroStatoSpedizioneValue = "tutti" | "spediti" | "non";

export function FiltroStatoSpedizione({
  value,
  onChange,
}: {
  value: FiltroStatoSpedizioneValue;
  onChange: (value: FiltroStatoSpedizioneValue) => void;
}) {
  return (
    <Box>
      <Text size="sm" fw={500} mb={4}>Stato spedizione</Text>
      <SegmentedControl
        fullWidth
        value={value}
        onChange={(next) => onChange(next as FiltroStatoSpedizioneValue)}
        data={[
          { value: "tutti", label: "Tutti" },
          { value: "spediti", label: "Spediti" },
          { value: "non", label: "Non spediti" },
        ]}
      />
    </Box>
  );
}
