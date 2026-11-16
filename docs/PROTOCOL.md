# The DPT-RP1 local API

Notes on how Sony's Digital Paper readers (DPT-RP1, DPT-CP1) are controlled over the local network. The protocol was
mapped out by the open-source [dpt-rp1-py](https://github.com/janten/dpt-rp1-py) project; `crates/dpt-client` is an
independent Rust implementation of it. These notes describe what that implementation relies on.

## Where the reader listens

| Port | Scheme | Used for |
|------|--------|----------|
| 8080 | HTTP   | `GET /register/information`, `GET /api_version`, and the whole pairing handshake. No login. |
| 8443 | HTTPS  | everything else, behind a login. The certificate comes from the reader's own CA, so it does not verify against public roots. |

The reader announces itself with mDNS as `_digitalpaper._tcp` (the advertised port is 8080). Over USB it shows up only as a
serial port and a HID device; there is no mass storage, so the network API is the way in.

## Pairing

The reader shows a PIN on its screen. Both sides prove they know it without sending it:

1. `PUT /register/cleanup`, then `POST /register/pin`. The reader returns a nonce `n1`, a MAC-like value, and its
   Diffie-Hellman public value `yb` (RFC 3526 group 14, generator 2). Keep `yb` as the exact bytes it sent: the reader is a
   Java device and encodes big numbers with a leading zero byte when the top bit is set.
2. The client picks `n2` and its own DH pair, derives `authKey` (32 bytes) and `wrapKey` (16 bytes) with
   PBKDF2-HMAC-SHA256 (10 000 rounds) over the shared secret, salted with `n1 || mac || n2`, and posts an HMAC to
   `/register/hash`.
3. The user types the PIN. The client posts a proof derived from it to `/register/ca`; the reader answers with its
   certificate and a confirmation hash that can only match if both used the same PIN.
4. The client generates an RSA key pair and a client id, and sends them wrapped (AES-128-CBC, IV appended, an 8 byte HMAC
   tag inside) to `/register`. That key pair is the client's identity from then on.

## Login

`GET /auth/nonce/{client_id}` returns a nonce. The client signs it (RSA PKCS#1 v1.5 over SHA-256), base64 encodes the
signature and sends `PUT /auth {"client_id", "nonce_signed"}`. The reply carries `Set-Cookie: Credentials=...`, which goes
back on every following request. A session can lapse; a 401 means log in again.

## Endpoints used

| Purpose | Request |
|---|---|
| Device facts | `GET /register/information` (model, serial, colour, SKU) |
| Battery, storage | `GET /system/status/battery`, `/system/status/storage`, `/system/status/firmware_version` |
| Screenshot | `GET /system/controls/screen_shot` (PNG) |
| Settings | `GET /system/configs/`, `PUT /system/configs/{date_format,time_format,timeout_to_standby,timezone,owner}` with `{"value": ...}`; `PUT /system/configs/datetime` |
| Wi-Fi | `GET /system/configs/wifi_accesspoints`, `POST /system/controls/wifi_accesspoints/scan`, `PUT /system/controls/wifi_accesspoints/register`, `DELETE /system/configs/wifi_accesspoints/{ssid}/{security}`, `GET/PUT /system/configs/wifi` |
| Library listing | `GET /documents2?entry_type=all` (capped at roughly 1300 entries; fall back to `GET /folders/{id}/entries2` per folder) |
| Path to id | `GET /resolve/entry/path/{quote_plus(path)}` |
| New folder | `POST /folders2 {"folder_name", "parent_folder_id"}` |
| Upload | `POST /documents2 {"file_name", "parent_folder_id", "document_source": ""}` then `PUT /documents/{id}/file` as multipart (`file` part, file name `quote_plus`ed) |
| Download | `GET /documents/{id}/file` |
| Move or rename | `PUT /documents/{id} {"parent_folder_id", "file_name"?}` |
| Copy | `POST /documents/{id}/copy` (same body) |
| Delete | `DELETE /documents/{id}`, `DELETE /folders/{id}` |
| Show on screen | `PUT /viewer/controls/open2 {"document_id", "page"}` |
| Note templates | `GET/POST /viewer/configs/note_templates`, `PUT .../{id}/file`, `DELETE .../{id}` |

Almost every number and flag in the JSON is a string (`"file_size": "1048576"`, `"is_new": "false"`).

## Things that bite

- Uploads need a real `Content-Length`; chunked transfer encoding is not reliably accepted.
- Documents are PDF only. Other formats have to be converted first.
- The reader sleeps; an unreachable address usually means it is asleep or its Wi-Fi is off, or its DHCP address changed.
  Inkboard remembers the serial number and looks the reader up again over mDNS.

Firmware updates are not implemented, on purpose: the device is out of support.
