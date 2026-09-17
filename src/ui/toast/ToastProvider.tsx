// Render dei toast (alto a destra), animati, con barra countdown e pausa hover.
import { useEffect, useState } from "react";
import { ActionIcon, Box, Group, Loader, Paper, Text, ThemeIcon } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  applicaToastPrincipale,
  EVENTO_TOAST_PRINCIPALE,
  toastStore,
  type MessaggioToastPrincipale,
  type ToastItem,
  type ToastTipo,
} from "./store";
import { toastVariants } from "../motion";

const TOAST_BLOCKING_ATTRIBUTE = "data-pt-toast-blocking";

function toastBloccati(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(TOAST_BLOCKING_ATTRIBUTE);
}

const COLORI: Record<ToastTipo, string> = {
  info: "#1971C2",
  success: "#2F9E44",
  warning: "#F08C00",
  error: "#E03131",
  loading: "#1971C2",
};

function Icona({ tipo }: { tipo: ToastTipo }) {
  if (tipo === "loading") return <Loader size={18} color={COLORI.loading} />;
  const Ico =
    tipo === "success"
      ? IconCheck
      : tipo === "warning"
        ? IconAlertTriangle
        : tipo === "error"
          ? IconX
          : IconInfoCircle;
  return (
    <ThemeIcon size={26} radius="xl" variant="light" color={COLORI[tipo]}>
      <Ico size={16} />
    </ThemeIcon>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const close = () => toastStore.dismiss(item.id);
  const progress = item.progress == null ? null : Math.max(0, Math.min(100, item.progress));

  return (
    <motion.div
      layout
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Paper
        shadow="md"
        radius="md"
        withBorder
        style={{ width: 360, overflow: "hidden", position: "relative" }}
      >
        <Group p="sm" wrap="nowrap" align="flex-start" gap="sm">
          <Icona tipo={item.tipo} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            {item.titolo && (
              <Text fw={600} size="sm" lh={1.3}>
                {item.titolo}
              </Text>
            )}
            <Text size="sm" c="dimmed" lh={1.35} style={{ wordBreak: "break-word" }}>
              {item.messaggio}
            </Text>
            {item.azioni && item.azioni.length > 0 && (
              <Group gap="xs" mt={6}>
                {item.azioni.map((a, i) => (
                  <Text
                    key={i}
                    size="sm"
                    fw={600}
                    c={COLORI[item.tipo]}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      a.onClick();
                      close();
                    }}
                  >
                    {a.label}
                  </Text>
                ))}
              </Group>
            )}
          </Box>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={close} aria-label="Chiudi">
            <IconX size={15} />
          </ActionIcon>
        </Group>
        {progress != null && (
          <Box
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              height: 3,
              width: "100%",
              background: `${COLORI[item.tipo]}22`,
            }}
          >
            <Box
              style={{
                height: "100%",
                width: `${progress}%`,
                background: COLORI[item.tipo],
                transition: "width 180ms ease",
              }}
            />
          </Box>
        )}
        {item.durata > 0 && progress == null && (
          <Box
            onAnimationEnd={(e) => {
              if (e.animationName === "pt-toast-countdown") close();
            }}
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              height: 3,
              width: "100%",
              transformOrigin: "left",
              background: COLORI[item.tipo],
              animation: `pt-toast-countdown ${item.durata}ms linear forwards`,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        )}
      </Paper>
    </motion.div>
  );
}

export function ToastProvider({
  riceviInoltri = false,
}: {
  /** Solo la finestra principale riceve i toast delle finestre di servizio. */
  riceviInoltri?: boolean;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [bloccati, setBloccati] = useState(toastBloccati);
  // La verifica sincrona copre anche il commit in cui loader e toast compaiono
  // insieme, prima che il MutationObserver abbia notificato il nuovo flag.
  const visibili = !bloccati && !toastBloccati();
  useEffect(() => toastStore.subscribe(setItems), []);
  useEffect(() => {
    if (
      !riceviInoltri ||
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window)
    ) {
      return;
    }
    let attivo = true;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<MessaggioToastPrincipale>(
          EVENTO_TOAST_PRINCIPALE,
          ({ payload }) => {
            if (attivo) applicaToastPrincipale(payload);
          },
        ),
      )
      .then((unlisten) => {
        if (attivo) off = unlisten;
        else unlisten();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      off?.();
    };
  }, [riceviInoltri]);
  useEffect(() => {
    const aggiorna = () => setBloccati(toastBloccati());
    aggiorna();
    const observer = new MutationObserver(aggiorna);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [TOAST_BLOCKING_ATTRIBUTE],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        // Sopra OGNI modale/dialog (Modal ~1300, DialogProvider 6000): i toast non
        // devono mai finire oscurati quando è aperto un modale.
        zIndex: 9000,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {visibili && (
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <Box
              key={item.id}
              style={{
                width: 360,
                pointerEvents: "auto",
              }}
            >
              <ToastCard item={item} />
            </Box>
          ))}
        </AnimatePresence>
      )}
    </Box>
  );
}
