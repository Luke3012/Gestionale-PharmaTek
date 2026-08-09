// Evita l'apertura della console su Windows anche nelle build di test/debug distribuite.
#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    pharmatek_gestionale_lib::run()
}
