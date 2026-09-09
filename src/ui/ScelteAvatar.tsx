import type { RefObject } from "react";
import { Button, Group, UnstyledButton } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import type { AvatarTipo } from "../lib/tauri";
import { Avatar } from "./Avatar";
import { PRESETS } from "./avatars";

interface SceltePresetAvatarProps {
  nome: string;
  tipo: AvatarTipo;
  preset: string;
  dimensione: number;
  nonRestringere?: boolean;
  onSeleziona: (preset: string) => void;
}

export function SceltePresetAvatar({
  nome, tipo, preset, dimensione, nonRestringere = false, onSeleziona,
}: SceltePresetAvatarProps) {
  return PRESETS.map((voce) => {
    const selezionato = tipo === "preset" && preset === voce.id;
    return (
      <UnstyledButton
        key={voce.id}
        onClick={() => onSeleziona(voce.id)}
        style={{
          display: "inline-flex",
          borderRadius: "50%",
          padding: 2,
          lineHeight: 0,
          ...(nonRestringere ? { flex: "0 0 auto" } : {}),
          outline: selezionato ? "2px solid #F4C20D" : "2px solid transparent",
        }}
      >
        <Avatar nome={nome} tipo="preset" valore={voce.id} size={dimensione} />
      </UnstyledButton>
    );
  });
}

export function AzioniFotoAvatar({
  fileRef, dimensioneIcona, onCarica, onIniziali,
}: {
  fileRef: RefObject<HTMLInputElement | null>;
  dimensioneIcona: number;
  onCarica: (file?: File) => void;
  onIniziali: () => void;
}) {
  return (
    <Group gap="sm">
      <Button variant="default" leftSection={<IconPhoto size={dimensioneIcona} />}
        onClick={() => fileRef.current?.click()}>
        Carica una foto
      </Button>
      <Button variant="subtle" color="gray" onClick={onIniziali}>
        Usa le iniziali
      </Button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden
        onChange={(event) => onCarica(event.currentTarget.files?.[0])}
      />
    </Group>
  );
}
