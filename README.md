# Inkboard

A desktop app for e-ink readers: the **Sony DPT-RP1** (and, in principle, the DPT-CP1) Digital Paper over Wi-Fi, and
**Android e-readers such as ONYX Boox** over USB. It manages their files, and it turns a reader into a **dashboard screen**:
you compose pages out of widgets, Inkboard renders them and puts them on the reader as a PDF (or as PNG pages).

The DPT-RP1 is no longer sold or updated. It is still a very good 13.3" e-ink screen, and Inkboard exists so that it keeps
being useful instead of ending up in a drawer.

Built with Tauri 2, Rust and Vue 3. Linux is the platform it is developed on; the pieces are portable but untested elsewhere.

## Readers

| | Sony Digital Paper (Wi-Fi) | Android e-reader, e.g. Boox (USB, MTP) |
|---|---|---|
| Library / files | its own library of PDFs | a file manager for the whole storage |
| Upload, download, rename, move, delete | yes | yes (folders are deleted with their contents) |
| Settings on the reader (clock, time zone, standby, Wi-Fi) | yes | no, change them on the reader |
| Live mirror of the screen | yes | no |
| Open a document on the reader's screen | yes | no, open it from the reader's own file app |
| Dashboards | PDF, opened right after publishing | PDF, PNG pages, or a pen template saved to a folder |
| Pen | pen battery shown; note templates in Settings | pages saved to `noteTemplate` appear as custom templates in Boox Notes |

Switch between readers with the selector at the top of the sidebar. A USB reader shows up there by itself when it is plugged
in and set to file transfer (MTP). On Linux, the `libmtp` package ships the udev rules that let a normal user talk to it.

## What it does

**Digital Paper**
- Finds the reader on your network (mDNS) or takes an address, and pairs with it using the PIN the reader shows.
- Battery, pen battery, storage, firmware and API version, and a live mirror of what the reader is showing.
- Settings: date and time format, time zone, auto-standby, owner name, set the clock from the computer, Wi-Fi networks
  (list, add, forget, on/off), note templates.

**Library**
- Browse every folder and document, search, sort, multi-select.
- Upload PDFs (picker or drag and drop), download, rename, move, copy, delete, new folders, open a document on the reader's screen.
- Transfer progress for large files.

**Dashboards**
- Pages of widgets on a snap grid: text, clock, month calendar, checklist, countdown, image, computer status, reader status,
  a value fetched from a web address, command output, boxes and lines, and links between pages.
- What you see in the editor is exactly what is published: the editor and the export use the same drawing code.
- Publish uploads the dashboard to a folder on the reader and can open it right away; export saves the PDF locally.
- Multi-page dashboards can link to each other (the reader follows PDF links when you tap them) and can refresh on a timer
  while Inkboard is open.

Not included, on purpose: **firmware updates**. The reader is out of support and there is nothing to update to.

## Things worth knowing

- **PDF only.** The reader opens PDF files and nothing else. Convert EPUB, FB2 or MOBI first (for example with Calibre).
- **Same network.** The computer and the Digital Paper must be on the same Wi-Fi network, and its Wi-Fi must be on. Over
  USB the Digital Paper exposes no files, so the network API is the only way in. (Android readers are the other way round: USB only.)
- **The reader draws a dashed outline around PDF links.** Give link widgets a visible border and the outline just looks like a button.
- **Pairing keys** live in your config folder (`~/.config/inkboard`, owner-only permissions). Keys made by
  [dpt-rp1-py](https://github.com/janten/dpt-rp1-py) in `~/.config/dpt` can be imported instead of pairing again.
- **TLS.** The reader's HTTPS certificate comes from its own CA, so Inkboard does not verify it against public roots. The
  traffic stays on your local network.
- **Shell commands in dashboards are off by default.** The Command widget runs a command as you; turn it on in Settings
  only for dashboards you trust.

## Build and run

Requirements: Rust (stable), Node 22+, pnpm, and on Linux the Tauri system libraries (WebKitGTK 4.1, GTK 3, librsvg).

```bash
pnpm install
pnpm tauri dev        # run the app
pnpm tauri build      # produce a release build and bundles
```

Checks:

```bash
cargo test --workspace   # protocol client, PDF writer, commands (no reader needed)
pnpm typecheck
pnpm test                # drawing, grid, undo and the other pure logic of the UI
```

### Developing the UI without a reader

`pnpm dev` serves the page in an ordinary browser, where a built-in mock backend answers every command with invented data.
Useful URL switches: `?mock=paired` (both readers), `?mock=mtp` (only a USB reader), `?mock=dpt` (only the Digital Paper), `?mock=unplugged`, `?mock=big` (a 2000-entry library), `?mock=offline`,
`?mock=legacy` (offer to import old keys), `?theme=dark|light`, `?view=device|library|dashboards|settings` (open on a section), `?chrome` (draw the window buttons).

### Talking to a reader from the command line

```bash
cargo run -p dpt-client --example discover               # list readers on the network
cargo run -p dpt-client --example probe -- <address>     # read-only smoke test (uses ~/.config/dpt keys)
```

## Layout

| Path | What |
|---|---|
| `crates/dpt-client` | The Digital Paper's protocol: pairing, login, library, settings, Wi-Fi, uploads. See [docs/PROTOCOL.md](docs/PROTOCOL.md). |
| `src-tauri` | The commands the window calls, USB readers over MTP (via [mtp-rs](https://crates.io/crates/mtp-rs)), dashboard storage, system stats, the PDF and PNG writers. |
| `src` | The Vue app: views, the dashboard editor and renderer (`src/dashboard`), a mock backend (`src/mock`). |

## Credits

The reader's protocol was mapped out by [dpt-rp1-py](https://github.com/janten/dpt-rp1-py); `dpt-client` is an independent
implementation of the same protocol.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
