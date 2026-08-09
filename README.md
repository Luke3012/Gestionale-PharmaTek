<div align="center">

<img src="src-tauri/icons/128x128.png" alt="Gestionale PharmaTek Demo application icon" width="104" height="104" />

# Gestionale PharmaTek Demo

**A local-first Windows workspace for the complete order lifecycle: from customer entry to production, shipping and payment.**

[**English**](README.md) · [Italiano](README.it.md)

<br />

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-core-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local%20projection-003B57?logo=sqlite&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)
![Local-first](https://img.shields.io/badge/local--first-no%20central%20server-E0A000)

</div>

> [!IMPORTANT]
> This is the public demonstration edition. It contains no operational company data, contacts, prices, supplier codes, commissions or financial coordinates. Initial records are empty and can be configured locally from the application.

<a href="docs/screenshots/readme/dashboard.webp">
  <img src="docs/screenshots/readme/dashboard.webp" alt="Gestionale PharmaTek dashboard with operational indicators and team reminders" />
</a>

## What is Gestionale PharmaTek?

Gestionale PharmaTek is a purpose-built desktop application that brings daily orders, production, shipments, payments, commissions and customer records into a single workflow.

An order entered in **Giornaliero** supplies the information needed by **Produzione**, becomes available in **Spedizioni**, and remains connected to its expected and received payments in **Contabilità**. The Dashboard, suggested actions and shared reminders make unfinished work visible without duplicating it elsewhere.

The application runs on Windows and remains usable offline. Each workstation reads and writes a fast local SQLite projection, while changes can be exchanged through a shared folder. No application server is required.

## From order to payment

| Step | Where | What happens |
|---:|---|---|
| 1 | **Giornaliero** | Create or update an order, select its records, add products and define prices, deposits and balances. |
| 2 | **Produzione** | Select complete order lines, fill in laboratory data and create a production batch. |
| 3 | **Spedizioni** | Group products by recipient, prepare parcels and export or print courier data. |
| 4 | **Contabilità** | Track expected payments, received money, instalments, commissions and refunds. |

Every saved operation updates the connected views, so the same order does not need to be rewritten in independent files.

## Product tour

<table>
<tr>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/orders.webp"><img src="docs/screenshots/readme/orders.webp" alt="Daily order register with filters, totals and payment residue" /></a><br />
<sub><b>Daily orders.</b> Search, filters, operational status, totals, received amounts and remaining balances in one register.</sub>
</td>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/order-editor.webp"><img src="docs/screenshots/readme/order-editor.webp" alt="Order editor with products, price list, deposit and payment schedule" /></a><br />
<sub><b>Guided order entry.</b> Products, deposits, balances and payment schedules are calculated from the saved order data.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/production.webp"><img src="docs/screenshots/readme/production.webp" alt="Production queue with orders ready for laboratory processing" /></a><br />
<sub><b>Production.</b> Separate orders waiting to be processed from batches already in progress.</sub>
</td>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/shipping.webp"><img src="docs/screenshots/readme/shipping.webp" alt="Shipping queue grouped by recipient and order" /></a><br />
<sub><b>Shipping.</b> Build parcels from ready products, confirm recipients and retain shipment history.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/accounting.webp"><img src="docs/screenshots/readme/accounting.webp" alt="Accounting module showing overdue and received payments" /></a><br />
<sub><b>Accounting.</b> Expected, overdue and received payments stay linked to the relevant order and account.</sub>
</td>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/records.webp"><img src="docs/screenshots/readme/records.webp" alt="Shared records for agents, doctors, customers, products, accounts and couriers" /></a><br />
<sub><b>Shared records.</b> Customers, doctors, agents, products, accounts and couriers feed the operational modules.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/spotlight.webp"><img src="docs/screenshots/readme/spotlight.webp" alt="Global Spotlight search with records and quick commands" /></a><br />
<sub><b>Spotlight.</b> Find orders and records or start a command from anywhere.</sub>
</td>
<td width="50%" valign="top">
<a href="docs/screenshots/readme/settings.webp"><img src="docs/screenshots/readme/settings.webp" alt="Application settings, backups and global search" /></a><br />
<sub><b>Settings and safety.</b> Notifications, imports, backups, appearance and workstation preferences.</sub>
</td>
</tr>
</table>

## Main capabilities

| Area | Capabilities |
|---|---|
| **Dashboard** | Year-aware indicators, charts, suggested actions, team board and recurring reminders. |
| **Orders** | Multiple product flows, status tracking, urgency markers, pricing, deposits, instalments and notes. |
| **Production** | Ready/in-progress queues, required line data, batch numbering and planned dates. |
| **Shipping** | Recipient grouping, parcel creation, cash on delivery, courier profiles, export and history. |
| **Accounting** | Expected and received movements, payment plans, commissions, refunds and reconciliation. |
| **Communications** | Email and messaging workflows, shared templates, local campaigns and controlled retries. |
| **Records** | Customers, doctors, agents, products, accounts and couriers, with import and deduplication tools. |
| **Operations** | Backups, coordinated restore, signed public updates and in-app release notes. |

## Why local-first?

- **Fast everyday use:** tables and searches read from a local SQLite projection.
- **Offline continuity:** a temporary network interruption does not stop data entry.
- **No central application server:** a shared folder can exchange changes between authorised workstations.
- **Convergent edits:** append-only event logs are merged at field level using Last-Write-Wins rules and a Hybrid Logical Clock.
- **Recoverable operations:** snapshots, backups, coordinated restore and the recycle bin cover different recovery needs.

```mermaid
flowchart LR
  subgraph A["Windows workstation A"]
    UIA["React + TypeScript"] --> CA["Tauri / Rust core"]
    CA --> DBA[("Local SQLite projection")]
  end
  subgraph S["Optional shared folder"]
    LOG[("Append-only event logs<br/>and snapshots")]
  end
  subgraph B["Windows workstation B"]
    UIB["React + TypeScript"] --> CB["Tauri / Rust core"]
    CB --> DBB[("Local SQLite projection")]
  end
  CA <-->|"append and merge"| LOG
  CB <-->|"append and merge"| LOG
```

## Public demo safeguards

- Separate application name and identifier: `Gestionale PharmaTek Demo` / `it.pharmatek.gestionale.demo`.
- Empty initial records for customers, doctors, agents, accounts and named couriers.
- Product taxonomy retained, with prices and supplier codes left empty.
- Synthetic documentation identifiers such as `Cliente Demo 001`, `Medico Demo 001` and `Paziente Demo 001`.
- Anonymous downloads from this repository's GitHub Releases, with no frontend update token.
- Premium demo features available locally and no remote control switch.

More details are available in [`docs/DEMO.md`](docs/DEMO.md).

## Developer quick start

### Requirements

- Node.js and npm
- Rust and Cargo through [rustup](https://rustup.rs)
- Visual Studio C++ Build Tools for the MSVC linker
- Microsoft Edge WebView2, normally included with Windows 11

### Run the application

```powershell
npm install
npm run app:dev
```

Run only the browser UI with `npm run dev`.

### Verify a change

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run audit:public
```

## Repository map

```text
src/                     React and TypeScript interface
src-tauri/               Rust core and Tauri desktop integration
scripts/                 development, verification, build and release tools
docs/                    public demo notes and synthetic dataset
```

## License

No license is granted. This repository intentionally contains no `LICENSE` file.

---

<div align="center">
<sub>Gestionale PharmaTek Demo · A privacy-safe public demonstration build.</sub>
</div>
