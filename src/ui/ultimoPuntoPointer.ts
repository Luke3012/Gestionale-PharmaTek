export interface PuntoPointer {
  x: number;
  y: number;
}

let ultimoPunto: PuntoPointer = { x: 0, y: 0 };

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      ultimoPunto = { x: event.clientX, y: event.clientY };
    },
    { capture: true, passive: true },
  );
}

/** Ultime coordinate client registrate, restituite come snapshot non modificabile. */
export function ultimoPuntoPointer(): PuntoPointer {
  return { ...ultimoPunto };
}
