import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollArea } from "@mantine/core";
import { osservaRidimensionamento } from "./osservaRidimensionamento";
import {
  calcolaLayoutVirtuale,
  calcolaRangeVirtuale,
  type AltezzeVirtuali,
  useAltezzeVirtuali,
} from "./virtualizzazione";

const NESSUNA_ALTEZZA: AltezzeVirtuali = {};

interface VirtualStackProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  maxHeight?: number | string;
  fill?: boolean;
  gap?: number;
  padding?: number;
  estimateHeight?: number;
  /** Altezza certa della riga: evita misura iniziale e un ResizeObserver per elemento. */
  fixedItemHeight?: number;
  overscan?: number;
  scrollToKey?: string | null;
  scrollBehavior?: ScrollBehavior;
}

/** Stack virtualizzato per popover/f finestre piccole: stessa UI, meno righe montate. */
export function VirtualStack<T>({
  items,
  getKey,
  renderItem,
  maxHeight = 300,
  fill = false,
  gap = 4,
  padding = 0,
  estimateHeight = 44,
  fixedItemHeight,
  overscan = 8,
  scrollToKey,
  scrollBehavior = "smooth",
}: VirtualStackProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const { altezze: measuredHeights, registraAltezza } = useAltezzeVirtuali();
  const heights =
    fixedItemHeight === undefined ? measuredHeights : NESSUNA_ALTEZZA;
  const itemHeight = fixedItemHeight ?? estimateHeight;
  const viewportHeightFissa =
    fixedItemHeight !== undefined && !fill && typeof maxHeight === "number"
      ? maxHeight
      : null;

  useEffect(() => {
    if (viewportHeightFissa !== null) return;
    const el = viewportRef.current;
    if (!el) return;
    const misura = () => setViewportHeight(el.clientHeight || 0);
    return osservaRidimensionamento(el, misura);
  }, [viewportHeightFissa]);

  const keys = useMemo(() => items.map(getKey), [items, getKey]);

  const layout = useMemo(
    () => calcolaLayoutVirtuale(keys, heights, itemHeight, gap, padding),
    [gap, heights, itemHeight, keys, padding]
  );

  const range = useMemo(
    () => calcolaRangeVirtuale({
      numeroElementi: items.length,
      chiavi: keys,
      offsets: layout.offsets,
      altezze: heights,
      altezzaStimata: itemHeight,
      overscan,
      viewportTop: scrollTop,
      viewportHeight:
        viewportHeightFissa ??
        (viewportHeight || Number(maxHeight) || 0),
    }),
    [heights, itemHeight, items.length, keys, layout.offsets, maxHeight, overscan, scrollTop, viewportHeight, viewportHeightFissa]
  );

  useEffect(() => {
    if (!scrollToKey) return;
    const el = viewportRef.current;
    if (!el) return;
    const index = keys.indexOf(scrollToKey);
    if (index < 0) return;
    el.scrollTo({ top: Math.max(0, layout.offsets[index] - padding), behavior: scrollBehavior });
  }, [keys, layout.offsets, padding, scrollBehavior, scrollToKey]);

  const content = (
    <Box style={{ height: layout.totale, position: "relative", width: "100%", overflow: "hidden" }}>
      {items.slice(range.start, range.end).map((item, localIndex) => {
        const index = range.start + localIndex;
        const key = keys[index];
        return (
          <VirtualRow
            key={key}
            itemKey={key}
            top={layout.offsets[index]}
            inset={padding}
            fixedHeight={fixedItemHeight}
            onMeasure={fixedItemHeight === undefined ? registraAltezza : undefined}
          >
            {renderItem(item, index)}
          </VirtualRow>
        );
      })}
    </Box>
  );

  const common = {
    type: "scroll" as const,
    scrollbars: "y" as const,
    styles: { viewport: { overflowX: "hidden" as const } },
    viewportRef,
    onScrollPositionChange: ({ y }: { y: number }) => setScrollTop(y),
  };

  return fill ? (
    <ScrollArea style={{ flex: 1, minHeight: 0 }} {...common}>
      {content}
    </ScrollArea>
  ) : (
    <ScrollArea.Autosize mah={maxHeight} {...common}>
      {content}
    </ScrollArea.Autosize>
  );
}

function VirtualRow({
  itemKey,
  top,
  inset,
  fixedHeight,
  onMeasure,
  children,
}: {
  itemKey: string;
  top: number;
  inset: number;
  fixedHeight?: number;
  onMeasure?: (key: string, height: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onMeasure) return;
    const el = ref.current;
    if (!el) return;
    const misura = () => onMeasure(itemKey, el.getBoundingClientRect().height);
    return osservaRidimensionamento(el, misura);
  }, [itemKey, onMeasure]);

  return (
    <Box
      ref={ref}
      style={{
        position: "absolute",
        left: inset,
        right: inset,
        top,
        height: fixedHeight,
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
}
