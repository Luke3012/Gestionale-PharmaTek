// Modale «Modifica profilo» (FASE 7): nome + avatar (preset / foto / iniziali), gli stessi
// campi dell'onboarding. Spostato qui dalla pagina Impostazioni e aperto dal menu utente in
// Topbar. Al salvataggio ricarica per propagare nome/avatar ovunque (sidebar, presence).
import { useState } from "react";
import {
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconDeviceFloppy, IconUserEdit } from "@tabler/icons-react";
import { api, type AvatarTipo, type Identity } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { Avatar, aggiornaAvatarCache } from "../../ui/Avatar";
import { useFotoAvatar } from "../../ui/useFotoAvatar";
import { AzioniFotoAvatar, SceltePresetAvatar } from "../../ui/ScelteAvatar";

export function ProfiloModal({
  opened,
  onClose,
  identity,
  onIdentityChange,
}: {
  opened: boolean;
  onClose: () => void;
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={500}
      zIndex={1300}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconUserEdit size={18} />
          </ThemeIcon>
          <Text fw={700}>Modifica profilo</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180 }}
    >
      <ProfiloForm identity={identity} onIdentityChange={onIdentityChange} onClose={onClose} />
    </Modal>
  );
}

function ProfiloForm({
  identity,
  onIdentityChange,
  onClose,
}: {
  identity: Identity;
  onIdentityChange: (identity: Identity) => void;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(identity.nome);
  const [avatarTipo, setAvatarTipo] = useState<AvatarTipo>(identity.avatarTipo);
  const [avatarPreset, setAvatarPreset] = useState(
    identity.avatarTipo === "preset" ? identity.avatarValore || "p1" : "p1"
  );
  const [salvando, setSalvando] = useState(false);
  const { fotoBytes, fotoPreview, fileRef, caricaFoto } = useFotoAvatar(setAvatarTipo);

  const avatarValore =
    avatarTipo === "preset" ? avatarPreset : avatarTipo === "custom" ? `${identity.userId}.png` : "";
  const cambiato =
    nome.trim() !== identity.nome ||
    avatarTipo !== identity.avatarTipo ||
    (avatarTipo === "preset" && avatarValore !== identity.avatarValore) ||
    (avatarTipo === "custom" && !!fotoBytes);

  async function salva() {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      if (avatarTipo === "custom" && fotoBytes) {
        await api.saveAvatar(identity.userId, fotoBytes);
        if (fotoPreview) {
          aggiornaAvatarCache(identity.userId, fotoPreview);
        }
      }
      const newIdent = await api.aggiornaProfilo(nome.trim(), avatarTipo, avatarValore);
      localStorage.setItem("pt.lastIdentity", JSON.stringify(newIdent));
      onIdentityChange(newIdent);
      toast.success("Profilo aggiornato.");
      onClose();
    } catch (e) {
      toast.error(`Salvataggio non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        Nome e avatar mostrati agli altri PC.
      </Text>
      <Group align="flex-start" wrap="nowrap" gap="md">
        <Avatar
          nome={nome}
          tipo={avatarTipo}
          valore={avatarValore}
          src={avatarTipo === "custom" ? fotoPreview : undefined}
          userId={avatarTipo === "custom" && !fotoPreview ? identity.userId : undefined}
          size={64}
        />
        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            label="Nome utente"
            value={nome}
            onChange={(e) => setNome(e.currentTarget.value)}
            placeholder="Es. Livio"
          />
          <Text size="xs" c="dimmed">
            Dispositivo: {identity.deviceNome}
          </Text>
        </Stack>
      </Group>

      <ScrollArea type="hover" scrollbarSize={6} offsetScrollbars>
        <Group gap="sm" wrap="nowrap" p={4} style={{ width: "max-content" }}>
          <SceltePresetAvatar
            nome={nome}
            tipo={avatarTipo}
            preset={avatarPreset}
            dimensione={36}
            nonRestringere
            onSeleziona={(prossimo) => {
              setAvatarTipo("preset");
              setAvatarPreset(prossimo);
            }}
          />
        </Group>
      </ScrollArea>

      <AzioniFotoAvatar
        fileRef={fileRef}
        dimensioneIcona={16}
        onCarica={caricaFoto}
        onIniziali={() => setAvatarTipo("iniziali")}
      />

      <Group justify="flex-end" gap="sm">
        <Button
          color="accent"
          leftSection={<IconDeviceFloppy size={16} />}
          loading={salvando}
          disabled={!cambiato || !nome.trim()}
          onClick={salva}
        >
          Salva profilo
        </Button>
      </Group>
    </Stack>
  );
}
