import { inTauri, type Identity } from "../../lib/tauri";
import { opzioniGeometria } from "../../lib/geometriaFinestre";
import {
  apriFinestraTauri,
  attendiCreazioneFinestra,
  portaFinestraInPrimoPiano,
  queryIdentita,
} from "../../lib/finestreTauri";
import type { BozzaPreventivoDaZero } from "./bozzaPreventivo";

export const EVENTO_PREVENTIVO_BOZZA_PRONTA = "pt:preventivo-bozza-pronta";
export const EVENTO_PREVENTIVO_BOZZA_CONSEGNA = "pt:preventivo-bozza-consegna";
export const EVENTO_PREVENTIVO_BOZZA_MONTATA = "pt:preventivo-bozza-montata";

export interface PreventivoBozzaPronta {
  token: string;
}

export interface PreventivoBozzaConsegna {
  token: string;
  bozza: BozzaPreventivoDaZero;
}

export const GEOM_PREVENTIVO = {
  width: 900,
  height: 620,
  minWidth: 760,
  minHeight: 520,
  precedentiDefault: [{ width: 1180, height: 820 }],
} as const;

const apertureInCorso = new Map<string, Promise<boolean>>();

async function apriUnaSolaVolta(
  chiave: string,
  apri: () => Promise<boolean>,
): Promise<boolean> {
  const giaInCorso = apertureInCorso.get(chiave);
  if (giaInCorso) return giaInCorso;
  const apertura = apri();
  apertureInCorso.set(chiave, apertura);
  try {
    return await apertura;
  } finally {
    if (apertureInCorso.get(chiave) === apertura) {
      apertureInCorso.delete(chiave);
    }
  }
}

export async function apriFinestraPreventivo(
  ordineId: string | null,
  numero?: string,
  identity?: Identity,
  vista: "editor" | "anteprima" = "editor",
  ritorno?: "ordine",
): Promise<boolean> {
  if (!inTauri) return false;
  const chiave = ordineId ?? "new";
  return apriUnaSolaVolta(chiave, async () => {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const origineLabel = ritorno ? getCurrentWebviewWindow().label : "";
      const suffissoOrigine = origineLabel
        ? `-da-${origineLabel.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18)}`
        : "";
      const label = ordineId
        ? `preventivo-${ordineId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}${suffissoOrigine}`
        : `preventivo-new-${crypto.randomUUID().slice(0, 8)}`;
      const ritornoQuery = ritorno
        ? `&ritorno=${ritorno}&ritornoLabel=${encodeURIComponent(origineLabel)}`
        : "";
      const query = `preventivo=${ordineId ?? "new"}&vista=${vista}${
        numero ? `&numero=${encodeURIComponent(numero)}` : ""
      }${ritornoQuery}${queryIdentita(identity)}`;
      return apriFinestraTauri({
        label,
        query,
        title: ordineId ? `Preventivo ${numero ?? ""}`.trim() : "Nuovo preventivo",
        chiaveGeometria: "preventivo",
        geometria: GEOM_PREVENTIVO,
        riusa: !!ordineId,
        mostraDopoCreazione: true,
      });
    } catch {
      return false;
    }
  });
}

/**
 * Consegna una bozza costruita nella modale della main a una Webview dedicata.
 * Il payload resta soltanto in memoria e viene inviato dopo l'handshake della
 * finestra: non finisce nell'URL, su disco o in una cache documentale.
 */
export async function apriFinestraPreventivoDaBozza(
  bozza: BozzaPreventivoDaZero,
  identity?: Identity,
): Promise<boolean> {
  if (!inTauri) return false;
  return apriUnaSolaVolta("draft", async () => {
    let finestra: InstanceType<
      typeof import("@tauri-apps/api/webviewWindow").WebviewWindow
    > | null = null;
    const off: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [{ WebviewWindow }, { emitTo, listen }] = await Promise.all([
        import("@tauri-apps/api/webviewWindow"),
        import("@tauri-apps/api/event"),
      ]);
      const token = crypto.randomUUID();
      const label = `preventivo-draft-${token.replace(/-/g, "").slice(0, 16)}`;
      let conferma!: () => void;
      const pronta = new Promise<void>((resolve) => {
        conferma = resolve;
      });
      let confermaMontata!: () => void;
      const montata = new Promise<void>((resolve) => {
        confermaMontata = resolve;
      });
      off.push(await listen<PreventivoBozzaPronta>(
        EVENTO_PREVENTIVO_BOZZA_PRONTA,
        ({ payload }) => {
          if (payload?.token === token) conferma();
        },
      ));
      off.push(await listen<PreventivoBozzaPronta>(
        EVENTO_PREVENTIVO_BOZZA_MONTATA,
        ({ payload }) => {
          if (payload?.token === token) confermaMontata();
        },
      ));
      const query = `preventivo=draft&handoff=${encodeURIComponent(token)}${queryIdentita(identity)}`;
      finestra = new WebviewWindow(label, {
        url: `index.html?${query}`,
        title: "Nuovo preventivo",
        minWidth: GEOM_PREVENTIVO.minWidth,
        minHeight: GEOM_PREVENTIVO.minHeight,
        ...(await opzioniGeometria("preventivo", GEOM_PREVENTIVO)),
        visible: false,
      });
      if (!(await attendiCreazioneFinestra(finestra))) return false;
      await Promise.race([
        pronta,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("La finestra preventivo non è pronta.")),
            15_000,
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      await emitTo(label, EVENTO_PREVENTIVO_BOZZA_CONSEGNA, {
        token,
        bozza,
      } satisfies PreventivoBozzaConsegna);
      await Promise.race([
        montata,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("L’editor del preventivo non è stato montato.")),
            5_000,
          );
        }),
      ]);
      await portaFinestraInPrimoPiano(finestra);
      return true;
    } catch {
      await finestra?.destroy().catch(() => {});
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      off.splice(0).forEach((scollega) => scollega());
    }
  });
}
