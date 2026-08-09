import {
  api,
  type AllegatoComunicazioneInput,
  type CanaleComunicazione,
  type Preventivo,
} from "../../lib/tauri";

export type AllegatiPreventivoPerCanale = Partial<
  Record<CanaleComunicazione, AllegatoComunicazioneInput[]>
>;

export function preventivoRichiedePdfSuWhatsapp(documento: {
  pagine?: readonly unknown[];
}): boolean {
  return (documento.pagine?.length ?? 0) > 0;
}

export function formatiPreventivoWhatsapp(documento: {
  pagine?: readonly unknown[];
}): Array<"image/png" | "application/pdf"> {
  return preventivoRichiedePdfSuWhatsapp(documento)
    ? ["application/pdf"]
    : ["image/png", "application/pdf"];
}

function allegatiUnici(
  allegati: AllegatiPreventivoPerCanale,
): AllegatoComunicazioneInput[] {
  const unici = new Map<string, AllegatoComunicazioneInput>();
  Object.values(allegati)
    .flatMap((elementi) => elementi ?? [])
    .forEach((allegato) => unici.set(allegato.riferimento, allegato));
  return [...unici.values()];
}

/** Rilascia i file di lavoro: il backend conserva soltanto quelli già in coda. */
export async function rilasciaAllegatiPreventivo(
  allegati: AllegatiPreventivoPerCanale,
): Promise<void> {
  const temporanei = allegatiUnici(allegati);
  if (temporanei.length > 0) {
    await api.documentiCacheRilascia(temporanei);
  }
}

/**
 * Genera soltanto i formati effettivamente scelti. I file sono protetti da una
 * lease in memoria finché il chiamante non li affida alla coda o li rilascia.
 */
export async function preparaAllegatiPreventivo(
  preventivo: Preventivo,
  canali: readonly CanaleComunicazione[],
): Promise<AllegatiPreventivoPerCanale> {
  const [renderer, config] = await Promise.all([
    import("./rendererDocumenti"),
    api.configurazioneDocumentiGet(),
  ]);
  const documento = renderer.creaDocumentoPreventivo(preventivo, config);
  if (documento.overflow.length > 0) {
    throw new Error(
      `Il preventivo non può essere generato correttamente: ${documento.overflow.join(" ")}`,
    );
  }
  const unici = new Set(canali);
  const risultato: AllegatiPreventivoPerCanale = {};
  const creati: AllegatiPreventivoPerCanale = {};
  const registra = (
    canale: CanaleComunicazione,
    allegato: AllegatoComunicazioneInput,
  ) => {
    creati[canale] = [...(creati[canale] ?? []), allegato];
    return allegato;
  };
  const formatiWhatsapp = formatiPreventivoWhatsapp(documento);
  const whatsappSoloPdf =
    unici.has("whatsapp") && formatiWhatsapp.length === 1;
  const allegatoPdf = unici.has("email") || unici.has("whatsapp")
    ? (async () => {
        const dati = renderer.documentoPdfBytes(documento);
        return api.documentoCacheSalva({
          nome: documento.nomeFile,
          mime: "application/pdf",
          dati: Array.from(dati),
        }).then((allegato) => registra("email", allegato));
      })()
    : null;
  const operazioni = [
    unici.has("email")
      ? (async () => {
          risultato.email = [await allegatoPdf!];
        })()
      : Promise.resolve(),
    unici.has("whatsapp")
      ? (async () => {
          if (whatsappSoloPdf) {
            risultato.whatsapp = [await allegatoPdf!];
            return;
          }
          const blob = await renderer.documentoPngBlob(documento);
          const dati = new Uint8Array(await blob.arrayBuffer());
          risultato.whatsapp = [
            await api.documentoCacheSalva({
              nome: documento.nomeFile.replace(/\.pdf$/i, ".png"),
              mime: "image/png",
              dati: Array.from(dati),
            }).then((allegato) => registra("whatsapp", allegato)),
            // Per una pagina WhatsApp mostra subito l'anteprima leggibile;
            // il PDF resta disponibile come secondo file scaricabile.
            await allegatoPdf!,
          ];
        })()
      : Promise.resolve(),
  ];
  const esiti = await Promise.allSettled(operazioni);
  const fallita = esiti.find(
    (esito): esito is PromiseRejectedResult => esito.status === "rejected",
  );
  if (fallita) {
    await rilasciaAllegatiPreventivo(creati).catch(() => {});
    throw fallita.reason;
  }
  return risultato;
}
