// Prezzi & listino integrati nella vista Prodotti (la vecchia tab "Listino" è stata
// fusa qui): una card "Prova prezzo" sopra la tabella e l'editor delle regole di
// prezzo dentro il modale "Modifica prodotto" (RegoleProdotto). La gerarchia
// "più specifica vince" è nel core (pricing): medico+prodotto > agente+prodotto >
// categoria > prezzo base.
import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconCurrencyEuro,
  IconPencil,
  IconPlus,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { api, type PrezzoSuggerito, type RecordDto } from "../../lib/tauri";
import { dialog } from "../../ui/dialog/store";
import { toast } from "../../ui/toast/store";
import { centsToEurStr, eurToCents } from "../../lib/money";
import { useTabSelect } from "../../ui/tabCompleta";
import { focusInvalidField } from "../../ui/focusInvalid";
import {
  catturaOrigineCestino,
  volaNelCestino,
  type PuntoVoloCestino,
} from "../../ui/volaCestino";

const FONTE_LABEL: Record<PrezzoSuggerito["fonte"], string> = {
  medico_prodotto: "Regola medico + prodotto",
  agente_prodotto: "Regola agente + prodotto",
  categoria: "Regola categoria",
  default: "Prezzo base del prodotto",
};

function opzioni(records: RecordDto[]) {
  return records.map((r) => ({ value: r.id, label: (r.data.nome as string) || "(senza nome)" }));
}

// ---- Prova prezzo (card sopra la tabella prodotti) ----

export function ProvaPrezzoCard() {
  const [prodotti, setProdotti] = useState<RecordDto[]>([]);
  const [medici, setMedici] = useState<RecordDto[]>([]);
  const [testProdotto, setTestProdotto] = useState("");
  const [testMedico, setTestMedico] = useState("");
  const [ris, setRis] = useState<PrezzoSuggerito | null>(null);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    Promise.all([api.recordsList("prodotto"), api.recordsList("medico")])
      .then(([p, m]) => {
        setProdotti(p);
        setMedici(m);
      })
      .catch(() => {});
  }, []);

  const optProdotti = useMemo(() => opzioni(prodotti), [prodotti]);
  const optMedici = useMemo(() => opzioni(medici), [medici]);

  const tabProdotto = useTabSelect(optProdotti, testProdotto || null, (v) => {
    setTestProdotto(v);
    setRis(null);
  });
  const tabMedico = useTabSelect(optMedici, testMedico || null, (v) => {
    setTestMedico(v);
    setRis(null);
  });

  async function calcola() {
    if (!testProdotto) return;
    setTestando(true);
    try {
      setRis(await api.prezzoSuggerito(testProdotto, testMedico || null));
    } catch (e) {
      toast.error(`Calcolo non riuscito: ${e}`);
    } finally {
      setTestando(false);
    }
  }

  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <ThemeIcon variant="light" color="accent" radius="md" size="sm">
            <IconTag size={14} />
          </ThemeIcon>
          <Text fw={700} size="sm">
            Prova prezzo
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          Verifica quale regola vince per un prodotto
        </Text>
      </Group>
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Select
          label="Prodotto"
          placeholder="Scegli…"
          data={optProdotti}
          value={testProdotto || null}
          onChange={(v) => {
            setTestProdotto(v ?? "");
            setRis(null);
          }}
          {...tabProdotto}
          w={220}
        />
        <Select
          label="Medico (opzionale)"
          placeholder="Nessuno"
          data={optMedici}
          value={testMedico || null}
          onChange={(v) => {
            setTestMedico(v ?? "");
            setRis(null);
          }}
          {...tabMedico}
          clearable
          w={220}
        />
        <Button
          variant="default"
          leftSection={<IconCurrencyEuro size={16} />}
          onClick={calcola}
          disabled={!testProdotto}
          loading={testando}
        >
          Calcola
        </Button>
        {ris && (
          <Group gap="xs">
            <Text fw={700} className="tabular" fz="lg">
              € {centsToEurStr(ris.prezzo)}
            </Text>
            <Badge variant="light" color={ris.fonte === "default" ? "gray" : "accent"}>
              {FONTE_LABEL[ris.fonte]}
            </Badge>
          </Group>
        )}
      </Group>
    </Card>
  );
}

// ---- Regole di prezzo del prodotto (dentro il modale "Modifica prodotto") ----

type TipoRegola = "agente_prodotto" | "medico_prodotto";

function tipoDiRegola(data: Record<string, unknown>): TipoRegola {
  return data.medico_id ? "medico_prodotto" : "agente_prodotto";
}

export function RegoleProdotto({
  prodottoId,
  onAperturaChange,
}: {
  prodottoId: string;
  /** Notifica il genitore quando il modale regola si apre/chiude (per bloccare la
   *  chiusura del modale "Modifica prodotto" sottostante con Esc / click fuori). */
  onAperturaChange?: (aperto: boolean) => void;
}) {
  const [regole, setRegole] = useState<RecordDto[]>([]);
  const [agenti, setAgenti] = useState<RecordDto[]>([]);
  const [medici, setMedici] = useState<RecordDto[]>([]);
  const [pronto, setPronto] = useState(false);
  // Regola in editing: RecordDto = modifica, "nuovo" = creazione, null = modale chiuso.
  const [editing, setEditing] = useState<RecordDto | "nuovo" | null>(null);

  const agById = useMemo(() => new Map(agenti.map((a) => [a.id, nomeDi(a)])), [agenti]);
  const medById = useMemo(() => new Map(medici.map((m) => [m.id, nomeDi(m)])), [medici]);

  async function carica() {
    try {
      const [r, a, m] = await Promise.all([
        api.recordsList("regola_prezzo"),
        api.recordsList("agente"),
        api.recordsList("medico"),
      ]);
      setRegole(r.filter((x) => x.data.prodotto_id === prodottoId));
      setAgenti(a);
      setMedici(m);
    } catch (e) {
      toast.error(`Caricamento regole non riuscito: ${e}`);
    } finally {
      setPronto(true);
    }
  }

  useEffect(() => {
    carica();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodottoId]);

  // Avvisa il genitore quando il modale regola è aperto, così può bloccare la
  // chiusura (Esc / click fuori) del modale "Modifica prodotto" sottostante.
  useEffect(() => {
    onAperturaChange?.(editing !== null);
    return () => onAperturaChange?.(false);
  }, [editing, onAperturaChange]);

  async function elimina(rec: RecordDto, origine?: PuntoVoloCestino) {
    const ok = await dialog.confirmDanger(
      "Eliminare la regola?",
      "La regola di prezzo verrà spostata nel Cestino.",
      { conferma: "Elimina" }
    );
    if (!ok) return;
    try {
      setRegole((correnti) =>
        correnti.filter((regola) => regola.id !== rec.id),
      );
      await api.recordDelete("regola_prezzo", rec.id);
      if (!volaNelCestino(origine)) {
        toast.success("Spostata nel Cestino.");
      }
      carica();
    } catch (e) {
      toast.error(`Eliminazione non riuscita: ${e}`);
      carica();
    }
  }

  function descrivi(data: Record<string, unknown>): { tipo: string; nome: string } {
    if (tipoDiRegola(data) === "medico_prodotto")
      return { tipo: "Medico", nome: medById.get(data.medico_id as string) ?? "?" };
    return { tipo: "Agente", nome: agById.get(data.agente_id as string) ?? "?" };
  }

  return (
    <Box>
      <Divider
        my={4}
        labelPosition="left"
        label={
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Regole di prezzo
          </Text>
        }
      />
      <Text size="xs" c="dimmed" mb="xs">
        Prezzi dedicati per agente o medico su questo prodotto. Il medico ha priorità
        sull'agente; senza regole si usa il prezzo base.
      </Text>

      {/* Lista regole esistenti */}
      {pronto && regole.length > 0 && (
        <Stack gap={6} mb="xs">
          {regole.map((r) => {
            const d = descrivi(r.data);
            return (
              <Group
                key={r.id}
                justify="space-between"
                wrap="nowrap"
                px="sm"
                py={6}
                style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}
              >
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge variant="light" color={d.tipo === "Medico" ? "grape" : "blue"}>
                    {d.tipo}
                  </Badge>
                  <Text size="sm" truncate>
                    {d.nome}
                  </Text>
                </Group>
                <Group gap={4} wrap="nowrap">
                  <Text fw={700} size="sm" className="tabular">
                    € {centsToEurStr(r.data.prezzo)}
                  </Text>
                  <ActionIcon variant="subtle" color="gray" onClick={() => setEditing(r)}>
                    <IconPencil size={15} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={(event) =>
                      elimina(r, catturaOrigineCestino(event.currentTarget))
                    }
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
              </Group>
            );
          })}
        </Stack>
      )}

      {pronto && regole.length === 0 && (
        <Text size="sm" c="dimmed" mb="xs" ta="center" py="xs">
          Nessuna regola dedicata: si usa il prezzo base.
        </Text>
      )}

      {pronto && (
        <Button
          variant="light"
          color="accent"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => setEditing("nuovo")}
        >
          Aggiungi regola
        </Button>
      )}

      <RegolaModal
        opened={editing !== null}
        regola={editing && editing !== "nuovo" ? editing : null}
        prodottoId={prodottoId}
        agenti={agenti}
        medici={medici}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          carica();
        }}
      />
    </Box>
  );
}

// ---- Modale "Nuova / Modifica regola di prezzo" (animato, in-app) ----

function RegolaModal({
  opened,
  regola,
  prodottoId,
  agenti,
  medici,
  onClose,
  onSaved,
}: {
  opened: boolean;
  regola: RecordDto | null;
  prodottoId: string;
  agenti: RecordDto[];
  medici: RecordDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Teniamo il contenuto montato durante l'animazione di uscita (smontarlo subito
  // farebbe collassare il modale su un riquadro vuoto mentre si chiude).
  const [mostrato, setMostrato] = useState(opened);
  useEffect(() => {
    if (opened) setMostrato(true);
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="md"
      zIndex={1300}
      centered
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color="accent" radius="md">
            <IconTag size={18} />
          </ThemeIcon>
          <Text fw={700}>{regola ? "Modifica regola" : "Nuova regola di prezzo"}</Text>
        </Group>
      }
      transitionProps={{ transition: "fade", duration: 180, onExited: () => setMostrato(false) }}
    >
      {mostrato && (
        <RegolaForm
          key={regola?.id ?? "nuovo"}
          regola={regola}
          prodottoId={prodottoId}
          agenti={agenti}
          medici={medici}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function RegolaForm({
  regola,
  prodottoId,
  agenti,
  medici,
  onClose,
  onSaved,
}: {
  regola: RecordDto | null;
  prodottoId: string;
  agenti: RecordDto[];
  medici: RecordDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState<TipoRegola>(
    regola ? tipoDiRegola(regola.data) : "agente_prodotto"
  );
  const [agenteId, setAgenteId] = useState((regola?.data.agente_id as string) ?? "");
  const [medicoId, setMedicoId] = useState((regola?.data.medico_id as string) ?? "");
  const [prezzo, setPrezzo] = useState<number | "">(
    typeof regola?.data.prezzo === "number" ? regola.data.prezzo / 100 : ""
  );
  const [salvando, setSalvando] = useState(false);

  const optAgenti = useMemo(() => opzioni(agenti), [agenti]);
  const optMedici = useMemo(() => opzioni(medici), [medici]);

  const tabAgente = useTabSelect(optAgenti, agenteId || null, setAgenteId);
  const tabMedico = useTabSelect(optMedici, medicoId || null, setMedicoId);

  async function salva() {
    if (prezzo === "" || Number(prezzo) < 0) {
      focusInvalidField('[data-pt-field="regola-prezzo"]');
      return;
    }
    if (tipo === "agente_prodotto" ? !agenteId : !medicoId) {
      focusInvalidField(`[data-pt-field="${tipo === "agente_prodotto" ? "regola-agente" : "regola-medico"}"]`);
      return;
    }
    const fields: Record<string, unknown> = {
      prezzo: eurToCents(Number(prezzo)),
      categoria: "",
      prodotto_id: prodottoId,
      agente_id: tipo === "agente_prodotto" ? agenteId : "",
      medico_id: tipo === "medico_prodotto" ? medicoId : "",
    };
    setSalvando(true);
    try {
      if (regola) {
        await api.recordUpdate("regola_prezzo", regola.id, fields);
        toast.success("Regola aggiornata.");
      } else {
        await api.recordCreate("regola_prezzo", fields);
        toast.success("Regola creata.");
      }
      onSaved();
    } catch (e) {
      toast.error(`Salvataggio non riuscito: ${e}`);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Box className="pt-modal-shell">
      <Box className="pt-modal-scroll">
        <Stack gap="sm">
          <SegmentedControl
            fullWidth
            value={tipo}
            onChange={(v) => setTipo(v as TipoRegola)}
            data={[
              { value: "agente_prodotto", label: "Per agente" },
              { value: "medico_prodotto", label: "Per medico" },
            ]}
          />
          {tipo === "agente_prodotto" ? (
            <Box data-pt-field="regola-agente">
              <Select
                label="Agente"
                placeholder="Scegli…"
                data={optAgenti}
                value={agenteId || null}
                onChange={(v) => setAgenteId(v ?? "")}
                {...tabAgente}
                allowDeselect={false}
                withAsterisk
                comboboxProps={{ withinPortal: true, zIndex: 1400 }}
              />
            </Box>
          ) : (
            <Box data-pt-field="regola-medico">
              <Select
                label="Medico"
                placeholder="Scegli…"
                data={optMedici}
                value={medicoId || null}
                onChange={(v) => setMedicoId(v ?? "")}
                {...tabMedico}
                allowDeselect={false}
                withAsterisk
                comboboxProps={{ withinPortal: true, zIndex: 1400 }}
              />
            </Box>
          )}
          <Box data-pt-field="regola-prezzo">
            <NumberInput
              label="Prezzo"
              value={prezzo}
              onChange={(v) => setPrezzo(v === "" ? "" : Number(v))}
              decimalScale={2}
              fixedDecimalScale
              prefix="€ "
              thousandSeparator="."
              decimalSeparator=","
              min={0}
              withAsterisk
            />
          </Box>
          <Text size="xs" c="dimmed">
            Il medico ha priorità sull'agente; senza regole si usa il prezzo base del prodotto.
          </Text>
        </Stack>
      </Box>
      <div className="pt-modal-footer" style={{ justifyContent: "flex-end" }}>
        <div className="pt-modal-actions">
          <Button variant="default" onClick={onClose} disabled={salvando}>
            Annulla
          </Button>
          <Button color="accent" loading={salvando} onClick={salva}>
            Salva regola
          </Button>
        </div>
      </div>
    </Box>
  );
}

function nomeDi(r: RecordDto): string {
  return (r.data.nome as string) || "(senza nome)";
}
