// Campanella notifiche in topbar (FASE 6D). Pop-over con la SOLA lista notifiche
// (solleciti, promemoria in scadenza/scaduti, marcatori): la bacheca promemoria
// completa resta in Dashboard / Riepiloghi. Badge non-lette + «segna tutte lette».
// Il contenuto è il componente riusabile `ListaNotifiche` (condiviso con la finestra
// «Notifiche» dello Spotlight).
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, Indicator, Popover, Tooltip } from "@mantine/core";
import { IconBell, IconBellRinging } from "@tabler/icons-react";
import { motion } from "framer-motion";
import { type Identity } from "../lib/tauri";
import { ListaNotifiche } from "../features/notifiche/ListaNotifiche";
import { nascondiPopupDaCampanella } from "../features/notifiche/notifiche";
import { useNotifiche } from "../features/notifiche/useNotifiche";
import { EVENTO_COMPONI, type ComponiTarget } from "../features/notifiche/messaggi";
import { useDismissPopover } from "../lib/closeOnScroll";
import { useAnimazioniRidotte } from "../ui/motion";

function AltezzaPannelloFluida({ children }: { children: ReactNode }) {
  const contenutoRef = useRef<HTMLDivElement>(null);
  const [altezza, setAltezza] = useState<number>();
  const ridotte = useAnimazioniRidotte();

  useLayoutEffect(() => {
    const contenuto = contenutoRef.current;
    if (!contenuto) return;

    const misura = () => {
      // Il popover entra con una trasformazione `scale`: getBoundingClientRect()
      // restituirebbe l'altezza ridotta del primo fotogramma e ResizeObserver
      // non verrebbe richiamato alla fine della sola trasformazione. offsetHeight
      // misura invece il layout reale, indipendente dall'animazione del dropdown.
      const prossima = contenuto.offsetHeight;
      setAltezza((corrente) => (corrente === prossima ? corrente : prossima));
    };

    misura();
    const observer = new ResizeObserver(misura);
    observer.observe(contenuto);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={false}
      animate={altezza === undefined ? {} : { height: altezza }}
      transition={{ duration: ridotte ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      // Durante l'uscita dell'ultima riga lo stato vuoto viene montato solo a
      // swipe concluso. Il minimo evita che il pannello si chiuda quasi fino
      // all'intestazione per poi riallargarsi un fotogramma dopo.
      style={{
        width: "100%",
        minHeight: 180,
        maxHeight: "calc(100dvh - 72px)",
        overflow: "hidden",
      }}
    >
      <div ref={contenutoRef} style={{ width: "100%" }}>
        {children}
      </div>
    </motion.div>
  );
}

export function CampanellaPopover({ identity }: { identity: Identity }) {
  const [aperto, setAperto] = useState(false);
  const state = useNotifiche(identity);
  const nonLette = state.nonLette;
  // Richiesta «scrivi a questa persona» dal box sincronizzazione: apre la campanella e il
  // composer già indirizzato. Il nonce permette di riaprirlo anche sullo stesso destinatario.
  const [componi, setComponi] = useState<{ destId: string; destNome: string; nonce: number }>();
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as ComponiTarget;
      setAperto(true);
      setComponi((c) => ({ destId: d.destId, destNome: d.destNome, nonce: (c?.nonce ?? 0) + 1 }));
    };
    window.addEventListener(EVENTO_COMPONI, on);
    return () => window.removeEventListener(EVENTO_COMPONI, on);
  }, []);

  useDismissPopover(aperto, setAperto);

  const toggleCampanella = () => {
    setAperto((corrente) => {
      const prossimo = !corrente;
      if (prossimo) void nascondiPopupDaCampanella();
      return prossimo;
    });
  };

  return (
    <Popover
      width={380}
      position="bottom-end"
      withArrow
      shadow="md"
      opened={aperto}
      onChange={setAperto}
      transitionProps={{ transition: "pop", duration: 160 }}
    >
      <Popover.Target>
        <Tooltip label="Notifiche" withArrow disabled={aperto} zIndex={1500}>
          <Indicator
            disabled={nonLette === 0}
            label={nonLette > 99 ? "99+" : nonLette}
            size={16}
            color="red"
            offset={4}
            processing={nonLette > 0}
            styles={{ indicator: { fontSize: 10, fontWeight: 700, padding: "0 4px" } }}
            onClick={toggleCampanella}
            style={{ cursor: "pointer" }}
          >
            <ActionIcon
              variant="subtle"
              color={nonLette > 0 ? "accent" : "gray"}
              size="lg"
              aria-label="Notifiche"
              style={{ lineHeight: 0 }}
            >
              {nonLette > 0 ? <IconBellRinging size={20} /> : <IconBell size={20} />}
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ overflow: "hidden" }}>
        <AltezzaPannelloFluida>
          <ListaNotifiche
            state={state}
            identity={identity}
            onDopoApri={() => setAperto(false)}
            altezzaMax={620}
            componiTarget={componi}
          />
        </AltezzaPannelloFluida>
      </Popover.Dropdown>
    </Popover>
  );
}
