// Render del dialog corrente (Mantine Modal) con animazione e scorciatoie.
import { useEffect, useState } from "react";
import { Button, Group, Modal, SimpleGrid, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconHelpCircle,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import {
  dialogStore,
  type BottoneVariante,
  type DialogAttivo,
  type DialogTipo,
} from "./store";
import { useModalSnapshot } from "../useModalSnapshot";

const META: Record<DialogTipo, { color: string; Icon: typeof IconInfoCircle }> = {
  info: { color: "#1971C2", Icon: IconInfoCircle },
  success: { color: "#2F9E44", Icon: IconCheck },
  warning: { color: "#F08C00", Icon: IconAlertTriangle },
  error: { color: "#E03131", Icon: IconX },
  question: { color: "#F4C20D", Icon: IconHelpCircle },
};

function buttonProps(variante: BottoneVariante = "secondario") {
  switch (variante) {
    case "primario":
      return { variant: "filled" as const, color: "accent" };
    case "pericolo":
      return { variant: "filled" as const, color: "red" };
    case "ghost":
      return { variant: "subtle" as const, color: "gray" };
    case "informativo":
      return { variant: "light" as const, color: "blue" };
    case "ignora":
      return { variant: "outline" as const, color: "gray" };
    default:
      return { variant: "default" as const };
  }
}

export function DialogProvider() {
  const [dlg, setDlg] = useState<DialogAttivo | null>(null);
  // Contenuto mostrato: resta visibile durante l'animazione di chiusura (altrimenti
  // la modale "collassa" su un riquadro vuoto). Si azzera a transizione finita.
  const [mostrato, clearMostrato] = useModalSnapshot(dlg);
  useEffect(() => dialogStore.subscribe(setDlg), []);
  useEffect(() => {
    if (!dlg) return;
    const precedente = document.body.getAttribute("data-mantine-stop-propagation");
    document.body.setAttribute("data-mantine-stop-propagation", "true");
    return () => {
      if (precedente === null) document.body.removeAttribute("data-mantine-stop-propagation");
      else document.body.setAttribute("data-mantine-stop-propagation", precedente);
    };
  }, [dlg]);

  // Enter = bottone primario/autofocus; Esc = annulla anche se il focus non è dentro il modal.
  useEffect(() => {
    if (!dlg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        dialogStore.close(dlg.id, dlg.valoreAnnulla);
        return;
      }
      if (e.key === "Enter") {
        // In una textarea (o campo editabile) Enter va a capo: non confermare il dialog.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        const primario =
          dlg.bottoni.find((b) => b.autofocus) ??
          dlg.bottoni.find((b) => b.variante === "primario" || b.variante === "pericolo");
        if (primario) {
          e.preventDefault();
          dialogStore.close(dlg.id, primario.value);
        }
      }
    };
    // Capture: il dialog globale intercetta Esc prima delle eventuali modali sottostanti.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dlg]);

  const meta = mostrato ? META[mostrato.tipo ?? "info"] : null;
  const azioniContenuto = mostrato?.bottoni.filter((b) => b.posizione === "contenuto") ?? [];
  const azioniFooter = mostrato?.bottoni.filter((b) => b.posizione !== "contenuto") ?? [];

  return (
    <Modal
      opened={!!dlg}
      onClose={() => dlg && dialogStore.close(dlg.id, dlg.valoreAnnulla)}
      withCloseButton={false}
      centered
      radius="md"
      // I dialog con quattro azioni restano abbastanza ampi per le etichette, senza
      // occupare quasi tutta la finestra; il footer va a capo sui viewport stretti.
      size={
        mostrato && mostrato.bottoni.length >= 4
          ? 900
          : mostrato && mostrato.bottoni.length >= 3
            ? "lg"
            : "md"
      }
      zIndex={4000}
      data-mantine-stop-propagation="true"
      transitionProps={{ transition: "fade", duration: 150, onExited: clearMostrato }}
      title={
        mostrato && meta ? (
          <Group gap="sm">
            <ThemeIcon size={30} radius="xl" variant="light" color={meta.color}>
              <meta.Icon size={18} />
            </ThemeIcon>
            <Text fw={700} size="md">
              {mostrato.titolo}
            </Text>
          </Group>
        ) : undefined
      }
    >
      {mostrato && (
        <div
          data-mantine-stop-propagation="true"
          onFocusCapture={(e) => {
            const t = e.target as HTMLElement | null;
            t?.setAttribute?.("data-mantine-stop-propagation", "true");
          }}
        >
          <span
            data-autofocus
            data-mantine-stop-propagation="true"
            tabIndex={-1}
            aria-hidden="true"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          {typeof mostrato.contenuto === "string" ? (
            <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-line" }}>
              {mostrato.contenuto}
            </Text>
          ) : (
            mostrato.contenuto
          )}
          {azioniContenuto.length > 0 && (
            <SimpleGrid cols={1} spacing="sm" mt="sm">
              {azioniContenuto.map((b, i) => (
                <UnstyledButton
                  key={i}
                  className="pt-dialog-choice"
                  aria-label={b.label}
                  data-mantine-stop-propagation="true"
                  onClick={() => dialogStore.close(mostrato.id, b.value)}
                >
                  {b.contenutoAzione ?? b.label}
                </UnstyledButton>
              ))}
            </SimpleGrid>
          )}
          <Group justify="flex-end" mt="md" gap="sm" wrap="wrap">
            {azioniFooter.map((b, i) => (
              <Button
                key={i}
                {...buttonProps(b.variante)}
                data-mantine-stop-propagation="true"
                onClick={() => dialogStore.close(mostrato.id, b.value)}
              >
                {b.label}
              </Button>
            ))}
          </Group>
        </div>
      )}
    </Modal>
  );
}
