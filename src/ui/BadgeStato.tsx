import { Badge, Box, Tooltip } from "@mantine/core";
import type { Icon } from "@tabler/icons-react";

interface DefinizioneBadgeStato {
  label: string;
  color: string;
  Ico: Icon;
}

export function BadgeStato({ definizione: d }: { definizione: DefinizioneBadgeStato }) {
  return (
    <Tooltip label={d.label} withArrow>
      <Badge variant="light" color={d.color} leftSection={<d.Ico size={12} />}>
        {d.label}
      </Badge>
    </Tooltip>
  );
}

export function BadgeStatoAdattivo({ definizione: d }: { definizione: DefinizioneBadgeStato }) {
  return (
    <Tooltip label={d.label} withArrow>
      <Box className="pt-badge-adattivo">
        <Badge
          size="sm"
          variant="light"
          color={d.color}
          leftSection={<d.Ico size={12} />}
          aria-label={d.label}
        >
          <span className="pt-badge-adattivo-label">{d.label}</span>
        </Badge>
      </Box>
    </Tooltip>
  );
}
