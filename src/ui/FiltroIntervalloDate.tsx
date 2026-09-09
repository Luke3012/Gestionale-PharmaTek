import { Group, TextInput, type GroupProps, type TextInputProps } from "@mantine/core";

export function FiltroIntervalloDate({
  dal,
  al,
  onDalChange,
  onAlChange,
  labelDal = "Dal",
  labelAl = "Al",
  gap = "sm",
  mt,
  wrap,
  size,
}: {
  dal: string;
  al: string;
  onDalChange: (value: string) => void;
  onAlChange: (value: string) => void;
  labelDal?: string;
  labelAl?: string;
  gap?: GroupProps["gap"];
  mt?: GroupProps["mt"];
  wrap?: GroupProps["wrap"];
  size?: TextInputProps["size"];
}) {
  return (
    <Group grow gap={gap} mt={mt} wrap={wrap}>
      <TextInput label={labelDal} type="date" size={size} value={dal} onChange={(e) => onDalChange(e.currentTarget.value)} />
      <TextInput label={labelAl} type="date" size={size} value={al} onChange={(e) => onAlChange(e.currentTarget.value)} />
    </Group>
  );
}
