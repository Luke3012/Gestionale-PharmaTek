// Chiave distinta dalla vecchia `pt.annoPromptFatto`: quella veniva scritta
// anche scegliendo "Lo faccio dopo" e non permette di distinguere un rinvio da
// un passaggio realmente confermato.
export const CHIAVE_ANNO_PROMPT_COMPLETATO = "pt.annoPromptCompletato";

/**
 * Il cambio viene proposto soltanto quando si sta davvero lavorando in un anno
 * passato. "Tutti gli anni" e un eventuale anno futuro non sono cambi d'anno
 * automatici da correggere.
 */
export function deveProporreCambioAnno(
  annoDiLavoro: number,
  annoCorrente: number,
  ultimoAnnoCompletato: string | null
): boolean {
  return (
    Number.isInteger(annoDiLavoro) &&
    Number.isInteger(annoCorrente) &&
    annoDiLavoro > 0 &&
    annoDiLavoro < annoCorrente &&
    ultimoAnnoCompletato !== String(annoCorrente)
  );
}
