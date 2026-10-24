# Canal estable del launcher

GitHub Pages sirve `latest.json` y `latest.yml` desde esta carpeta. El
manifiesto JSON va firmado con una clave Ed25519 propia del launcher y debe
coincidir con la versión, URL, tamaño y SHA-512 anunciados por `latest.yml`.

El flujo `.github/workflows/release-launcher.yml` publica este canal después
de verificar el instalador NSIS y subirlo a la release inmutable
`launcher-v<versión>`. El secreto de firma es
`GDC7_LAUNCHER_SIGNING_KEY`. El canal no comparte versiones, tags ni clave con
el perfil del evento.
