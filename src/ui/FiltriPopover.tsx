// Barra filtri responsive di una lista (Giornaliero, Crediti, Rimborsi, …). I filtri sono
// passati come array (`filtri`): a seconda della preferenza utente (`filtriModo`) vengono
//   • compatti  → tutti dentro il menu «Filtri» (un solo bottone, barra pulita);
//   • auto      → quelli che ci stanno in linea, gli altri sotto «Altri filtri» (default);
//   • espansi   → tutti in linea.
// In «auto» si misura la larghezza disponibile (ResizeObserver) e si riempie con tanti
// filtri quanti ne entrano, riservando spazio al bottone «Altri filtri».
//
// NB: i Select/MultiSelect passati come `nodo` devono usare `comboboxProps={{ withinPortal:
// false }}` così, dentro il popover, un clic nel loro dropdown NON chiude il popover.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Box, Button, Divider, Group, Popover, Stack } from "@mantine/core";
import { IconAdjustmentsHorizontal, IconFilterOff } from "@tabler/icons-react";
import { usePrefs } from "../lib/prefs";
import { useDismissPopover } from "../lib/closeOnScroll";
import { usePopoverVerticalLayout } from "./usePopoverVerticalLayout";
import { osservaRidimensionamento } from "./osservaRidimensionamento";

/** Un filtro della barra: una chiave stabile, il controllo, e la larghezza stimata (auto). */
export interface FiltroDef {
  chiave: string;
  nodo: ReactNode;
  /** Larghezza stimata in px per il calcolo «auto» (default 200). */
  larghezza?: number;
}

const LARGH_DEFAULT = 200;
const SPAZIO_BOTTONE = 112; // larghezza reale compatta di «Altri filtri» + margine
const GAP = 8;

export function FiltriPopover({
  attivi,
  onAzzera,
  filtri,
  width = 300,
  allineaDestra = false,
}: {
  /** Numero di filtri attivi (badge; 0 = nessuno). */
  attivi: number;
  onAzzera: () => void;
  /** I filtri della vista, in ordine di priorità (i primi vanno in linea per primi). */
  filtri: FiltroDef[];
  /** Larghezza del dropdown del menu. */
  width?: number;
  /** Dispone filtri inline e pulsante sul bordo destro dello spazio disponibile. */
  allineaDestra?: boolean;
}) {
  const { filtriModo, sidebar } = usePrefs();
  const [open, setOpen] = useState(false);
  const conFiltri = attivi > 0;

  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const soglia = sidebar === "esteso" ? 930 : 750;
  const usaTesto = windowWidth >= soglia;

  // Quanti filtri stanno in linea. compatti=0, espansi=tutti, auto=misurato.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [nInline, setNInline] = useState(filtriModo === "espansi" ? filtri.length : 0);

  const { targetRef, layout } = usePopoverVerticalLayout(open);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const calc = () => {
      const disp = el.clientWidth;

      if (filtriModo === "compatti") {
        setNInline(0);
        return;
      }
      if (filtriModo === "espansi") {
        setNInline(filtri.length);
        return;
      }

      // Se entrano TUTTI non serve riservare lo spazio del pulsante: quel pulsante
      // non verrà renderizzato. La vecchia riserva fissa nascondeva l'ultimo filtro
      // anche con centinaia di pixel chiaramente liberi (es. Acconto in Produzione).
      const larghezzaTutti = filtri.reduce(
        (tot, f, i) => tot + (f.larghezza ?? LARGH_DEFAULT) + (i > 0 ? GAP : 0),
        0
      );
      if (larghezzaTutti <= disp) {
        setNInline(filtri.length);
        return;
      }
      
      let usato = 0;
      let n = 0;
      for (const f of filtri) {
        const w = (f.larghezza ?? LARGH_DEFAULT) + GAP;
        // Riserva sempre lo spazio del bottone (menu «Altri filtri» o «Azzera»).
        if (usato + w + SPAZIO_BOTTONE > disp) break;
        usato += w;
        n++;
      }
      setNInline((prev) => (prev === n ? prev : n));
    };
    return osservaRidimensionamento(el, calc);
    // `filtri` è ricostruito a ogni render: dipendiamo solo da modo + numero di filtri
    // (la larghezza è gestita dal ResizeObserver). eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtriModo, filtri.length]);

  useDismissPopover(open, setOpen);

  const quanti = Math.min(nInline, filtri.length);
  const inLinea = filtri.slice(0, quanti);
  const nascosti = filtri.slice(quanti);
  const etichetta = inLinea.length > 0 ? "Altri filtri" : "Filtri";

  const bottoneMenu = (
    <Popover
      opened={open}
      onChange={setOpen}
      position={layout.position}
      withinPortal
      withArrow
      shadow="md"
      width={width}
      trapFocus={false}
    >
      <Popover.Target>
        <Button
          ref={targetRef}
          variant={conFiltri ? "light" : "default"}
          color={conFiltri ? "accent" : "gray"}
          leftSection={<IconAdjustmentsHorizontal size={16} />}
          rightSection={
            conFiltri ? (
              <Badge size="sm" circle variant="filled" color="accent">
                {attivi}
              </Badge>
            ) : null
          }
          onClick={() => setOpen((o) => !o)}
          style={{ flexShrink: 0 }}
          px={usaTesto ? undefined : 8}
        >
          {usaTesto ? etichetta : ""}
        </Button>
      </Popover.Target>
      <Popover.Dropdown style={{ maxHeight: layout.maxHeight, display: "flex", flexDirection: "column" }}>
        <Box style={{ overflowY: "auto", flex: 1, minHeight: 0 }} pr={4}>
          <Stack gap="sm">
            {nascosti.map((f) => (
              <Box key={f.chiave}>{f.nodo}</Box>
            ))}
          </Stack>
        </Box>
        <Divider my="xs" style={{ flexShrink: 0 }} />
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconFilterOff size={14} />}
          onClick={onAzzera}
          disabled={!conFiltri}
          style={{ flexShrink: 0 }}
        >
          Azzera filtri
        </Button>
      </Popover.Dropdown>
    </Popover>
  );

  return (
    <Group
      ref={wrapRef}
      gap={GAP}
      wrap="nowrap"
      align="flex-end"
      justify={allineaDestra ? "flex-end" : undefined}
      style={{
        flex: 1,
        minWidth: usaTesto ? 150 : conFiltri ? 75 : 42,
      }}
    >
      {inLinea.map((f) => (
        <Box key={f.chiave} style={{ flex: `0 0 ${f.larghezza ?? LARGH_DEFAULT}px`, minWidth: 0 }}>
          {f.nodo}
        </Box>
      ))}
      {nascosti.length > 0 ? (
        bottoneMenu
      ) : conFiltri ? (
        // Tutti i filtri sono in linea: niente menu, solo «Azzera» a portata.
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconFilterOff size={16} />}
          onClick={onAzzera}
          style={{ flexShrink: 0 }}
          px={usaTesto ? undefined : 8}
        >
          {usaTesto ? "Azzera" : ""}
        </Button>
      ) : null}
    </Group>
  );
}
