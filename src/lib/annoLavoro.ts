/** Estrae l'anno da una data ISO; le date mancanti o malformate non appartengono a un anno. */
function annoDaIso(data: string): number | null {
  const valore = Number(data.slice(0, 4));
  return /^\d{4}-\d{2}-\d{2}/.test(data) && Number.isInteger(valore)
    ? valore
    : null;
}

/** Viste storiche: 0 rimuove il limite, altrimenti vale soltanto l'anno esatto. */
export function dataNellAnno(data: string, anno: number): boolean {
  return anno === 0 || annoDaIso(data) === anno;
}

/** Intersezione usata dalle viste storiche fra anno globale e intervallo locale. */
export function dataNellAnnoEIntervallo(
  data: string,
  anno: number,
  dal = "",
  al = "",
): boolean {
  if (!dataNellAnno(data, anno)) return false;
  if (dal && data < dal) return false;
  if (al && data > al) return false;
  return true;
}

/** Code operative: 0 mostra tutto; un anno specifico include anche gli arretrati. */
export function dataEntroAnnoDiLavoro(data: string, anno: number): boolean {
  if (anno === 0) return true;
  const valore = annoDaIso(data);
  return valore !== null && valore <= anno;
}

/**
 * «Da spedire» considera operativi gli elementi dell'anno e gli arretrati reali.
 * I semplici «Nuovo» di anni precedenti restano esclusi perché normalmente preventivi.
 */
export function ordineDaSpedireNelContesto(
  ordine: { data: string; stato: string },
  anno: number,
): boolean {
  if (!dataEntroAnnoDiLavoro(ordine.data, anno)) return false;
  if (anno === 0) return true;
  const annoOrdine = annoDaIso(ordine.data);
  return annoOrdine === anno || ordine.stato !== "Nuovo";
}
