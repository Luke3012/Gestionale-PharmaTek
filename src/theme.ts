import { createTheme, type MantineColorsTuple } from "@mantine/core";
import type { MiddlewareState } from "@floating-ui/react";

// Accento giallo brand (#F4C20D = shade 5). Testo scuro sopra via autoContrast.
const accent: MantineColorsTuple = [
  "#fff8e1",
  "#ffecb3",
  "#ffe085",
  "#ffd451",
  "#fdca28",
  "#f4c20d", // 5 — accento primario
  "#d9a900",
  "#b88c00",
  "#946f00",
  "#6f5300",
];

// Scuri della sidebar/header. 1A1A1A = shade 8 (sidebar), 2A2A2A = voce attiva.
const ink: MantineColorsTuple = [
  "#c9cdd2",
  "#a6abb2",
  "#868e96",
  "#5b6b7c",
  "#3a4452",
  "#2a2a2a", // 5 — voce attiva sidebar
  "#242424", // 6 — hover sidebar
  "#1f1f1f",
  "#1a1a1a", // 8 — sidebar/header
  "#141414",
];

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: 5,
  autoContrast: true,
  luminanceThreshold: 0.45,
  colors: { accent, ink },
  white: "#ffffff",
  black: "#1d2733",
  fontFamily: 'Inter, "Segoe UI", system-ui, Roboto, Arial, sans-serif',
  headings: {
    fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
    fontWeight: "700",
  },
  defaultRadius: "md",
  radius: { sm: "6px", md: "8px", lg: "12px" },
  spacing: { xs: "8px", sm: "12px", md: "16px", lg: "20px", xl: "24px" },
  shadows: {
    sm: "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)",
    md: "0 4px 12px rgba(16,24,40,.10)",
    lg: "0 12px 32px rgba(16,24,40,.16)",
  },
  components: {
    Button: { defaultProps: { radius: "md" } },
    Card: { defaultProps: { radius: "md", shadow: "sm", withBorder: true } },
    Menu: {
      defaultProps: {
        // Se un menu non entra interamente né sopra né sotto il relativo
        // comando, Floating UI gli assegna lo spazio realmente disponibile.
        // Il contenuto diventa scrollabile tramite la regola globale dedicata.
        middlewares: {
          flip: true,
          shift: { padding: 8 },
          size: {
            padding: 8,
            apply: ({
              availableHeight,
              elements,
            }: MiddlewareState & { availableHeight: number; availableWidth: number }) => {
              const dropdown = elements.floating;
              dropdown.style.maxHeight = `${availableHeight}px`;
              // Misuriamo dopo aver applicato il limite: la scrollbar compare
              // soltanto se il contenuto eccede davvero la viewport disponibile.
              dropdown.style.overflowY = "hidden";
              const deveScorrere = dropdown.scrollHeight > dropdown.clientHeight + 1;
              dropdown.style.overflowY = deveScorrere ? "auto" : "visible";
              dropdown.style.overflowX = deveScorrere ? "hidden" : "visible";
              dropdown.style.overscrollBehavior = deveScorrere ? "contain" : "auto";
            },
          },
        },
        preventPositionChangeWhenVisible: false,
      },
    },
    Paper: { defaultProps: { radius: "md" } },
    Modal: {
      defaultProps: {
        radius: "md",
        centered: true,
        overlayProps: { backgroundOpacity: 0.45 },
        // Il pulsante X è il primo elemento nel DOM dell'intestazione: senza
        // questo accorgimento il focus trap lo seleziona automaticamente a ogni
        // apertura. Esc continua a chiudere il modale e i campi/azioni restano
        // raggiungibili normalmente da tastiera.
        closeButtonProps: { tabIndex: -1 },
      },
    },
    TextInput: { defaultProps: { radius: "md" } },
    Select: { defaultProps: { radius: "md" } },
  },
});

// Token semantici riusati fuori da Mantine (CSS variables in styles.css).
export const tokens = {
  bg: "#F5F7FA",
  surface: "#FFFFFF",
  border: "#E3E8EF",
  text: "#1D2733",
  textMuted: "#5B6B7C",
  sidebar: "#1A1A1A",
  sidebarHover: "#242424",
  sidebarActive: "#2A2A2A",
  accent: "#F4C20D",
  danger: "#E03131",
  success: "#2F9E44",
  warning: "#F08C00",
  info: "#1971C2",
} as const;
