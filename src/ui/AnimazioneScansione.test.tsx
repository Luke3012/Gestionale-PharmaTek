import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimazioneScansione } from "./AnimazioneScansione";
import { MantineProvider } from "@mantine/core";

describe("AnimazioneScansione", () => {
  it("renderizza titolo, sottotitolo e radar con il colore corretto", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione
          color="teal"
          title="Analisi file in corso…"
          subtitle="Lettura dei file Excel in corso"
        />
      </MantineProvider>
    );

    expect(html).toContain("Analisi file in corso…");
    expect(html).toContain("Lettura dei file Excel in corso");
    expect(html).toContain('data-color="teal"');
    expect(html).toContain("pt-scanner-beam");
    expect(html).toContain("pt-scanner-radar-ring");
  });

  it("supporta i colori violet e blue per i diversi intenti", () => {
    const htmlViolet = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione
          color="violet"
          title="Ricerca prescrizioni in corso…"
        />
      </MantineProvider>
    );
    expect(htmlViolet).toContain('data-color="violet"');

    const htmlBlue = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione
          color="blue"
          title="Preparazione prescrizioni…"
        />
      </MantineProvider>
    );
    expect(htmlBlue).toContain('data-color="blue"');
  });

  it("mostra il pulsante di annullamento solo se onCancel è fornito", () => {
    const senzaAnnulla = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione title="Caricamento…" />
      </MantineProvider>
    );
    expect(senzaAnnulla).not.toContain("Annulla");

    const conAnnulla = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione
          title="Caricamento…"
          onCancel={() => {}}
          cancelLabel="Interrompi operazione"
        />
      </MantineProvider>
    );
    expect(conAnnulla).toContain("Interrompi operazione");
  });

  it("renderizza la barra di progresso indeterminata se progress è null", () => {
    const htmlIndeterminata = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione title="Caricamento…" progress={null} />
      </MantineProvider>
    );
    expect(htmlIndeterminata).toContain("pt-scanner-progress-indeterminate");
  });

  it("renderizza la percentuale esatta se progress è numerico senza scattare a 100", () => {
    const htmlZero = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione title="Caricamento…" progress={0} />
      </MantineProvider>
    );
    expect(htmlZero).toContain('aria-valuenow="0"');

    const htmlTrenta = renderToStaticMarkup(
      <MantineProvider>
        <AnimazioneScansione title="Caricamento…" progress={35} />
      </MantineProvider>
    );
    expect(htmlTrenta).toContain('aria-valuenow="35"');
  });
});
