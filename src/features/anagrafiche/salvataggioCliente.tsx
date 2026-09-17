import { Box, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconArrowMerge, IconArrowRight, IconUserPlus } from "@tabler/icons-react";
import { api, type Campi, type RecordDto } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import {
  type DatiIndirizzoConfronto,
  indirizzoStrutturatoCompatibile,
  normalizzaNome,
  pulisciCap,
  pulisciTelefono,
  scegliPiuCompleto,
  sonoIndirizziCompatibili,
  telefonoCompatibile,
} from "./deduplicazione";

const CAMPI_CLIENTE = [
  ["nome", "Nome / Ragione sociale"],
  ["indirizzo", "Indirizzo"],
  ["citta", "Città"],
  ["prov", "Provincia"],
  ["cap", "CAP"],
  ["regione", "Regione"],
  ["telefono", "Telefono"],
  ["email", "E-mail"],
  ["cf", "Codice fiscale / P.IVA"],
  ["note_spedizione", "Note di spedizione"],
] as const;

function testo(value: unknown): string {
  return String(value ?? "").trim();
}

function pulisciEmail(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function cfValido(s: string): boolean {
  return s.trim().toUpperCase().length === 16;
}

function confronto(value: unknown): string {
  return testo(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function distanza(a: string, b: string): number {
  const precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonale = precedente[0];
    precedente[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const sopra = precedente[j];
      precedente[j] = Math.min(
        precedente[j] + 1,
        precedente[j - 1] + 1,
        diagonale + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonale = sopra;
    }
  }
  return precedente[b.length];
}

function similaritaTesto(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - distanza(a, b) / Math.max(a.length, b.length, 1);
}

function similaritaToken(a: string, b: string): number {
  const aa = new Set(a.split(" ").filter((token) => token.length > 1));
  const bb = new Set(b.split(" ").filter((token) => token.length > 1));
  if (!aa.size || !bb.size) return 0;
  const comuni = [...aa].filter((token) => bb.has(token)).length;
  return (2 * comuni) / (aa.size + bb.size);
}

function cfNormalizzato(value: unknown): string {
  return testo(value).replace(/[\s.-]/g, "").toUpperCase();
}

function stessoRecapito(candidato: Campi, esistente: RecordDto): boolean {
  const telefono = pulisciTelefono(testo(candidato.telefono));
  const telefonoEsistente = pulisciTelefono(testo(esistente.data.telefono));
  const email = pulisciEmail(candidato.email);
  const emailEsistente = pulisciEmail(esistente.data.email);
  return Boolean(
    (telefono &&
      telefonoEsistente &&
      (telefono === telefonoEsistente || telefonoCompatibile(telefono, telefonoEsistente))) ||
      (email && emailEsistente && email === emailEsistente),
  );
}

function stessoLuogo(candidato: Campi, esistente: RecordDto): boolean {
  const cap = pulisciCap(testo(candidato.cap));
  const capEsistente = pulisciCap(testo(esistente.data.cap));
  const citta = confronto(candidato.citta);
  const cittaEsistente = confronto(esistente.data.citta);
  return Boolean(
    (cap && capEsistente && cap === capEsistente) ||
      (citta && cittaEsistente && citta === cittaEsistente),
  );
}

export interface ClienteSimile {
  cliente: RecordDto;
  affinita: number;
}

/** Matcher prudente allineato con deduplicazione.ts: richiede compatibilità su nome e recapito/indirizzo, escludendo CF diversi. */
export function trovaClienteSimile(
  candidato: Campi,
  clienti: RecordDto[],
): ClienteSimile | null {
  const nome = normalizzaNome(testo(candidato.nome));
  const indirizzo = confronto(candidato.indirizzo);
  const cfCandidato = cfNormalizzato(candidato.cf);
  if (!nome) return null;

  const datiCandidato: DatiIndirizzoConfronto = {
    indirizzo: testo(candidato.indirizzo),
    cap: pulisciCap(testo(candidato.cap)),
    citta: testo(candidato.citta),
    prov: testo(candidato.prov),
  };

  const telCandidato = testo(candidato.telefono);
  const emailCandidato = pulisciEmail(candidato.email);

  const risultati = clienti.flatMap((cliente) => {
    if (cliente.deleted) return [];

    const cfEsistente = cfNormalizzato(cliente.data.cf);
    // Esclusione rigorosa: se entrambi hanno un Codice Fiscale valido di 16 car. e sono diversi, non sono la stessa persona
    if (cfValido(cfCandidato) && cfValido(cfEsistente) && cfCandidato !== cfEsistente) {
      return [];
    }

    const nomeEsistente = normalizzaNome(testo(cliente.data.nome));
    const indirizzoEsistente = confronto(cliente.data.indirizzo);

    // Corrispondenza nome: identico normalizzato o tolleranza fuzzy su refusi
    const nomeEsatto = nome === nomeEsistente;
    const nomeScore = nomeEsatto
      ? 1
      : Math.max(
          similaritaTesto(nome, nomeEsistente),
          similaritaToken(nome, nomeEsistente),
        );

    const indirizzoScore = Math.max(
      similaritaTesto(indirizzo, indirizzoEsistente),
      similaritaToken(indirizzo, indirizzoEsistente),
    );

    // Controlli strutturati derivati da deduplicazione.ts
    const datiEsistente: DatiIndirizzoConfronto = {
      indirizzo: testo(cliente.data.indirizzo),
      cap: pulisciCap(testo(cliente.data.cap)),
      citta: testo(cliente.data.citta),
      prov: testo(cliente.data.prov),
    };
    const indirizzoStrutturatoOk = sonoIndirizziCompatibili(datiCandidato, datiEsistente);

    const telEsistente = testo(cliente.data.telefono);
    const emailEsistente = pulisciEmail(cliente.data.email);
    const telefonoOk = telefonoCompatibile(telCandidato, telEsistente);
    const emailOk = Boolean(emailCandidato && emailEsistente && emailCandidato === emailEsistente);
    const recapito = telefonoOk || emailOk || stessoRecapito(candidato, cliente);
    const luogo = stessoLuogo(candidato, cliente);

    const compatibile =
      (nomeScore >= 0.98 && (indirizzoStrutturatoOk || recapito || (luogo && indirizzoScore >= 0.55))) ||
      (nomeScore >= 0.82 && (indirizzoStrutturatoOk || (luogo && indirizzoScore >= 0.72))) ||
      (nomeScore >= 0.72 && recapito && (luogo || indirizzoStrutturatoOk || indirizzoScore >= 0.55));

    if (!compatibile) return [];

    const affinita =
      nomeScore * 0.5 +
      (indirizzoStrutturatoOk ? 0.3 : indirizzoScore * 0.25) +
      Number(luogo) * 0.1 +
      Number(recapito) * 0.1;

    return [{ cliente, affinita }];
  });

  return risultati.sort((a, b) => b.affinita - a.affinita)[0] ?? null;
}

/** Prepara la patch di unione completando i campi vuoti e preservando il dato più completo per indirizzo e telefono. */
export function campiUnificazioneCliente(esistente: RecordDto, candidato: Campi): Campi {
  const patch: Campi = {};
  const base = { ...esistente.data };

  function current(campo: string): string {
    return String(patch[campo] ?? base[campo] ?? "").trim();
  }

  function setIfChanged(campo: string, value: string) {
    const pulito = value.trim();
    if (pulito && pulito !== current(campo)) patch[campo] = pulito;
  }

  // 1. Completa tutti i campi attualmente vuoti dell'anagrafica esistente
  for (const [campo] of CAMPI_CLIENTE) {
    const valoreCandidato = testo(candidato[campo]);
    if (!valoreCandidato) continue;
    if (!current(campo)) {
      setIfChanged(campo, campo === "cf" ? cfNormalizzato(valoreCandidato) : valoreCandidato);
    }
  }

  // 2. CF: se l'anagrafica esistente non ha un CF valido e il candidato ne ha uno valido di 16 car., aggiorna
  const cfCand = cfNormalizzato(candidato.cf);
  if (cfValido(cfCand) && !cfValido(current("cf"))) {
    setIfChanged("cf", cfCand);
  }

  // 3. Indirizzo: se compatibili e strutturati, scegli la formulazione più completa
  const indAttuale = current("indirizzo");
  const indCand = testo(candidato.indirizzo);
  if (indAttuale && indCand && indirizzoStrutturatoCompatibile(indAttuale, indCand)) {
    setIfChanged("indirizzo", scegliPiuCompleto(indAttuale, indCand));
  }

  // 4. Telefono: se compatibile e il candidato è più completo/lungo, aggiorna
  const telAttuale = current("telefono");
  const telCand = testo(candidato.telefono);
  if (
    telAttuale &&
    telCand &&
    pulisciTelefono(telCand).length > pulisciTelefono(telAttuale).length &&
    telefonoCompatibile(telAttuale, telCand)
  ) {
    setIfChanged("telefono", telCand);
  }

  // 5. Note spedizione: se le note candidate includono e ampliano quelle attuali, aggiorna
  const noteAttuali = current("note_spedizione");
  const noteCand = testo(candidato.note_spedizione);
  if (noteAttuali && noteCand && noteCand.length > noteAttuali.length && noteCand.includes(noteAttuali)) {
    setIfChanged("note_spedizione", noteCand);
  }

  return patch;
}

function AnteprimaUnificazione({
  esistente,
  candidato,
  patch,
}: {
  esistente: RecordDto;
  candidato: Campi;
  patch: Campi;
}) {
  const cambiamenti = CAMPI_CLIENTE.filter(([campo]) => campo in patch);
  return (
    <Stack gap="md">
      <Group grow align="stretch">
        <Paper withBorder radius="md" p="sm" style={{ flex: 1 }}>
          <Group gap="xs" mb={6}>
            <ThemeIcon variant="light" color="blue" radius="xl" size={30}>
              <IconArrowMerge size={16} />
            </ThemeIcon>
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" c="dimmed" fw={500}>Cliente già presente</Text>
              <Text size="sm" fw={700} truncate>{testo(esistente.data.nome) || "(senza nome)"}</Text>
            </Box>
          </Group>
          <Stack gap={2} mt={4}>
            <Text size="xs" c="dimmed">
              {[testo(esistente.data.indirizzo), testo(esistente.data.citta), testo(esistente.data.cap)]
                .filter(Boolean)
                .join(" · ") || "Nessun indirizzo"}
            </Text>
            {(testo(esistente.data.telefono) || testo(esistente.data.cf)) && (
              <Text size="xs" c="dimmed">
                {[testo(esistente.data.telefono), testo(esistente.data.cf)].filter(Boolean).join(" · ")}
              </Text>
            )}
          </Stack>
        </Paper>

        <Paper withBorder radius="md" p="sm" style={{ flex: 1 }}>
          <Group gap="xs" mb={6}>
            <ThemeIcon variant="light" color="yellow" radius="xl" size={30}>
              <IconUserPlus size={16} />
            </ThemeIcon>
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" c="dimmed" fw={500}>Dati appena inseriti</Text>
              <Text size="sm" fw={700} truncate>{testo(candidato.nome) || "(senza nome)"}</Text>
            </Box>
          </Group>
          <Stack gap={2} mt={4}>
            <Text size="xs" c="dimmed">
              {[testo(candidato.indirizzo), testo(candidato.citta), testo(candidato.cap)]
                .filter(Boolean)
                .join(" · ") || "Nessun indirizzo"}
            </Text>
            {(testo(candidato.telefono) || testo(candidato.cf)) && (
              <Text size="xs" c="dimmed">
                {[testo(candidato.telefono), testo(candidato.cf)].filter(Boolean).join(" · ")}
              </Text>
            )}
          </Stack>
        </Paper>
      </Group>

      <Box>
        <Text size="sm" fw={700} mb="xs">
          Dati che verranno aggiornati
        </Text>
        {cambiamenti.length ? (
          <Stack gap={6}>
            {cambiamenti.map(([campo, label]) => (
              <Paper
                key={campo}
                withBorder
                radius="sm"
                px="sm"
                py={8}
                style={{
                  display: "grid",
                  gridTemplateColumns: "130px minmax(0, 1fr) auto minmax(0, 1fr)",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Text size="xs" fw={600} c="dimmed">
                  {label}
                </Text>
                <Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
                  {testo(esistente.data[campo]) || "— (vuoto)"}
                </Text>
                <IconArrowRight size={14} color="var(--mantine-color-yellow-7)" style={{ flexShrink: 0 }} />
                <Text size="xs" fw={700} style={{ wordBreak: "break-word" }}>
                  {testo(patch[campo])}
                </Text>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Paper withBorder radius="sm" p="sm" bg="var(--mantine-color-default-hover)">
            <Text size="xs" c="dimmed">
              I dati coincidono: puoi confermare l'unione per utilizzare l'anagrafica esistente senza modifiche.
            </Text>
          </Paper>
        )}
      </Box>
    </Stack>
  );
}

export interface SalvataggioClienteRisultato {
  record: RecordDto;
  modalita: "creato" | "unificato";
}

/** Flusso unico usato da Anagrafiche, Ordini e creazione Preventivi. */
export async function salvaNuovoClienteConControllo(
  fields: Campi,
): Promise<SalvataggioClienteRisultato | null> {
  const clienti = await api.recordsList("cliente");
  const cf = cfNormalizzato(fields.cf);
  const stessoCf = cf
    ? clienti.find((cliente) => cfNormalizzato(cliente.data.cf) === cf)
    : undefined;
  if (stessoCf) {
    toast.warning(
      `Il cliente “${testo(stessoCf.data.nome) || "senza nome"}” esiste già con lo stesso codice fiscale. Verifica l’anagrafica prima di crearne un’altra.`,
      { titolo: "Cliente già esistente", durata: 9000 },
    );
    return null;
  }

  const simile = trovaClienteSimile(fields, clienti);
  if (!simile) {
    const creato = await api.recordCreate("cliente", fields);
    toast.success("Cliente creato.");
    return { record: creato, modalita: "creato" };
  }

  const patch = campiUnificazioneCliente(simile.cliente, fields);
  const haModifiche = Object.keys(patch).length > 0;
  const labelUnifica = haModifiche ? "Usa e aggiorna cliente" : "Usa cliente esistente";

  const scelta = await dialog.open<"annulla" | "nuovo" | "unisci">({
    tipo: "question",
    titolo: "Potrebbe essere lo stesso cliente",
    contenuto: (
      <AnteprimaUnificazione
        esistente={simile.cliente}
        candidato={fields}
        patch={patch}
      />
    ),
    valoreAnnulla: "annulla",
    bottoni: [
      { label: "Annulla", variante: "secondario", value: "annulla" },
      { label: "Salva come nuovo", variante: "informativo", value: "nuovo" },
      { label: labelUnifica, variante: "primario", value: "unisci", autofocus: true },
    ],
  });
  if (scelta === "annulla") return null;
  if (scelta === "nuovo") {
    const creato = await api.recordCreate("cliente", fields);
    toast.success("Cliente salvato come nuova anagrafica.");
    return { record: creato, modalita: "creato" };
  }

  const aggiornato = Object.keys(patch).length
    ? await api.recordUpdate("cliente", simile.cliente.id, patch)
    : simile.cliente;
  toast.success(
    Object.keys(patch).length
      ? "Dati unificati con il cliente esistente."
      : "Cliente esistente selezionato.",
  );
  return { record: aggiornato, modalita: "unificato" };
}
