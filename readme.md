# DocDoc Offline

DocDoc Offline is a self-hosted, local-first workspace for writing Markdown and DOCX documents and sharing files with people on the same local network. It is designed for teams that want a simple collaborative space without relying on a cloud account or internet connection for everyday editing.

Documents are saved in each browser and can be edited offline. When you share a document, a DocDoc host stores a durable copy and synchronizes changes with invited collaborators. Markdown uses the existing character CRDT; DOCX uses Tiptap and Yjs for structured rich text. Both merge concurrent edits and catch up after temporary disconnections. Each document supports up to **five active browser-profile identities**, including the owner. The workspace also includes Markdown preview, embedded photos, optional Vim-style editing, and a separate shared-files area with folders and scoped folder invitations.

DocDoc is currently a focused text-document MVP. It does not provide full Microsoft Word or Excel compatibility, spreadsheets, authenticated user accounts, or internet-scale cloud hosting. Invitations grant editing access; display names are labels rather than verified identities. See the [technical specification](docs/technical-specification.md) and [CRDT domain guide](docs/crdt-domain-guide.md) for the system model and collaboration details.

## Use cases

- **Draft together on a local network:** invite a small group to edit meeting notes, plans, procedures, or project documentation. Concurrent changes merge, and an interrupted connection can catch up later.
- **Keep working through an outage:** continue editing a document already open in the browser when the host or network is unavailable. Changes are saved locally and synchronize when the host returns.
- **Share a private team document:** distribute a short invitation code on a trusted LAN, optionally restrict the session with an IP, username, or detectable MAC address allowlist, and keep the shared copy on a self-hosted machine.
- **Collect and distribute project files:** use the document's separate file-sharing area for uploads, organized folders, streamed downloads, and ZIP folder downloads. Give guests access to one folder subtree without granting access to the document text.
- **Write and review lightweight Markdown:** use editing shortcuts, preview formatting, add embedded photos, then export a portable `.md` document.
- **Run a small self-hosted workspace:** keep room snapshots and shared-file bytes on a machine you control, back up its `data/` directory, and serve it to devices on the LAN.

These use cases assume collaborators can reach the same host. Offline editing works for browser-local documents; shared file bytes require the host to be available.

## Screenshots

| Focused document editing | Dark theme with shared folders |
| --- | --- |
| ![DocDoc in focus mode with the surrounding workspace hidden](docs/screenshots/focus-light.png) | ![DocDoc file-sharing view in dark theme with folders](docs/screenshots/folders-dark.png) |

| Mobile focus mode | Folder guest workspace |
| --- | --- |
| ![DocDoc focus mode on a narrow mobile screen](docs/screenshots/focus-mobile.png) | ![Scoped file-sharing workspace opened through a folder invitation](docs/screenshots/folder-guest-light.png) |

## Run locally

Requires **Node.js 20 or newer** and npm. Install the locked dependencies before starting. Installation requires registry access (or an existing npm cache); editing and DOCX conversion do not require internet access.

```sh
npm ci
npm start     # Builds the browser bundles, then starts the host
```

Open **http://localhost:3000**. For collaborators, open `http://<host-LAN-IP>:3000` on devices connected to the same network. The server binds to `0.0.0.0` by default. Set `PORT` and `HOST` to change its address:

```sh
PORT=8080 HOST=0.0.0.0 npm start
npm run dev   # Build once, then restart the server when its modules change
npm run build # Rebuild browser assets after browser source changes
npm test      # CRDT, access, transfers, and UI unit/integration tests
npm run check # JavaScript syntax checks
```

`npm run build` bundles the browser entrypoint and conversion worker into `public/assets/` using esbuild, and generates `public/sw.js` from `scripts/service-worker.js` with the complete asset list and a content-derived cache version. No CDN is used. After changing browser source, rebuild and reload; `npm run dev` watches the server's imported modules. To run an already-built production installation, use `node src/server.js`. The Docker image installs dependencies and builds assets before pruning development dependencies.

Runtime dependencies are Tiptap (core, StarterKit, image, collaboration, ProseMirror bridge), Yjs and its `lib0` decoder, Mammoth for import, `docx` for export, `fflate` for bounded ZIP inspection, and `buffer` for browser compatibility. `docx` is pinned to 9.5.1 to retain Node 20 compatibility. Exact versions and transitive dependencies are recorded in `package-lock.json`; esbuild is a development dependency. `.editorconfig` records two-space JavaScript conventions. `npm run check` recursively checks source, scripts, and feature tests; `npm test` uses Node's built-in test runner.

For browser verification, install Chromium using your OS package manager, then run:

```sh
npm run test:browser
# If Chromium has a different executable path:
CHROMIUM=/path/to/chromium npm run test:browser
```

This opens an isolated headless browser and a temporary local server, exercises Markdown and DOCX, browser conversion, offline reloads, collaboration, and light/dark/mobile layouts, and updates `docs/screenshots/`. It requires permission to bind a loopback port and launch Chromium. It never uses the host's `data/` or your browser profile.

## Run with Docker at boot (Linux)

The Docker package uses host networking to retain LAN connection IPs and MAC lookup behavior. Install Docker Engine and Docker Compose, then run these commands from the repository directory:

```sh
mkdir -p data
docker compose up -d --build
```

Open **http://localhost:3000** or `http://<host-LAN-IP>:3000`. Existing snapshots and shared files remain in `./data`, mounted into the container; back up this directory. The container runs as UID/GID 1000 by default. If the data directory belongs to a different user, start with `DOCDOC_UID=$(id -u) DOCDOC_GID=$(id -g) docker compose up -d --build`.

If Docker reports a bridge-network `veth` error, use this Compose configuration rather than starting the image with a plain `docker run`. Both the build and running container use host networking to avoid bridge interfaces. Recreate the service with `docker compose up -d --build --force-recreate`. For a manual launch, include `--network host`; port publishing (`-p`) is unnecessary with host networking.

Enable Docker's system service so the container returns after a reboot:

```sh
sudo systemctl enable --now docker
```

The `unless-stopped` restart policy starts the container when Docker starts, unless you deliberately stopped it. These commands manage the instance:

```sh
docker compose start         # Start an existing stopped instance
docker compose stop          # Stop it, including automatic boot startup
docker compose logs -f       # Follow application logs
docker compose ps            # View status and health
docker compose up -d --build # Rebuild and run after application changes
```

To use another port, run `DOCDOC_PORT=8080 docker compose up -d`. Use the same port override when recreating the container. Host networking makes the configured port available directly on the Linux host; choose an unused port. Docker's health check reports whether the application responds; the restart policy restarts exited processes rather than unhealthy containers.

Large transfers stream through `data/files/<session-id>/` on the bind mount. Allow at least 1 GiB of disk space per full session, plus snapshots and operational headroom. Run one DocDoc process per data directory so in-memory admission and upload reservations remain authoritative. Uploads have no fixed request-body timeout; keep reverse-proxy body limits at least **1,073,741,824 bytes**, disable request/response buffering for file routes, and allow enough transfer time for your LAN. ZIP downloads are streamed without a precomputed Content-Length. No extra Docker ports or dependencies are needed.

## Use the workspace

- Select **New document**, choose **Markdown** (the default) or **DOCX**, then select **Create document**. Rename from the title field and search by title in the sidebar. The first-run starter remains Markdown. A document keeps its chosen format.
- Write Markdown with heading, bold, italic, list, and quote shortcuts; toggle Preview to read the result.
- Changes autosave in this browser. Export a `.md` or `.docx` file for a portable content backup, including embedded photos.
- Enter your display name, select **Share document**, and copy the short invitation link or its code, such as `xyz-jnk-dvc`. Use the host’s LAN address instead of localhost when inviting another device.
- Open the invitation link, or select **Join with code** on the same LAN host and enter the code. Codes persist across host restarts; existing long invitation links still work.
- Joined Markdown documents open in **Preview**, including when reopened from the sidebar. Select **Edit** to write. Locally created documents start in editing mode.
- Anyone with the document invitation link or code can edit unless an enabled session whitelist blocks their connection. Keep invitations within your intended group.
- The server rejects a sixth active user. Multiple tabs in one browser profile share a user identity and consume one place. Inactive places expire after 15 seconds; an upload in progress retains its place.
- If the host disappears, continue editing the already-open page. Changes merge automatically when it returns.

## Collaborative DOCX

Choose **DOCX** to write rich text with paragraphs, headings 1–6, bullet and numbered lists, bold, italic, links, and embedded images. The toolbar provides formatting, link editing, and **Photo**; Markdown preview and Vim controls are hidden. **Undo** reverses local rich-text edits. Title editing, local autosave, document switching/deletion, invitations, presence, access rules, and shared files work with either format. DOCX invitations open the rich editor after admission and synchronization.

Select **Import DOCX** to replace the current rich document with a `.docx` file. Conversion runs entirely in a browser worker. The current document is kept if parsing, validation, size checks, or the worker fail, or if the document changes while import is running. **Export** downloads a `.docx` generated from the visible rich content, using a filename derived from the title. Conversion also works after a cached offline reload; document contents are never sent to a conversion service.

This is a defined Word subset, not full Microsoft Word compatibility:

- Supported: paragraphs, semantic headings, bullet/numbered lists (up to nine nested levels on export), bold, italic, `https`/`http`/`mailto` links, embedded PNG/JPEG/WebP images. WebP becomes PNG on export.
- Tables are flattened into text. Page layout, fonts, colors, headers/footers, comments, tracked changes, fields, footnotes, and other advanced Word features may be simplified or omitted. Custom styles and list numbering/restarts may be simplified. Images export inline with bounded dimensions; exact Word sizing and positioning are not retained. Keep the original file when fidelity matters.
- Import limits: 10 MiB compressed, 20 MiB expanded, 2,000 ZIP entries, 4 MiB per XML entry, and a 20-second worker timeout. Unsupported/encrypted/malformed files show an error. Embedded import images must be valid PNG/JPEG/WebP at most 256 KiB each; unsupported or oversized images reject the import. Photo uploads use the existing resize/compression workflow.
- The room request limit remains 2 MiB. DOCX reserves room for request metadata with a 1,900 KiB encoded-state limit and extra import headroom. Yjs history and embedded image bytes count toward it, so large files can be rejected even within the ZIP limits. Browser storage quota can be reached sooner.

Browser records and host snapshots store an immutable `kind`: `markdown` or `docx`. Records lacking it are read as Markdown without a migration rewrite. Markdown snapshots retain the character-CRDT format and existing protocol defaults; DOCX snapshots carry a versioned base64 Yjs update plus the title register. The host validates and durably merges Yjs state without passing it through the Markdown parser. New clients send the kind on creation and sync; invitations and sync responses expose it. Older clients can continue using Markdown rooms but cannot edit DOCX rooms.

![DOCX editor with supported formatting and an embedded image](docs/screenshots/docx-editor.png)

## Default access list

Select **Default access list** in the sidebar to save an optional template in this browser. It starts disabled and uses the same IP, username, and detectable-MAC matching rules as session Access. New local documents copy the current template at creation, including offline. Later template changes affect future documents only; existing and joined documents keep their policies. When a local document first creates a host session, the host validates and saves its inherited policy atomically with the initial document snapshot. There is no unrestricted interval before policy application.

Invalid entries show an error; failed template saves retain the previous stored settings. Existing documents without an inherited policy continue to create sessions with the whitelist disabled. The session owner retains the usual access override and can change individual sessions with **Access**.

## Session whitelists

Select **Access** beside Share document. Enable the whitelist, enter allowed IP addresses, usernames, or MAC addresses (one per line or comma-separated), then select **Save access settings**. An invitation remains required. A participant is allowed when **any** listed value matches; an enabled empty list permits only the owner. Disable the whitelist to restore normal invitation access.

- **IP:** exact IPv4 or IPv6 connection addresses, such as `192.168.1.20`. IPv4-mapped IPv6 addresses are normalized. Forwarding headers are ignored, so use direct LAN connections for per-device IP rules; a reverse proxy’s address identifies the proxy rather than the device.
- **Username:** case-insensitive match against the name entered in the app. Names are self-declared and are not authenticated accounts. For device restrictions, use IP or detectable MAC rules rather than relying on a username alone.
- **MAC:** match the Linux host’s detected IPv4 ARP entry, such as `aa:bb:cc:dd:ee:ff`. Browsers do not supply MAC addresses. This requires a device reachable on the host’s local IPv4 network and a complete ARP entry. Unknown MACs, devices behind routers/proxies, unsupported hosts, and IPv6-only connections cannot match MAC-only rules.

Settings persist on the host and apply to joining, editing, photo synchronization, and all file transfers. Removing access blocks future requests and releases matching active slots; it cannot erase copies someone already received. The Access dialog shows your connection address and connected participants’ addresses to the owner.

Only the session’s private **owner key** can change settings. New sessions save it in the creating browser and on the host; it is excluded from invitations and collaborator responses. The owner remains allowed but still counts toward the five-user limit.

For sessions created before this feature, or after losing browser storage, first access the session to initialize its owner key. On the LAN host, read `ownerToken` from the corresponding `data/<session-id>.json` file and paste it into Access’s owner-key field. The dialog identifies the file. Treat that key as private; recovered keys are saved only after validation. Back up the host’s session files to preserve settings and owner credentials.

New browser profiles receive a random default name such as `GuiltyPride0239`, saved for future visits. Change it using **Your name**. Existing custom names are preserved; the old default “You” is replaced on the next visit. Generated names are display labels, not unique or authenticated accounts.

## Appearance

The app follows your system’s light or dark theme by default, including the editor, file panel, dialogs, and native controls. Use the theme toggle at the top right to switch modes; your choice is saved in this browser and applies across reloads. The Markdown editor expands to display the entire document; long documents scroll with the page rather than inside the editor.

Select **Focus mode** in editing or preview to hide the sidebar and surrounding workspace while retaining the title, view switch, and essential controls. **Exit focus mode** or Escape returns to the workspace. Escape closes an open dialog first; switching documents or opening file sharing also exits focus. Browser chrome remains visible. Icons are bundled SVG symbols using the current text color and accessible button labels, including when labels change.

## Optional Vim bindings

Select **Vim** in the toolbar to enable the bindings. The preference is saved in this browser; regular typing is the default. A visible bar above the editor shows Normal, Insert, or Visual mode and a shortcut hint. The mode dropdown lets you switch without remembering shortcuts. Enabling Vim, restoring its saved preference, or opening another document starts in **Insert mode**, so you can type immediately. Press `Esc` for Normal mode, and `i` or choose Insert to resume typing. A solid, nonblinking caret marks the current position in all Vim modes while the editor is focused. It follows keyboard movement and wrapping; Visual mode also highlights the selection.

| Keys | Action |
| --- | --- |
| `i`, `a`, `I`, `A` | Insert at cursor, after cursor, at first nonblank character, or at line end |
| `Esc` | Return to Normal mode |
| `h j k l`, arrow keys | Move left, down, up, right |
| `w`, `b`, `0`, `^`, `$` | Next/previous word, line start, first nonblank, line end |
| `gg`, `G` | First/last line |
| `o`, `O` | Open a line below/above and enter Insert mode |
| `v` | Toggle Visual selection; `d`/`x` deletes and `y` yanks the selection |
| `x`, `dd`, `dw`, `d$` | Delete characters, lines, words, or to line end |
| `yy`, `p`, `u` | Yank line, paste internal register, undo local text edit |

Counts such as `3j`, `2dd`, and `3x` are supported. Tab and browser shortcuts remain available. This is a basic Vim layer, without Ex commands, macros, search, or the complete Vim command set.

## Photo uploads and preview

Select **Photo** to upload a PNG, JPEG, or WebP image at the editor cursor. Thumbnails appear beneath the editor; **Preview** shows images inline with the document. To remove a photo from the document, delete its `![description](docdoc-image:...)` text.

Uploads accept files up to 10 MB. Photos are resized to a maximum dimension of 1600 pixels and compressed to JPEG, at most 256 KB each; transparency is flattened onto white. Photos are saved with the document and synchronized to collaborators, with no external image hosting. They remain available offline along with the local copy.

Export replaces internal photo references with embedded data URLs. Use a Markdown viewer that supports embedded image data to display exported photos. Stored photo data remains in document history after removing its reference, and counts toward the existing 2 MB document sync limit. Adding a photo that would exceed the limit is rejected before changing the document.

## File-sharing mode

Select **File sharing** beside **Text editor**. Use **New folder**, **Upload files**, or **Upload folder** to start a shared session if needed. Breadcrumbs navigate nested folders. The session owner can rename and move folders, move files with the destination picker, and delete empty folders. Folder names must be unique within a parent; duplicate filenames are allowed and their IDs distinguish them.

Files have limits of **1 GiB (1,073,741,824 bytes) per file**, **1 GiB total per document session**, and **1,000 files per session**. Folders do not count as files; a separate 5,000-folder metadata cap applies. Uploads stream into temporary files and reserve capacity so concurrent requests cannot exceed limits. Folder uploads preserve relative paths and run sequentially after a size/count preflight. Progress shows completed, failed, and cancelled uploads. **Retry unfinished uploads** skips completed files and reuses private upload keys to avoid duplicates after a lost response. Keep the page open to retain its retry queue; closing it discards the queue. Folder selection exposes files and their relative paths; create empty folders explicitly with **New folder**.

Each file shows its original uploader's name and connection IP, preserved across restarts. Older uploads show “IP not recorded.” The session owner can delete any file after confirmation. The original uploading browser can delete new uploads using its private deletion credential, saved separately in local storage and never exposed by file listings. Clearing that storage loses uploader deletion rights; the owner can still delete. Legacy files without deletion credentials are owner-deletable only. Deleting immediately removes metadata and releases quota. If the filesystem refuses byte deletion, the host records cleanup work and retries when the room is loaded or files are requested.

**Download folder** streams a ZIP of the selected folder and its descendants, including empty folders. Duplicate filenames are disambiguated in ZIPs using file IDs. Downloads use short-lived, single-use tickets and the browser's download manager; the page does not allocate a file-sized Blob. Tickets expire after 60 seconds, disappear on host restart, and recheck current invitation scope and whitelist rules on redemption. Start the download again if a ticket expires or has already been used.

### Independent folder invitations

Open a folder as the session owner, then select **Folder invitations** to create or revoke short codes. Copy the code or link to a guest. Each code permits browsing, downloading, uploading, and subfolder creation within that folder and its descendants. Guests receive a **file-only workspace**: their credentials cannot read document content, document invitations, owner keys, sibling folders, or ancestor metadata. Owner-only rename/move/delete controls are hidden; an uploader can still delete their own uploads with the private key.

Folder guests obey the document whitelist and share the same five-user admission limit with document collaborators. Revocation blocks subsequent requests, including download tickets and uploads still being received. Moving a file outside a guest's scope also blocks later downloads. Already downloaded copies cannot be recalled. The owner can recover older owner keys through the existing **Access** workflow.

### Host data and compatibility

Back up **all of `data/`**, including JSON snapshots and `data/files/`, before updating the host. Existing document snapshots, CRDT migration, document invitations, and root-file endpoints remain compatible. Missing folder metadata defaults to an empty hierarchy; old files appear at the root without rewriting original uploader details. New snapshots additionally persist folder IDs/names/parent IDs, optional file folder IDs, private deletion hashes, folder invitations, and pending cleanup IDs. File bytes retain opaque UUID filenames; user-provided names are never disk paths.

Interrupted temporary uploads are cleaned on restart. Failed or cancelled uploads release their reservations; completed files remain if later files fail. File bytes and folder metadata require the LAN host online and are not included in browser document autosave, Markdown exports, or the service-worker cache. Core editing, DOCX conversion, and saved default-access templates remain local-first.

### File API

All room routes require `Authorization: Bearer <document-or-folder-token>`. File and folder routes use `?user=<browser-id>&name=<display-name>`; owner actions also require `X-Owner-Key`. Document-only routes never accept folder credentials.

| Route | Behavior |
| --- | --- |
| `POST /api/rooms` | Accepts immutable `kind` (defaults to Markdown), matching `state`, and optional validated `policy`, saved together |
| `GET /api/rooms/:id/files` | Scoped files/folders, quota totals, and limits; legacy files remain at root |
| `POST /api/rooms/:id/files?folder=<id>` | Raw streaming body, percent-encoded `X-File-Name`, optional 64-hex `X-Upload-Key`; returns private `deletionToken` only to uploader |
| `GET /api/rooms/:id/files/:file` | Compatible authenticated streaming download |
| `PATCH /api/rooms/:id/files/:file?folder=<id>` | Owner moves a file; empty folder parameter means root |
| `DELETE /api/rooms/:id/files/:file` | Owner or private `X-Deletion-Key` holder deletes a scoped file |
| `GET/POST /api/rooms/:id/folders` | Scoped inventory or `{action: create/rename/move/delete, name, id, parentId}` |
| `POST /api/rooms/:id/folder-invitations` | Owner `{action: create/list/revoke, folderId, code}` |
| `POST /api/invitations/join` | `{code, user, name}`; folder result has `kind: "folder"` and scoped credentials |
| `POST /api/rooms/:id/download-tickets` | `{user, name, fileId}` or `{user, name, folderId}`; returns a native download URL |
| `GET /api/downloads/:ticket` | Single-use streaming file or ZIP after current-access checks |

## Offline behavior and storage

Documents and invitation credentials are stored in browser local storage. Shared document snapshots also persist in the host’s `data/` directory. Clearing browser storage removes local copies and resets that browser’s identity; keep exports and back up the host’s data directory.

A service worker caches the application after the first visit on **localhost or HTTPS**. For offline page reloads on other LAN devices, serve the app over HTTPS using a trusted certificate and a same-origin reverse proxy. Plain HTTP LAN access supports collaboration and editing in an already-open page, but does not support offline reloads. Local copies belong to the browser origin, so switching between localhost and a LAN address uses separate storage.

## Architecture and project structure

```text
public/
  app.js, index.html, styles.css, icons.svg   # Startup, shell, and shared visual assets
  sw.js                                    # Generated offline cache worker
  assets/                                  # Generated browser bundles (gitignored)
  shared/                                  # Document kinds, access-policy contract, icons
  features/
    documents/                             # Records, Markdown CRDT/editor, rich model/schema/editor, DOCX conversion
    collaboration/                         # Invitation parsing, request client, identity labels
    access/                                # Session controls and default policy templates
    files/                                 # Shared-file/folder workspace
    preferences/                           # Theme and focus mode
src/
  server.js                                # Server startup and public createApp entrypoint
  features/
    rooms/                                 # HTTP document routes, invitation index, atomic snapshots
    access/                                # Authorization, whitelist matching, admission
    files/                                 # File/folder routes, streams, quotas, ZIP downloads
tests/
  features/{documents,collaboration,access,files}/
  support/                                 # Request/browser harnesses and shared fixtures
scripts/                                   # Build, syntax checks, browser verification entrypoint
docs/                                      # Product plan, technical specification, CRDT guide, screenshots
```

The server imports the same feature-owned document models and kind contract as the browser. Rich-text conversion modules run only in the browser. Shared-file bytes stay in the host's `data/files/` and are distinct from document images. Both formats exchange full state every two seconds, keeping the existing five-user admission and access-policy checks. A browser profile has one user identity; each tab has an independent CRDT actor/client ID. Server integration tests call the real request listener without binding TCP; browser tests use an isolated host and Chromium profile.

See [the technical specification](docs/technical-specification.md) for state and protocol details, [the Markdown CRDT guide](docs/crdt-domain-guide.md) for its merge model, and [the application plan](docs/application-plan.md) for scope and future work.

## Current scope

This is a document MVP with Markdown and a limited collaborative DOCX subset. Full Word/Excel fidelity remains outside its scope. Spreadsheets, view-only permissions, document-invitation revocation, host migration, and authenticated accounts are future work. Invitation links and short codes act as edit credentials; identities are browser-generated rather than authenticated accounts. The host enforces five distinct presented user identities, not verified people.

Synchronization accepts up to 2 MB of serialized CRDT state, including edit history. This version is intended for small documents; export a backup if storage or sync limits are reached. Undo reverses local edits within the active editor; it does not provide a full document revision history. Markdown preview supports a small formatting subset and uploaded raster photos; it does not render arbitrary HTML or fetch external Markdown images.
