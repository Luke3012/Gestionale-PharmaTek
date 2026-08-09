// Cestino in topbar: icona con pallino di conteggio + popover (ripristina /
// elimina definitivamente / svuota). Dati e lista vengono dal modulo riusabile
// `CestinoContenuto` (condiviso con la finestra «Cestino» dello Spotlight).
import { useRef, useState } from "react";
import { ActionIcon, Indicator, Popover, Tooltip } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { useAnimazioniRidotte } from "../ui/motion";
import { useVoloCestino } from "../ui/volaCestino";
import { CestinoContenuto, useCestino } from "./CestinoContenuto";
import { useDismissPopover } from "../lib/closeOnScroll";

export function CestinoPopover() {
  const [open, setOpen] = useState(false);
  const [confermaSvuotaAperta, setConfermaSvuotaAperta] = useState(false);
  const { items, carica, ripristina, elimina, svuota, svuotando } = useCestino();
  const ridotte = useAnimazioniRidotte();
  const iconRef = useRef<HTMLButtonElement>(null);
  // Riceve i «voli nel cestino»: disegna i fantasmini (portal) e fa rimbalzare l'icona.
  const { portal, rimbalzo } = useVoloCestino(iconRef, ridotte);

  useDismissPopover(open && !confermaSvuotaAperta, setOpen);

  const svuotaDalPopover = async () => {
    setConfermaSvuotaAperta(true);
    try {
      const svuotato = await svuota();
      if (svuotato) setOpen(false);
    } finally {
      setConfermaSvuotaAperta(false);
    }
  };

  return (
    <Popover
      width={340}
      position="bottom-end"
      withArrow
      shadow="md"
      opened={open}
      onChange={setOpen}
      closeOnClickOutside={!confermaSvuotaAperta}
    >
      <Popover.Target>
        <Indicator
          label={items.length}
          size={16}
          disabled={items.length === 0}
          color="red"
          offset={4}
          onClick={() => {
            const apri = !open;
            setOpen(apri);
            if (apri) void carica();
          }}
          style={{ cursor: "pointer" }}
        >
          <Tooltip label="Cestino" withArrow disabled={open} zIndex={1500}>
            <ActionIcon
              ref={iconRef}
              variant="subtle"
              color="gray"
              size="lg"
              aria-label="Cestino"
            >
              {/* `key={rimbalzo}` rimonta → rigioca il keyframe a ogni arrivo di un volo. */}
              <motion.span
                key={rimbalzo}
                animate={ridotte ? undefined : { scale: [1, 1.32, 0.9, 1] }}
                transition={{ duration: 0.42, ease: "easeOut" }}
                style={{
                  alignItems: "center",
                  display: "inline-flex",
                  justifyContent: "center",
                  lineHeight: 0,
                }}
              >
                <IconTrash size={20} />
              </motion.span>
            </ActionIcon>
          </Tooltip>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown style={{ overflow: "hidden" }}>
        <CestinoContenuto
          items={items}
          ripristina={ripristina}
          elimina={elimina}
          svuota={svuotaDalPopover}
          svuotando={svuotando}
        />
      </Popover.Dropdown>
      {portal}
    </Popover>
  );
}
