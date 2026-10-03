import { api, type RecordDto, type Spedizione } from "../../lib/tauri";
import type {
  DestinatarioComunicazioneSpedizione,
  OrdineComunicazioneSpedizione,
} from "../../lib/tauriTypes";
import { formattaDataLocale } from "../../lib/date";
import { toast } from "../../ui/toast/store";
import {
  apriCampagnaComunicazioni,
  apriComunicazione,
  datiPagamentoComunicazione,
  importoResiduoComunicazione,
  variabiliNomeDestinatario,
  type CampagnaComunicazioneTarget,
} from "../comunicazioni/apriComunicazione";

/** Compatibilità con DTO precedenti soltanto per colli con una sola anagrafica. */
function destinatari(
  spedizione: Spedizione,
): DestinatarioComunicazioneSpedizione[] {
  if (spedizione.destinatariComunicazione)
    return spedizione.destinatariComunicazione;
  if (!spedizione.clienteId || spedizione.destinatariUniti) return [];
  return [
    {
      clienteId: spedizione.clienteId,
      clienteNome: spedizione.clienteNome,
      email: spedizione.email,
      telefono: spedizione.telefono,
      fingerprint: spedizione.comunicazioneFingerprint ?? "",
      avvisato: spedizione.avvisato ?? false,
      ordini: [
        {
          ordineId: spedizione.righe?.[0]?.ordineId ?? "",
          ordineNumero: [
            ...new Set(spedizione.righe?.map((r) => r.ordineNumero)),
          ]
            .filter(Boolean)
            .join(", "),
          medicoNome: spedizione.medicoNome,
          agenteNome: spedizione.agenteNome,
          pagamenti: spedizione.pagamenti ?? [],
        },
      ],
    },
  ];
}

export function numeroComunicazioniSpedizione(
  spedizioni: Spedizione[],
): number {
  return new Set(
    spedizioni.flatMap((s) =>
      destinatari(s)
        .filter((d) => !d.avvisato)
        .map((d) => d.clienteId),
    ),
  ).size;
}

export function preparaAvvisiSpedizione(
  spedizioni: Spedizione[],
  conti: RecordDto[],
  opzioni: { riapriSeCompleto?: boolean } = {},
): CampagnaComunicazioneTarget[] {
  const riapri = opzioni.riapriSeCompleto &&
    !spedizioni.some((s) => destinatari(s).some((d) => !d.avvisato));
  const perCliente = new Map<
    string,
    {
      spedizione: Spedizione;
      destinatario: DestinatarioComunicazioneSpedizione;
    }[]
  >();
  for (const spedizione of new Map(spedizioni.map((s) => [s.id, s])).values()) {
    for (const destinatario of destinatari(spedizione)) {
      if (destinatario.avvisato && !riapri) continue;
      const gruppo = perCliente.get(destinatario.clienteId) ?? [];
      gruppo.push({ spedizione, destinatario });
      perCliente.set(destinatario.clienteId, gruppo);
    }
  }
  return [...perCliente.values()].map((gruppo) => {
    const { spedizione: prima, destinatario } = gruppo[0];
    const ordini = new Map<string, OrdineComunicazioneSpedizione>();
    for (const item of gruppo) {
      for (const ordine of item.destinatario.ordini) {
        const corrente = ordini.get(ordine.ordineId);
        if (!corrente) {
          ordini.set(ordine.ordineId, {
            ...ordine,
            pagamenti: ordine.pagamenti.map((p) => ({ ...p })),
          });
          continue;
        }
        for (const pagamento of ordine.pagamenti) {
          const esistente = pagamento.id
            ? corrente.pagamenti.find((p) => p.id === pagamento.id)
            : undefined;
          if (esistente) esistente.importo += pagamento.importo;
          else corrente.pagamenti.push({ ...pagamento });
        }
      }
    }
    const tuttiOrdini = [...ordini.values()].sort(
      (a, b) =>
        a.ordineNumero.localeCompare(b.ordineNumero) ||
        a.ordineId.localeCompare(b.ordineId),
    );
    const pagamenti = tuttiOrdini
      .flatMap((o) => o.pagamenti)
      .filter((p) => !p.saldato);
    const blocchi = tuttiOrdini.map((o) => ({
      ordine: o,
      dati: datiPagamentoComunicazione(
        o.pagamenti,
        conti,
        "Nessun pagamento richiesto alla consegna.",
        {
          tuttiPagamenti: o.pagamenti,
          includiRate: true,
          dettagliaPagamentoSingolo: true,
        },
      ),
    }));
    const distinti = (valori: string[]) =>
      [...new Set(valori.filter(Boolean))].join(", ");
    return {
      destinatarioEntita: "cliente",
      destinatarioId: destinatario.clienteId,
      destinatarioNome: destinatario.clienteNome,
      email: destinatario.email,
      telefono: destinatario.telefono,
      tipo: "preavviso_spedizione",
      origineEntita: "spedizione",
      origineId: prima.id,
      origineFingerprint: destinatario.fingerprint,
      originiCorrelate: gruppo
        .slice(1)
        .map((i) => ({
          id: i.spedizione.id,
          fingerprint: i.destinatario.fingerprint,
        })),
      variabili: {
        ...variabiliNomeDestinatario(destinatario.clienteNome),
        nome_medico: distinti(tuttiOrdini.map((o) => o.medicoNome)),
        nome_agente: distinti(tuttiOrdini.map((o) => o.agenteNome)),
        riferimento_ordine: distinti(tuttiOrdini.map((o) => o.ordineNumero)),
        data_spedizione: distinti(
          gruppo
            .map((i) => i.spedizione.data)
            .filter(Boolean)
            .map((d) => formattaDataLocale(new Date(`${d}T12:00:00`))),
        ),
        data_spedizione_iso: prima.data,
        corriere: distinti(gruppo.map((i) => i.spedizione.corriereNome)),
        tracking:
          distinti(
            gruppo.flatMap((i) =>
              i.spedizione.righe
                .filter((r) =>
                  i.destinatario.ordini.some((o) => o.ordineId === r.ordineId),
                )
                .map((r) => r.numero),
            ),
          ) || "sarà comunicato dal corriere",
        importo_residuo: importoResiduoComunicazione(
          pagamenti.reduce((totale, p) => totale + p.importo, 0),
        ),
        istruzioni_pagamento: blocchi
          .map(
            (b) =>
              `${b.ordine.ordineNumero ? `Ordine ${b.ordine.ordineNumero}\n` : ""}${b.dati.istruzioni_pagamento}`,
          )
          .join("\n\n"),
        iban: distinti(blocchi.map((b) => b.dati.iban)),
        modalita_pagamento: distinti(
          blocchi.map((b) => b.dati.modalita_pagamento),
        ),
      },
    };
  });
}

/** Stessa preparazione da collo, gruppo e selezione: l'anteprima gestisce i recapiti mancanti. */
export async function apriAvvisiSpedizione(
  spedizioni: Spedizione[],
  singolo = false,
): Promise<boolean> {
  const targets = preparaAvvisiSpedizione(
    spedizioni,
    await api.recordsList("conto"),
    { riapriSeCompleto: singolo },
  );
  if (!targets.length) {
    toast.info("Non ci sono destinatari da avvisare nella selezione.");
    return false;
  }
  if (singolo && targets.length === 1) return apriComunicazione(targets[0]);
  return apriCampagnaComunicazioni(targets);
}
