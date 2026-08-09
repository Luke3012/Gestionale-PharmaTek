import { Badge, Box, Group, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconArrowMerge, IconArrowRight, IconUserPlus } from "@tabler/icons-react";
import { api, type Campi, type RecordDto } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { normalizzaNome, pulisciCap, pulisciTelefono } from "./deduplicazione";

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
  const email = testo(candidato.email).toLowerCase();
  const emailEsistente = testo(esistente.data.email).toLowerCase();
  return Boolean(
    (telefono && telefonoEsistente && telefono === telefonoEsistente) ||
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

/** Matcher prudente per il salvataggio interattivo: richiede nome e almeno un'altra prova. */
export function trovaClienteSimile(
  candidato: Campi,
  clienti: RecordDto[],
): ClienteSimile | null {
  const nome = normalizzaNome(testo(candidato.nome));
  const indirizzo = confronto(candidato.indirizzo);
  if (!nome) return null;

  const risultati = clienti.flatMap((cliente) => {
    if (cliente.deleted) return [];
    const nomeEsistente = normalizzaNome(testo(cliente.data.nome));
    const indirizzoEsistente = confronto(cliente.data.indirizzo);
    const nomeScore = Math.max(
      similaritaTesto(nome, nomeEsistente),
      similaritaToken(nome, nomeEsistente),
    );
    const indirizzoScore = Math.max(
      similaritaTesto(indirizzo, indirizzoEsistente),
      similaritaToken(indirizzo, indirizzoEsistente),
    );
    const recapito = stessoRecapito(candidato, cliente);
    const luogo = stessoLuogo(candidato, cliente);
    const compatibile =
      (nomeScore >= 0.98 && (recapito || (luogo && indirizzoScore >= 0.55))) ||
      (nomeScore >= 0.82 && luogo && indirizzoScore >= 0.72) ||
      (nomeScore >= 0.72 && recapito && (luogo || indirizzoScore >= 0.55));
    if (!compatibile) return [];
    const affinita = nomeScore * 0.55 + indirizzoScore * 0.25 + Number(luogo) * 0.1 + Number(recapito) * 0.1;
    return [{ cliente, affinita }];
  });
  return risultati.sort((a, b) => b.affinita - a.affinita)[0] ?? null;
}

export function campiUnificazioneCliente(esistente: RecordDto, candidato: Campi): Campi {
  const patch: Campi = {};
  for (const [campo] of CAMPI_CLIENTE) {
    let prossimo = testo(candidato[campo]);
    if (!prossimo) continue;
    if (campo === "cf") prossimo = cfNormalizzato(prossimo);
    if (prossimo !== testo(esistente.data[campo])) patch[campo] = prossimo;
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
        <Paper withBorder radius="md" p="sm">
          <Group gap="xs" mb={5}>
            <ThemeIcon variant="light" color="blue" radius="xl" size={28}>
              <IconArrowMerge size={15} />
            </ThemeIcon>
            <Box>
              <Text size="xs" c="dimmed">Cliente già presente</Text>
              <Text size="sm" fw={700}>{testo(esistente.data.nome) || "(senza nome)"}</Text>
            </Box>
          </Group>
          <Text size="xs" c="dimmed">
            {[testo(esistente.data.indirizzo), testo(esistente.data.citta), testo(esistente.data.cap)]
              .filter(Boolean)
              .join(" · ") || "Nessun indirizzo"}
          </Text>
        </Paper>
        <Paper withBorder radius="md" p="sm">
          <Group gap="xs" mb={5}>
            <ThemeIcon variant="light" color="yellow" radius="xl" size={28}>
              <IconUserPlus size={15} />
            </ThemeIcon>
            <Box>
              <Text size="xs" c="dimmed">Dati appena inseriti</Text>
              <Text size="sm" fw={700}>{testo(candidato.nome) || "(senza nome)"}</Text>
            </Box>
          </Group>
          <Text size="xs" c="dimmed">
            {[testo(candidato.indirizzo), testo(candidato.citta), testo(candidato.cap)]
              .filter(Boolean)
              .join(" · ") || "Nessun indirizzo"}
          </Text>
        </Paper>
      </Group>

      <Box>
        <Group justify="space-between" mb="xs">
          <Text size="sm" fw={700}>Dati che cambieranno</Text>
          <Badge variant="light" color={cambiamenti.length ? "yellow" : "gray"}>
            {cambiamenti.length}
          </Badge>
        </Group>
        {cambiamenti.length ? (
          <Stack gap={6}>
            {cambiamenti.map(([campo, label]) => (
              <Paper key={campo} withBorder radius="sm" px="sm" py={7}>
                <Text size="xs" fw={600} mb={3}>{label}</Text>
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed" style={{ flex: 1, wordBreak: "break-word" }}>
                    {testo(esistente.data[campo]) || "—"}
                  </Text>
                  <IconArrowRight size={14} color="var(--mantine-color-yellow-7)" />
                  <Text size="xs" fw={600} style={{ flex: 1, wordBreak: "break-word" }}>
                    {testo(patch[campo])}
                  </Text>
                </Group>
              </Paper>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            I dati coincidono: puoi usare il cliente esistente senza modificarlo.
          </Text>
        )}
      </Box>
    </Stack>
  );
}

export interface SalvataggioClienteRisultato {
  record: RecordDto;
  modalita: "creato" | "unificato";
}

/** Flusso unico usato da Anagrafiche, Ordini e quindi dalla creazione Preventivi. */
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
      { label: "Salva come nuovo", variante: "ignora", value: "nuovo" },
      { label: "Unifica i dati", variante: "primario", value: "unisci", autofocus: true },
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
