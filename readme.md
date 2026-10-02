# DocDoc Offline

A local-first, web-based text workspace for LAN collaboration. Create documents, write in Markdown, preview formatting, and invite up to **five simultaneous users per document**, including yourself.

## Run locally

Requires **Node.js 20 or newer**. There are no package dependencies or build step.

```sh
npm start
```

Open **http://localhost:3000**. For collaborators, open `http://<host-LAN-IP>:3000` on devices connected to the same network. The server binds to `0.0.0.0` by default. Set `PORT` and `HOST` to change its address:

```sh
PORT=8080 HOST=0.0.0.0 npm start
npm run dev   # Restart the server when source files change
npm test      # CRDT and server request-handler integration tests
npm run check # JavaScript syntax checks
```

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

## Use the workspace

- Create and rename documents from the sidebar; search by title.
- Write Markdown with heading, bold, italic, list, and quote shortcuts; toggle Preview to read the result.
- Changes autosave in this browser. Export a `.md` file for a portable backup, including embedded photos.
- Enter your display name, select **Share document**, and copy the short invitation link or its code, such as `xyz-jnk-dvc`. Use the host’s LAN address instead of localhost when inviting another device.
- Open the invitation link, or select **Join with code** on the same LAN host and enter the code. Codes persist across host restarts; existing long invitation links still work.
- Anyone with the invitation link or code can edit unless an enabled session whitelist blocks their connection. Keep invitations within your intended group.
- The server rejects a sixth active user. Multiple tabs in one browser profile share a user identity and consume one place. Inactive places expire after 15 seconds.
- If the host disappears, continue editing the already-open page. Changes merge automatically when it returns.

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

The app automatically follows your system’s light or dark theme, including the editor, file panel, dialogs, and native controls. Changes to the system theme apply without reloading. The Markdown editor expands to display the entire document; long documents scroll with the page rather than inside the editor.

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

Select **File sharing** beside **Text editor** to share arbitrary files with this document’s collaborators. Select **Upload file** to create a shared session if needed, then use **Share document** to copy its invitation. People joining through that link can open the File sharing panel and download the files.

Files are stored separately on the LAN host, with limits of **20 MB per file**, **100 MB per session**, and **20 files per session**. The same invitation checks and five-user admission limit apply to text and files. Files persist across host restarts and are delivered as downloads, including HTML and executable file types. Each file displays its original uploader’s name and connection IP, recorded at upload time and preserved across host restarts. Older uploads show “IP not recorded.” The list refreshes while the panel is open; select Refresh files to check immediately.

File uploads and downloads require the LAN host to be online. File bytes are not copied into browser autosave, document Markdown exports, or the offline application cache. Back up `data/files/` along with the host’s document snapshots. Sessions that reach their quota need a new document/session for additional uploads.

## Offline behavior and storage

Documents and invitation credentials are stored in browser local storage. Shared document snapshots also persist in the host’s `data/` directory. Clearing browser storage removes local copies and resets that browser’s identity; keep exports and back up the host’s data directory.

A service worker caches the application after the first visit on **localhost or HTTPS**. For offline page reloads on other LAN devices, serve the app over HTTPS using a trusted certificate and a same-origin reverse proxy. Plain HTTP LAN access supports collaboration and editing in an already-open page, but does not support offline reloads. Local copies belong to the browser origin, so switching between localhost and a LAN address uses separate storage.

## Architecture and project structure

- `public/`: responsive browser UI, editor, optional Vim bindings, photo processing and preview, character CRDT, and offline cache worker.
- `src/server.js`: Node HTTP server, invitation checks, participant admission, synchronization, and atomic snapshot persistence.
- `src/access-control.js`: whitelist validation, peer-address matching, and Linux ARP-based MAC detection.
- `src/file-sharing.js`: binary file transfers, session quotas, and persistent file metadata.
- `tests/`: concurrent-edit convergence, duplicate/reordered delivery, authorization, five-user capacity, reconnection, and restart persistence checks. Server tests invoke the real request listener without opening TCP sockets.
- `docs/application-plan.md`: product scope and delivery plan.

The CRDT merges immutable character insertions and deletion tombstones; document titles use Lamport timestamps. Clients exchange complete state every two seconds. The server checks invitations and available places before merging or returning content. A browser profile has one user identity; each tab has a separate editing actor.

## Current scope

This is a text-document MVP with basic Markdown formatting, not full Word or Excel compatibility. Spreadsheets, view-only permissions, invitation-code revocation, host migration, and authenticated accounts are future work. Invitation links and short codes act as edit credentials; identities are browser-generated rather than authenticated accounts. The host enforces five distinct presented user identities, not verified people.

Synchronization accepts up to 2 MB of serialized CRDT state, including edit history. This version is intended for small documents; export a backup if storage or sync limits are reached. Undo reverses local text edits; it does not provide a full document revision history. Markdown preview supports a small formatting subset and uploaded raster photos; it does not render arbitrary HTML or fetch external Markdown images.
