import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AvatarTipo } from "../lib/tauri";
import { cropAvatarTo256 } from "./avatarImage";
import { toast } from "./toast/store";

/** Stato e caricamento condivisi fra onboarding e modifica del profilo. */
export function useFotoAvatar(setAvatarTipo: Dispatch<SetStateAction<AvatarTipo>>) {
  const [fotoBytes, setFotoBytes] = useState<number[] | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function caricaFoto(file?: File) {
    if (!file) return;
    try {
      const { bytes, dataUrl } = await cropAvatarTo256(file);
      setFotoBytes(bytes);
      setFotoPreview(dataUrl);
      setAvatarTipo("custom");
    } catch {
      toast.error("Immagine non valida.");
    }
  }

  function resettaFoto() {
    setFotoBytes(null);
    setFotoPreview(undefined);
    if (fileRef.current) fileRef.current.value = "";
  }

  return { fotoBytes, fotoPreview, fileRef, caricaFoto, resettaFoto };
}
