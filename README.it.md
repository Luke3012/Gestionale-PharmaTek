# Gestionale PharmaTek Demo

Questa è la variante dimostrativa pubblica del gestionale desktop PharmaTek. È un'app Tauri distinta, con identifier `it.pharmatek.gestionale.demo`, e non condivide aggiornamenti o dati locali con l'edizione operativa.

Nel repository sono presenti soltanto i nomi dei prodotti e le categorie tecniche. Prezzi, codici fornitore, provvigioni, coordinate bancarie, contatti, clienti, medici, agenti e corrieri non sono preconfigurati. Dopo l'onboarding ogni utente può inserire dall'app la propria configurazione locale.

Gli esempi documentali usano esclusivamente identificativi sintetici espliciti, tra cui `Cliente Demo 001`, `Medico Demo 001` e `Paziente Demo 001`. Database, fogli di calcolo, log, chiavi, vecchi screenshot e documenti operativi non fanno parte della repository.

## Sviluppo

Sono necessari Node.js, Rust e i prerequisiti Tauri per Windows.

```powershell
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run app:build
```

Gli aggiornamenti pubblici vengono scaricati anonimamente dalle GitHub Releases di questo repository. Le funzioni Premium sono disponibili localmente nella demo e non esiste alcun controllo remoto.

## Licenza

Non viene concessa alcuna licenza. Il repository non contiene intenzionalmente un file `LICENSE`.
