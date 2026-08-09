//! Verifica Minisign condivisa dal controllo remoto e dalla reinstallazione
//! forzata. La chiave deve restare allineata a `tauri.conf.json`.

use base64::Engine;

pub(crate) const APP_SIGNING_PUBKEY: &str = "untrusted comment: minisign public key: 92C9A682FA0D232F\nRWQvIw36gqbJklwUPSSNjv6u4lxQ28ZAbKHVLKlEa4dV1za/p/hsA98y\n";

pub(crate) fn verify_signed_payload(
    payload: &[u8],
    encoded_signature: &str,
    context: &str,
) -> Result<(), String> {
    let public_key = minisign_verify::PublicKey::decode(APP_SIGNING_PUBKEY)
        .map_err(|error| format!("chiave pubblica {context} non valida: {error}"))?;
    let signature_text = base64::engine::general_purpose::STANDARD
        .decode(encoded_signature.trim())
        .map_err(|error| format!("firma {context} non decodificabile: {error}"))?;
    let signature_text = String::from_utf8(signature_text)
        .map_err(|error| format!("firma {context} non testuale: {error}"))?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|error| format!("firma {context} non leggibile: {error}"))?;
    public_key
        .verify(payload, &signature, false)
        .map_err(|error| format!("firma {context} non valida: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chiave_tauri_e_quella_usata_dalla_reinstallazione() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let encoded = config["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("pubkey updater");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("pubkey base64");
        assert_eq!(String::from_utf8(decoded).unwrap(), APP_SIGNING_PUBKEY);
    }
}
