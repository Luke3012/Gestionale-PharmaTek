import { useEffect } from "react";
import { inTauri } from "../../lib/tauri";
import { usePrefs } from "../../lib/prefs";
import { usePremiumAccess } from "../../premium/PremiumAccess";

const CHIAVE_RILEVAZIONE = "pt.suggerimentiDuplicatiRilevazione.v1";

interface RilevazioneLocale {
  id: string;
  ms: number;
}

function rilevazionePrecedente(): RilevazioneLocale | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(CHIAVE_RILEVAZIONE) ?? "null",
    ) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      "ms" in value &&
      typeof value.id === "string" &&
      typeof value.ms === "number" &&
      Number.isFinite(value.ms)
    ) {
      return { id: value.id, ms: value.ms };
    }
  } catch {}
  return null;
}

/**
 * Unico worker del matcher duplicati sul PC: vive nell'overlay, che resta
 * operativo anche quando la finestra principale è sospesa. Il risultato è una
 * cache volatile Rust, mai un record sincronizzato.
 */
export function SuggerimentoDuplicatiWorker() {
  const premium = usePremiumAccess();
  const { preferenzeSuggerimenti } = usePrefs();
  const categoriaAttiva =
    preferenzeSuggerimenti.tipiAbilitati.includes("duplicati");

  useEffect(() => {
    if (!inTauri || !premium.enabled) return;
    let vivo = true;
    let sequenza = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const annullaPianificazione = () => {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
      if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
      idleId = undefined;
    };

    const calcola = async (turno: number) => {
      try {
        const trovato = await import("./suggerimenti").then(
          ({ caricaSuggerimentoDuplicati }) =>
            caricaSuggerimentoDuplicati(),
        );
        if (!vivo || turno !== sequenza) return;
        if (!trovato) {
          localStorage.removeItem(CHIAVE_RILEVAZIONE);
          await import("../../lib/tauri").then(({ api }) =>
            api.suggerimentoDuplicatiLocaleAggiorna(null),
          );
          return;
        }
        const precedente = rilevazionePrecedente();
        const aggiornatoMs =
          precedente?.id === trovato.id ? precedente.ms : Date.now();
        localStorage.setItem(
          CHIAVE_RILEVAZIONE,
          JSON.stringify({ id: trovato.id, ms: aggiornatoMs }),
        );
        await import("../../lib/tauri").then(({ api }) =>
          api.suggerimentoDuplicatiLocaleAggiorna({
            ...trovato,
            riferimentoData: "",
            aggiornatoMs,
          }),
        );
      } catch (error) {
        console.error("Controllo duplicati non riuscito", error);
      }
    };

    const pianifica = () => {
      annullaPianificazione();
      const turno = ++sequenza;
      if (!categoriaAttiva) {
        void import("../../lib/tauri").then(({ api }) =>
          api.suggerimentoDuplicatiLocaleAggiorna(null),
        );
        return;
      }
      const esegui = () => void calcola(turno);
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(esegui, { timeout: 1_500 });
      } else {
        timeout = setTimeout(esegui, 700);
      }
    };

    pianifica();
    const disiscrizioni: Array<() => void> = [];
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        Promise.all(
          ["cliente:salvato", "pt:proiezione-ricostruita"].map((evento) =>
            listen(evento, pianifica),
          ),
        ),
      )
      .then((unlisten) => {
        if (vivo) disiscrizioni.push(...unlisten);
        else unlisten.forEach((off) => off());
      })
      .catch(() => {});

    return () => {
      vivo = false;
      sequenza += 1;
      annullaPianificazione();
      disiscrizioni.forEach((off) => off());
    };
  }, [categoriaAttiva, premium.enabled]);

  return null;
}
