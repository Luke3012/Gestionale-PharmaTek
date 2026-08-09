# Gestionale PharmaTek Demo

Public demonstration build of the PharmaTek desktop management application. It is a separate Tauri application with identifier `it.pharmatek.gestionale.demo` and does not share updates or local data with the operational edition.

The repository contains product names and technical categories only. Prices, supplier codes, commissions, bank details, contacts, customer records, doctors, agents and couriers are deliberately absent. After onboarding, users can enter their own local configuration from the application.

All documentation examples use explicit synthetic identifiers such as `Cliente Demo 001`, `Medico Demo 001` and `Paziente Demo 001`. No production database, spreadsheet, log, key, old screenshot or operational document is part of this repository.

## Development

Requirements: Node.js, Rust and the Tauri prerequisites for Windows.

```powershell
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run app:build
```

Public updates are downloaded anonymously from this repository's GitHub Releases. Premium features are available locally in the demo and there is no remote control switch.

## License

No license is granted. This repository intentionally contains no `LICENSE` file.
