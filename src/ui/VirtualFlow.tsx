import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Box } from "@mantine/core";
import {
  calcolaLayoutVirtuale,
  calcolaRangeVirtuale,
  useAltezzeVirtuali,
} from "./virtualizzazione";

interface VirtualFlowProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  estimateHeight?: number;
  gap?: number;
  overscan?: number;
  scrollToKey?: string | null;
  scrollBehavior?: ScrollBehavior;
}

export function VirtualFlow<T>({
  items,
  getKey,
  renderItem,
  estimateHeight = 160,
  gap = 8,
  overscan = 4,
  scrollToKey,
  scrollBehavior = "smooth",
}: VirtualFlowProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const { altezze: heights, registraAltezza } = useAltezzeVirtuali();

  const keys = useMemo(() => items.map(getKey), [items, getKey]);

  const layout = useMemo(
    () => calcolaLayoutVirtuale(keys, heights, estimateHeight, gap),
    [estimateHeight, gap, heights, keys]
  );

  const misuraViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const parent = scrollParentRef.current ?? container.closest<HTMLElement>(".pt-modal-scroll");
    if (!parent) return;
    scrollParentRef.current = parent;

    const parentRect = parent.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const containerTopInScroll = parent.scrollTop + containerRect.top - parentRect.top;
    setViewport({
      top: parent.scrollTop - containerTopInScroll,
      height: parent.clientHeight,
    });
  }, []);

  useLayoutEffect(() => {
    misuraViewport();
    const container = containerRef.current;
    if (!container) return;
    const parent = container.closest<HTMLElement>(".pt-modal-scroll");
    if (!parent) return;
    scrollParentRef.current = parent;

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(misuraViewport);
    };

    parent.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(parent);
    ro.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      parent.removeEventListener("scroll", schedule);
      ro.disconnect();
    };
  }, [misuraViewport]);

  const range = useMemo(
    () => calcolaRangeVirtuale({
      numeroElementi: items.length,
      chiavi: keys,
      offsets: layout.offsets,
      altezze: heights,
      altezzaStimata: estimateHeight,
      overscan,
      viewportTop: viewport.top,
      viewportHeight: viewport.height,
    }),
    [estimateHeight, heights, items.length, keys, layout.offsets, overscan, viewport]
  );

  useEffect(() => {
    if (!scrollToKey) return;
    const parent = scrollParentRef.current;
    const container = containerRef.current;
    if (!parent || !container) return;
    const index = keys.indexOf(scrollToKey);
    if (index < 0) return;
    const parentRect = parent.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const containerTopInScroll = parent.scrollTop + containerRect.top - parentRect.top;
    parent.scrollTo({
      top: Math.max(0, containerTopInScroll + layout.offsets[index] - 12),
      behavior: scrollBehavior,
    });
  }, [keys, layout.offsets, scrollBehavior, scrollToKey]);

  return (
    <Box ref={containerRef} style={{ height: layout.totale, position: "relative", width: "100%" }}>
      {items.slice(range.start, range.end).map((item, localIndex) => {
        const index = range.start + localIndex;
        const key = keys[index];
        return (
          <VirtualFlowItem
            key={key}
            itemKey={key}
            top={layout.offsets[index]}
            onMeasure={registraAltezza}
          >
            {renderItem(item, index)}
          </VirtualFlowItem>
        );
      })}
    </Box>
  );
}

function VirtualFlowItem({
  itemKey,
  top,
  onMeasure,
  children,
}: {
  itemKey: string;
  top: number;
  onMeasure: (key: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const misura = () => onMeasure(itemKey, el.getBoundingClientRect().height);
    misura();
    const ro = new ResizeObserver(misura);
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemKey, onMeasure]);

  return (
    <Box ref={ref} style={{ position: "absolute", left: 0, right: 0, top }}>
      {children}
    </Box>
  );
}
