/** Riconosce la scorciatoia di stampa del browser/WebView. */
export function eScorciatoiaStampa(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    event.key.toLocaleLowerCase() === "p"
  );
}

/** Blocca soltanto la stampa invocata dalla tastiera, non le chiamate esplicite a print(). */
export function bloccaScorciatoiaStampa(event: KeyboardEvent): void {
  if (!eScorciatoiaStampa(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
