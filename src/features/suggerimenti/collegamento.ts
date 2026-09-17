import type { SuggerimentoCollegamento } from "../../lib/tauri";
import type { DeepLink } from "../../shell/navigazione";

/** Traduce il collegamento Rust nel DeepLink già usato da Dashboard e notifiche. */
export function deepLinkSuggerimento(
  collegamento: SuggerimentoCollegamento,
): DeepLink {
  const link: DeepLink = {
    path: collegamento.path,
    tab: collegamento.tab,
    apriId: collegamento.apriId,
  };
  if (
    collegamento.azione === "nuova_distinta" ||
    collegamento.azione === "ottimizza_database" ||
    collegamento.azione === "solleciti_preventivi" ||
    collegamento.azione === "solleciti_preventivi_tutti"
  ) {
    link.azione = collegamento.azione;
  }
  if (collegamento.agenteId) link.agenteId = collegamento.agenteId;
  if (collegamento.rimborsoStati) {
    link.rimborsoStati = collegamento.rimborsoStati;
  }
  if (collegamento.produzioneAcconto === "incassato") {
    link.produzioneAcconto = "incassato";
  }
  if (collegamento.provvigioniOrdina === "maturato") {
    link.provvigioniOrdina = "maturato";
  }
  return link;
}
