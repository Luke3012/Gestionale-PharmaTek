/** Normalizza prima dell'aggiornamento React, conservando cursore e selezione. */
export function maiuscoloInput(input: HTMLInputElement): string {
  const originale = input.value;
  const maiuscolo = originale.toUpperCase();
  if (maiuscolo !== originale) {
    const { selectionStart, selectionEnd, selectionDirection } = input;
    input.value = maiuscolo;
    if (selectionStart !== null && selectionEnd !== null) {
      input.setSelectionRange(
        originale.slice(0, selectionStart).toUpperCase().length,
        originale.slice(0, selectionEnd).toUpperCase().length,
        selectionDirection ?? undefined,
      );
    }
  }
  return maiuscolo;
}
