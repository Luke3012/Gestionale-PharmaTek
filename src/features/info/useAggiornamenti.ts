// Controllo aggiornamenti automatico (FASE 7B): all'avvio e poi ogni ~6 ore, in
// modo SILENZIOSO. Quando trova una versione nuova NON installa di nascosto: avvisa
// l'utente con un toast persistente con l'azione «Aggiorna ora» (scarica, installa e
// riavvia). Niente disturbo se non c'è nulla / offline. Montato dal Root della sola
// main, così resta attivo anche prima della Shell e durante onboarding/riconnessione.
import { useEffect } from "react";
import { inTauri } from "../../lib/tauri";
import {
  CHIAVE_AGGIORNAMENTO_APPLICATO,
  INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS,
  controllaAggiornamento,
  dimenticaAvvisoAggiornamento,
  installaAggiornamento,
  installaUltimaVersione,
  prenotaAvvisoAggiornamento,
  riallineaDedupVersioneInstallata,
} from "../../updater";
import { toast } from "../../ui/toast/store";
import { usePrefs } from "../../lib/prefs";

export function useAggiornamenti() {
  const { balloonAttivo } = usePrefs();

  // Dopo un riavvio da aggiornamento: conferma «completato» UNA SOLA volta. Il flag è
  // scritto dall'updater prima di `relaunch()`; lo consumiamo (remove) subito così non
  // ricompare ai riavvii successivi né nelle finestre secondarie.
  useEffect(() => {
    if (!inTauri) return;
    let applicato: string | null = null;
    try {
      void riallineaDedupVersioneInstallata();
      localStorage.removeItem("pt.aggiornando"); // Rimuove blocco all'avvio pulito
      applicato = localStorage.getItem(CHIAVE_AGGIORNAMENTO_APPLICATO);
      if (applicato) localStorage.removeItem(CHIAVE_AGGIORNAMENTO_APPLICATO);
    } catch {
      return;
    }
    if (!applicato) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) =>
        toast.success(`Aggiornamento completato: ora usi la versione ${v}.`, { durata: 8000 })
      )
      .catch(() => toast.success("Aggiornamento completato.", { durata: 8000 }));
  }, []);

  useEffect(() => {
    if (!inTauri) return;
    let attivo = true;
    // Evita di ri-avvisare per la stessa versione a ogni controllo.
    let versioneAvvisata: string | null = null;

    async function avvia(
      versione: string,
      installa: (onProgress: Parameters<typeof installaAggiornamento>[1]) => Promise<void>
    ) {
      if (localStorage.getItem("pt.aggiornando") === "1") return;
      localStorage.setItem("pt.aggiornando", "1");
      const id = toast.loading("Preparo l'aggiornamento...", {
        titolo: "Aggiornamento in corso",
        progress: 3,
      });
      try {
        await installa((p) => {
          toast.update(id, {
            titolo:
              p.fase === "scarico"
                ? "Scarico l'aggiornamento"
                : p.fase === "installo"
                  ? "Installo l'aggiornamento"
                  : p.fase === "riavvio"
                    ? "Riavvio in corso"
                    : "Aggiornamento in corso",
            messaggio: p.messaggio,
            progress: p.percentuale,
          });
        });
        // Se riusciamo, l'app si riavvia: questo codice di norma non torna.
        toast.update(id, {
          tipo: "success",
          titolo: "Aggiornamento installato",
          messaggio: "Riavvio il gestionale...",
          progress: 100,
          durata: 7000,
        });
      } catch (e) {
        localStorage.removeItem("pt.aggiornando");
        dimenticaAvvisoAggiornamento(versione);
        versioneAvvisata = null;
        toast.update(id, {
          tipo: "error",
          titolo: "Aggiornamento non riuscito",
          messaggio: String(e),
          progress: undefined,
          durata: 20000,
        });
      }
    }

    async function installaUltimaDaToast() {
      if (localStorage.getItem("pt.aggiornando") === "1") return;
      localStorage.setItem("pt.aggiornando", "1");
      const id = toast.loading("Preparo l'aggiornamento...", {
        titolo: "Aggiornamento in corso",
        progress: 3,
      });
      try {
        await installaUltimaVersione((p) => {
          toast.update(id, {
            titolo:
              p.fase === "scarico"
                ? "Scarico l'aggiornamento"
                : p.fase === "installo"
                  ? "Installo l'aggiornamento"
                  : p.fase === "riavvio"
                    ? "Riavvio in corso"
                    : "Aggiornamento in corso",
            messaggio: p.messaggio,
            progress: p.percentuale,
          });
        });
        toast.update(id, {
          tipo: "success",
          titolo: "Aggiornamento installato",
          messaggio: "Riavvio il gestionale...",
          progress: 100,
          durata: 7000,
        });
      } catch (e) {
        localStorage.removeItem("pt.aggiornando");
        toast.update(id, {
          tipo: "error",
          titolo: "Aggiornamento non riuscito",
          messaggio: String(e),
          progress: undefined,
          durata: 20000,
        });
      }
    }

    function mostraTestDownloadUltima() {
      toast.info("Clicca per installare l'ultima versione pubblicata.", {
        titolo: "Installa ultima versione",
        durata: 0,
        azioni: [
          {
            label: "Installa ora",
            onClick: () => void installaUltimaDaToast(),
          },
        ],
      });
    }

    async function controlla() {
      if (balloonAttivo) return; // Se le notifiche custom sono abilitate, ci pensa l'OverlayWindow!
      await riallineaDedupVersioneInstallata();
      const controlloRemoto = await import("../../remoteControl")
        .then(({ controllaDisattivazioneRemota }) => controllaDisattivazioneRemota())
        .catch(() => null);
      if (!attivo || controlloRemoto?.disabled) return;
      const trovato = await controllaAggiornamento();
      if (!attivo || !trovato) return;
      if (trovato.versione === versioneAvvisata) return; // già avvisato per questa versione
      if (!prenotaAvvisoAggiornamento(trovato.versione)) return;
      versioneAvvisata = trovato.versione;
      // `note` arriva dal manifest pubblico (sintesi della versione):
      // se c'è, la usiamo come anteprima; altrimenti un messaggio generico.
      const sintesi = trovato.note?.trim();
      toast.info(sintesi || `È disponibile la versione ${trovato.versione}.`, {
        titolo: `Aggiornamento disponibile — versione ${trovato.versione}`,
        durata: 0, // persistente finché l'utente decide
        azioni: [
          {
            label: "Aggiorna ora",
            onClick: () =>
              void avvia(trovato.versione, (onProgress) =>
                installaAggiornamento(undefined, onProgress)
              ),
          },
        ],
      });
    }

    // All'avvio (leggero ritardo: non competere col bootstrap iniziale).
    const t0 = window.setTimeout(() => void controlla(), 8000);
    const iv = window.setInterval(() => void controlla(), INTERVALLO_CONTROLLO_AGGIORNAMENTI_MS);
    let offTest: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("pt:update-test-main", () => {
          if (attivo) mostraTestDownloadUltima();
        })
      )
      .then((off) => {
        if (attivo) offTest = off;
        else off();
      })
      .catch(() => {});
    return () => {
      attivo = false;
      window.clearTimeout(t0);
      window.clearInterval(iv);
      offTest?.();
    };
  }, [balloonAttivo]);
}
