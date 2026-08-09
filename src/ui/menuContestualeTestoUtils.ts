const TIPI_INPUT_TESTUALI = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "password",
]);

export function inputSupportaMenuTestuale(tipo: string, inputMode = ""): boolean {
  if (["numeric", "decimal"].includes(inputMode.toLowerCase())) return false;
  return TIPI_INPUT_TESTUALI.has((tipo || "text").toLowerCase());
}

export function attributiIndicanoCombobox(attributi: {
  role?: string | null;
  ariaHasPopup?: string | null;
  ariaAutocomplete?: string | null;
  haLista?: boolean;
}): boolean {
  return attributi.role?.toLowerCase() === "combobox"
    || attributi.ariaHasPopup?.toLowerCase() === "listbox"
    || attributi.ariaAutocomplete != null
    || attributi.haLista === true;
}

export function limitaMenuAlViewport(
  punto: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margine = 8
): { left: number; top: number } {
  return {
    left: Math.max(margine, Math.min(punto.x, viewport.width - menu.width - margine)),
    top: Math.max(margine, Math.min(punto.y, viewport.height - menu.height - margine)),
  };
}
