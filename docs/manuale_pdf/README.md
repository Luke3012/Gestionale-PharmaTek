# Manuale PDF PharmaTek

Il manuale è generato da questi file:

- `manual_manifest.py`: ordine dei capitoli, testi, didascalie e registro immagini;
- `figure_guides.py`: obiettivo, passaggi, risultato ed eventuali esempi o avvertenze per ogni schermata;
- `generate_manual.py`: impaginazione, indice, segnalibri e ottimizzazione.

## Rigenerazione

Da PowerShell, nella radice del repository:

```powershell
& 'C:\Users\lucat\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' docs\manuale_pdf\generate_manual.py
```

Il PDF viene scritto in `output/pdf/Manuale-operativo-PharmaTek.pdf`.
La build si interrompe se il manifest non copre tutte le immagini presenti nella cartella o dichiara file assenti. L'edizione corrente contiene 89 screenshot.

Le immagini originali non vengono modificate. Le copie compresse temporanee sono create in `tmp/pdfs/assets/`.

## Aggiornamenti

Per aggiungere una schermata, inserire il file PNG nella cartella screenshot, aggiungere una voce alla sezione corretta del manifest e completare la relativa guida in `figure_guides.py`. Ogni guida usa `goal`, `start`, `steps` e `result`; può inoltre contenere `terms`, `example`, `attention` e `recovery`.

La lista `FUTURE_FEATURES` alimenta la pagina grafica delle evoluzioni possibili, senza indicazioni di costo.

## Verifica visiva

```powershell
& 'C:\Users\lucat\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' docs\manuale_pdf\verify_manual.py
```

Il controllo renderizza tutte le pagine e crea le tavole di contatto in `tmp/pdfs/qa/`.
