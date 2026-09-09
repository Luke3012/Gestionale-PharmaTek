import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Menu } from "@mantine/core";

interface ContextMenuTargetProps extends HTMLAttributes<HTMLDivElement> {
  x: number;
  y: number;
}

export function puntoDaEventoContextMenu(
  event: Pick<MouseEvent, "clientX" | "clientY" | "preventDefault">,
) {
  event.preventDefault();
  return { x: event.clientX, y: event.clientY };
}

/** Punto invisibile usato da Mantine per ancorare un menu al clic destro. */
export const ContextMenuTarget = forwardRef<HTMLDivElement, ContextMenuTargetProps>(
  function ContextMenuTarget({ x, y, style, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        style={{ position: "fixed", left: x, top: y, width: 1, height: 1, pointerEvents: "none", ...style }}
      />
    );
  },
);

/** Menu ancorato alle coordinate di un clic destro, senza duplicare il target invisibile. */
export function ContextMenuPuntuale({ punto, onClose, children }: {
  punto: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Menu opened onClose={onClose} position="bottom-start" offset={0}>
      <Menu.Target><ContextMenuTarget x={punto.x} y={punto.y} /></Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>{children}</Menu.Dropdown>
    </Menu>
  );
}
