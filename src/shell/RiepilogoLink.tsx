import type { MouseEvent, ReactNode } from "react";
import { api, type Identity } from "../lib/tauri";
import { apriRiepilogo, type TipoRiepilogo } from "./apriRiepilogo";

/** Testo invariato a riposo, con affordance da link soltanto al passaggio del mouse. */
export function RiepilogoLink({
  tipo,
  id,
  nome,
  children,
  identity,
  className,
}: {
  tipo: TipoRiepilogo;
  id: string;
  nome: string;
  children?: ReactNode;
  identity?: Identity;
  className?: string;
}) {
  if (!id) return <>{children ?? (nome || "—")}</>;

  const apri = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const identita = identity ?? (await api.whoami().catch(() => null)) ?? undefined;
    await apriRiepilogo(tipo, id, nome, identita);
  };

  return (
    <button
      type="button"
      className={["pt-riepilogo-link", className].filter(Boolean).join(" ")}
      title={`Apri il riepilogo di ${nome}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => void apri(event)}
    >
      {children ?? (nome || "—")}
    </button>
  );
}
