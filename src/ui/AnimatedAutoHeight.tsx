import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { osservaRidimensionamento } from "./osservaRidimensionamento";

export interface AnimatedAutoHeightProps {
  children: ReactNode;
  reducedMotion?: boolean;
  initialHeight?: number | null;
  className?: string;
  duration?: number;
}

export function AnimatedAutoHeight({
  children,
  reducedMotion = false,
  initialHeight = null,
  className,
  duration = 0.35,
}: AnimatedAutoHeightProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(() => initialHeight);

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const measure = () => {
      const next = Math.ceil(node.getBoundingClientRect().height);
      setHeight((current) => (current === next ? current : next));
    };
    return osservaRidimensionamento(node, measure);
  }, []);

  return (
    <motion.div
      className={className}
      initial={initialHeight != null ? { height: initialHeight } : false}
      animate={height === null ? undefined : { height }}
      transition={{
        duration: reducedMotion ? 0 : duration,
        ease: [0.16, 1, 0.3, 1],
      }}
      style={{ overflow: "hidden", width: "100%" }}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}
