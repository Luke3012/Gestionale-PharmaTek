import { type ReactNode } from "react";
import { Box, Button, Progress, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconFileSpreadsheet } from "@tabler/icons-react";

export interface AnimazioneScansioneProps {
  color?: "teal" | "violet" | "blue";
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  progress?: number | null;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function AnimazioneScansione({
  color = "teal",
  icon,
  title,
  subtitle,
  progress,
  onCancel,
  cancelLabel = "Annulla",
}: AnimazioneScansioneProps) {

  return (
    <Box className="pt-scanner-wrapper" data-color={color}>
      <div className="pt-scanner-radar-container" aria-hidden="true">
        <div className="pt-scanner-glow" />
        <div className="pt-scanner-radar-ring" />
        <div className="pt-scanner-radar-ring pt-scanner-radar-ring-2" />
        <div className="pt-scanner-radar-ring pt-scanner-radar-ring-3" />
        <div className="pt-scanner-card">
          <div className="pt-scanner-beam" />
          {icon ?? (
            <ThemeIcon
              variant="transparent"
              size={38}
              color={color === "teal" ? "teal.8" : color === "blue" ? "blue.8" : "violet.8"}
            >
              <IconFileSpreadsheet size={34} />
            </ThemeIcon>
          )}
        </div>
      </div>

      <Stack gap={6} align="center" style={{ maxWidth: 360 }}>
        <Text fw={700} size="md">
          {title}
        </Text>
        {subtitle && (
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>
            {subtitle}
          </Text>
        )}
      </Stack>

      <Box mt="md" style={{ width: "100%", maxWidth: 260 }}>
        {progress == null ? (
          <div
            className="pt-scanner-progress-indeterminate"
            role="progressbar"
            aria-label={title}
          />
        ) : (
          <Progress
            value={Math.min(100, Math.max(0, progress))}
            color={color === "teal" ? "teal" : color === "blue" ? "blue" : "accent"}
            size="xs"
            radius="xl"
            aria-label={title}
          />
        )}
      </Box>

      {onCancel && (
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          mt="lg"
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
      )}
    </Box>
  );
}
