import { describe, expect, it } from "vitest";
import type { RecordDto } from "../../lib/tauri";
import { gruppiRigheIncomplete } from "./gruppiProduzione";

function riga(id: string, incompleta: boolean): RecordDto {
  return { id, revision: "1", deleted: false, data: { incompleta } };
}

describe("gruppi righe produzione", () => {
  it("conserva ordine e identità raggruppando soltanto le righe incomplete", () => {
    const primo = { id: "o1", numero: "1" };
    const secondo = { id: "o2", numero: "2" };
    const righe = new Map([
      ["o1", [riga("r1", false), riga("r2", true)]],
      ["o2", [riga("r3", false)]],
    ]);

    expect(gruppiRigheIncomplete([primo, secondo], righe, (record) => record.data.incompleta === true)).toEqual([
      { ordine: primo, righe: [righe.get("o1")![1]] },
    ]);
  });

  it("ignora ordini senza righe associate", () => {
    expect(gruppiRigheIncomplete([{ id: "assente" }], new Map(), () => true)).toEqual([]);
  });
});
