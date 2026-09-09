import type { ReactNode } from "react";
import { ActionIcon, Menu } from "@mantine/core";
import { IconDotsVertical } from "@tabler/icons-react";

/** Menu a tre puntini che non propaga i clic alla riga della tabella o della lista. */
export function MenuAzioniRiga({ children, onTargetClick }: {
  children: ReactNode;
  onTargetClick?: (target: HTMLButtonElement) => void;
}) {
  return (
    <Menu position="bottom-end" withArrow>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" onClick={(event) => {
          event.stopPropagation(); onTargetClick?.(event.currentTarget);
        }}>
          <IconDotsVertical size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>{children}</Menu.Dropdown>
    </Menu>
  );
}
