# Icone applicazione

Generate dal logo PharmaTek (`pharmaface`, 1600×1600, scaricato da example.invalid) con:

```
npm run tauri icon ./app-icon.jpg
```

Sono presenti le varianti usate da `tauri.conf.json` (`32x32.png`, `128x128.png`,
``, `icon.icns`, `icon.ico`) più le Store logo per Windows.

Per rigenerarle dopo aver cambiato il logo sorgente, rilanciare lo stesso comando
(serve solo Node/npm, non Rust). Le cartelle `android/` e `ios/` non vengono incluse
perché l'app è solo desktop.
