const NOMI_PROPRI_COMUNI = new Set([
  "ACHILLE", "ADA", "ADELE", "ADRIANA", "ADRIANO", "AGATA", "AGNESE", "ALAN", "ALBA",
  "ALBERTO", "ALDO", "ALESSANDRO", "ALESSANDRA", "ALESSIA", "ALESSIO", "ALEX",
  "ALFONSO", "ALICE", "AMBRA", "AMEDEO", "AMELIA", "AMINA", "ANDREA", "ANGELA",
  "ANGELO", "ANITA", "ANNA", "ANNALISA", "ANNAMARIA", "ANNARITA", "ANNUNZIATA",
  "ANTONELLA", "ANTONELLO", "ANTONIA", "ANTONIO", "ARIANNA", "ARMANDO", "ARTURO",
  "AURORA", "BARBARA", "BENEDETTA", "BENEDETTO", "BIANCA", "BRUNA", "BRUNO",
  "CAMILLA", "CAMILLO", "CARLA", "CARLO", "CARMELA", "CARMELO", "CARMEN", "CATERINA",
  "CECILIA", "CESARE", "CHIARA", "CHRISTIAN", "CINZIA", "CLAUDIA", "CLAUDIO",
  "CONCETTA", "CORRADA", "CORRADO", "CRISTIAN", "CRISTIANA", "CRISTINA", "DAFNE",
  "DANIELE", "DANIELA", "DARIO", "DAVIDE", "DEBORA", "DEBORAH", "DIEGO", "DOMENICA",
  "DOMENICO", "DONATELLA", "DONATO", "EDOARDO", "EFISIO", "ELENA", "ELEONORA",
  "ELISA", "ELISABETTA", "EMANUELE", "EMANUELA", "EMMA", "ENRICA", "ENRICO", "ENZO",
  "ERICA", "ERIKA", "ERNESTO", "ESTER", "ETTORE", "EVA", "FABIO", "FABIANA",
  "FABRIZIO", "FEDERICA", "FEDERICO", "FILIPPO", "FIORAVANTE", "FLAVIA", "FLAVIO",
  "FRANCA", "FRANCESCO", "FRANCESCA", "FRANCO", "GABRIELE", "GABRIELLA", "GAETANO",
  "GASPARE", "GENNARO", "GERARDO", "GIACOMO", "GIADA", "GIANCARLO", "GIANFRANCO",
  "GIANLUCA", "GIANNI", "GIGLIOLA", "GINO", "GIOELE", "GIORGIA", "GIORGIO",
  "GIOVANNA", "GIOVANNI", "GIULIA", "GIULIANA", "GIULIANO", "GIULIO", "GIUSEPPE",
  "GIUSEPPINA", "GRAZIA", "GRAZIANO", "GRETA", "ILARIA", "IRENE", "ISABELLA",
  "IVAN", "JESSICA", "KATIA", "KATIUSCIA", "LAURA", "LETIZIA", "LIA", "LINA",
  "LISA", "LOREDANA", "LORENZA", "LORENZO", "LORETTA", "LUCA", "LUCIA", "LUCIANA",
  "LUCIANO", "LUIGI", "LUISA", "MANUEL", "MANUELA", "MARCELLA", "MARCELLO", "MARCO",
  "MARGHERITA", "MARIA", "MARIANNA", "MARIANO", "MARILENA", "MARINA", "MARIO",
  "MARTA", "MARTINA", "MASSIMILIANO", "MASSIMO", "MATILDE", "MATTEO", "MATTIA",
  "MAURIZIO", "MICHEL", "MICHELA", "MICHELE", "MIRIAM", "MONICA", "MORENA", "NADIA",
  "NICOLE", "NICOLA", "NICOLETTA", "NOEMI", "ORIANA", "ORNELLA", "OSCAR", "PAOLA",
  "PAOLO", "PASQUALE", "PATRIZIA", "PIERLUIGI", "PIETRO", "RAFFAELLA", "RAFFAELE",
  "RENATA", "RENATO", "RICCARDO", "RITA", "ROBERTA", "ROBERTO", "ROCCO", "ROMINA",
  "ROSA", "ROSALIA", "ROSARIA", "ROSSELLA", "SABRINA", "SALVATORE", "SAMUELE",
  "SANDRA", "SARA", "SERENA", "SERGIO", "SILVANA", "SILVIA", "SIMONA", "SIMONE",
  "SOFIA", "SONIA", "STEFANIA", "STEFANO", "TANIA", "TERESA", "TIZIANA", "TIZIANO",
  "TOMMASO", "UCORRIERE_CRTO", "VALENTINA", "VALENTINO", "VALERIA", "VALERIO", "VANESSA",
  "VERONICA", "VINCENZA", "VINCENZO", "VIOLA", "VITTORIA", "VITTORIO",
]);

const PARTICELLE_COGNOME = new Set([
  "DA", "DE", "DEL", "DELLA", "DELLO", "DI", "D'", "LA", "LO", "VAN", "VON",
]);

function chiave(parola: string): string {
  return parola
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z']/g, "")
    .toUpperCase();
}

function cognomeValido(parti: string[]): boolean {
  return parti.length > 0 && !(parti.length === 1 && PARTICELLE_COGNOME.has(chiave(parti[0])));
}

function dizionarioNomi(nomiDb: Iterable<string>): Set<string> {
  const nomi = new Set(NOMI_PROPRI_COMUNI);
  for (const valore of nomiDb) {
    const key = chiave(valore);
    if (key) nomi.add(key);
  }
  return nomi;
}

export interface NomeCognomeRiconosciuto {
  nome: string;
  cognome: string;
  ordineRilevato: "nome_cognome" | "cognome_nome" | "esplicito" | "incerto";
}

/**
 * Riconosce entrambe le disposizioni usate nelle anagrafiche italiane, preservando
 * nomi e cognomi composti. I dizionari opzionali migliorano l'esito durante gli
 * import, ma la stessa euristica funziona anche nei form normali e nel calcolo CF.
 */
export function riconosciNomeCognome(
  valore: string,
  nomiDb: Iterable<string> = [],
  cognomiDb: Iterable<string> = [],
): NomeCognomeRiconosciuto {
  const pulito = valore.trim().replace(/\s+/g, " ");
  const conVirgola = pulito.match(/^([^,]+),\s*(.+)$/);
  if (conVirgola) {
    return {
      nome: conVirgola[2].trim(),
      cognome: conVirgola[1].trim(),
      ordineRilevato: "esplicito",
    };
  }

  const parti = pulito.split(/\s+/).filter(Boolean);
  if (parti.length <= 1) {
    return { nome: "", cognome: pulito, ordineRilevato: "incerto" };
  }

  const nomi = dizionarioNomi(nomiDb);
  const cognomi = new Set([...cognomiDb].map(chiave).filter(Boolean));
  const èNome = (parte: string) => nomi.has(chiave(parte));

  let nomePrima: NomeCognomeRiconosciuto | null = null;
  for (let i = 1; i < parti.length; i++) {
    const sinistra = parti.slice(0, i);
    const destra = parti.slice(i);
    if (sinistra.every(èNome) && cognomeValido(destra)) {
      nomePrima = {
        nome: sinistra.join(" "),
        cognome: destra.join(" "),
        ordineRilevato: "nome_cognome",
      };
    }
  }

  let cognomePrima: NomeCognomeRiconosciuto | null = null;
  for (let i = 1; i < parti.length; i++) {
    const sinistra = parti.slice(0, i);
    const destra = parti.slice(i);
    if (cognomeValido(sinistra) && destra.every(èNome)) {
      cognomePrima = {
        nome: destra.join(" "),
        cognome: sinistra.join(" "),
        ordineRilevato: "cognome_nome",
      };
      break;
    }
  }

  if (nomePrima && cognomePrima) {
    const partiCognomePrima = cognomePrima.cognome.split(/\s+/);
    const partiNomePrima = nomePrima.cognome.split(/\s+/);
    const cognomePrimaNoto = cognomi.has(
      chiave(partiCognomePrima[partiCognomePrima.length - 1] ?? ""),
    );
    const nomePrimaNoto = cognomi.has(
      chiave(partiNomePrima[partiNomePrima.length - 1] ?? ""),
    );
    if (cognomePrimaNoto !== nomePrimaNoto) return cognomePrimaNoto ? cognomePrima : nomePrima;
    return nomePrima;
  }
  if (nomePrima) return nomePrima;
  if (cognomePrima) return cognomePrima;

  return {
    nome: parti.slice(0, -1).join(" "),
    cognome: parti[parti.length - 1] ?? "",
    ordineRilevato: "incerto",
  };
}

export function riordinaNomeCognome(
  valore: string,
  nomiDb: Iterable<string> = [],
  cognomiDb: Iterable<string> = [],
): string {
  const riconosciuto = riconosciNomeCognome(valore, nomiDb, cognomiDb);
  return [riconosciuto.nome, riconosciuto.cognome].filter(Boolean).join(" ");
}

export function dividiNomeCognomeIntelligente(valore: string): { nome: string; cognome: string } {
  const { nome, cognome } = riconosciNomeCognome(valore);
  return { nome, cognome };
}
