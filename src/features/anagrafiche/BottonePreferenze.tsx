import { useState, type ComponentType } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";

export interface PreferenzeModalProps {
  aperto: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export function BottonePreferenze({
  etichetta,
  onChanged,
  Modale,
}: {
  etichetta: string;
  onChanged?: () => void;
  Modale: ComponentType<PreferenzeModalProps>;
}) {
  const [aperto, setAperto] = useState(false);
  return (
    <>
      <Tooltip label={etichetta} withArrow>
        <ActionIcon variant="default" size="lg" onClick={() => setAperto(true)} aria-label={etichetta}>
          <IconSettings size={18} />
        </ActionIcon>
      </Tooltip>
      <Modale aperto={aperto} onClose={() => setAperto(false)} onChanged={onChanged} />
    </>
  );
}
