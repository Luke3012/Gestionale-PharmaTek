import type { Bootstrap } from "./tauriTypes";

export type DestinazioneBootstrap = "reconnect" | "dataProblem" | "onboarding" | "pronto";

/**
 * Decide l'unica schermata ammessa dopo un bootstrap o un riallineamento.
 * La revoca esplicita della sessione ha precedenza sullo stato della cartella:
 * il ritiro remoto cancella apposta la configurazione locale, ma deve continuare
 * a mostrare «Sessione non più disponibile», non un falso errore OneDrive.
 */
export function destinazioneBootstrap(
  boot: Bootstrap,
  ricollegamentoLocale = false
): DestinazioneBootstrap {
  if (boot.reconnectRequired || (!boot.onboarded && ricollegamentoLocale)) return "reconnect";
  if (boot.dataDirStatus === "missing_or_empty") return "dataProblem";
  // Una cartella già configurata ma priva di identità in questo bootstrap può
  // indicare un motore non ancora apribile durante l'allineamento OneDrive.
  if (boot.dataDir && !boot.onboarded) return "dataProblem";
  if (boot.dataDirStatus === "ok" && boot.onboarded && boot.identity) return "pronto";
  return "onboarding";
}
