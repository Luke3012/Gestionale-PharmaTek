import { Stack } from "@mantine/core";

/** Data che passa automaticamente da una riga a tre righe quando la colonna si stringe. */
export function DataAdattiva({
  iso,
  compatta = true,
}: {
  iso?: string | null;
  /** Se false mantiene sempre gg/mm/aaaa su una sola riga. */
  compatta?: boolean;
}) {
  if (!iso || iso.length < 10) return <span className="tabular">{iso || "—"}</span>;
  const giorno = iso.slice(8, 10);
  const mese = iso.slice(5, 7);
  const anno = iso.slice(0, 4);
  if (!compatta) {
    return (
      <span className="tabular" style={{ whiteSpace: "nowrap" }}>
        {giorno}/{mese}/{anno}
      </span>
    );
  }
  return (
    <span className="pt-data-adattiva tabular" aria-label={`${giorno}/${mese}/${anno}`}>
      <span className="pt-data-adattiva-estesa">{giorno}/{mese}/{anno}</span>
      <Stack className="pt-data-adattiva-compatta" gap={0} align="center">
        <span>{giorno}/</span>
        <span>{mese}/</span>
        <span>{anno}</span>
      </Stack>
    </span>
  );
}
