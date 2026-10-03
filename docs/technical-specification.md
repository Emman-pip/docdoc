# DocDoc Technical Specification

This document describes the implemented DocDoc Offline MVP as a system: its domain, storage boundaries, synchronization protocol, trust model, and operational limits. It complements the user instructions in [the README](../readme.md) and the original [application plan](application-plan.md). “Current” statements refer to this repository, not a promised future design.

## 1. Product domain

DocDoc is a local-first text workspace with optional LAN collaboration. A person can create and edit Markdown or structured DOCX documents in a browser without a host. Sharing a document creates a hosted room on one DocDoc server. Each browser keeps a copy; the server keeps a durable snapshot and serves as the rendezvous point for exchanging state.

The application has two related but distinct content domains:

| Domain | What it contains | Persistence |
| --- | --- | --- |
| Document | Immutable kind; title; Markdown character history/images or DOCX Yjs rich content/images | Browser local storage and, for shared rooms, host JSON snapshot |
| Shared files | Opaque file bytes plus names, uploader metadata, folders, invitations | Host filesystem and JSON snapshot only |

The shared-files feature is attached to a room but is not part of the document CRDT or Markdown export. Folder invitations provide a constrained file workspace; they do not grant access to document text. Local-only documents do not currently include the shared file store.

### Actors and identities

- **Browser profile identity (`user`)**: random persistent value in local storage; tabs in the same profile share it and take one room slot.
- **Editor actor (`actor`)**: random value per page load/tab. Character IDs are unique within this actor's monotonically increasing logical clock. Separate tabs therefore write under separate actors.
- **Display name**: self-declared label for presence and file attribution; it is not authentication.
- **Room owner credential**: a random secret retained by the creating browser and stored in the host snapshot. It grants owner operations such as access-policy and folder-invitation management.
- **Room bearer token**: secret shared by document collaborators, authorizing document synchronization and room-level file access.
- **Folder invitation token**: scoped bearer credential for one folder subtree. It cannot call document synchronization routes.
- **Uploader deletion credential**: private credential returned only to the uploader; host persists a hash and checks it for uploader deletion.

These credentials are capabilities. They are not user accounts, and a display name cannot establish who someone is. Treat document invitations as edit credentials.

## 2. System shape and data flow

```mermaid
flowchart LR
  subgraph Browser[Each browser origin]
    UI[Markdown editor or Tiptap rich editor]
    Model[Markdown CRDT or Yjs]
    Local[localStorage snapshot]
    UI --> Model
    Model --> Local
  end
  subgraph Host[One LAN host]
    API[Node HTTP API]
    Room[Room state and admission]
    Snap[Atomic JSON snapshots]
    Bytes[Shared file bytes]
    API --> Room
    Room --> Snap
    API --> Bytes
  end
  Model <-->|Full-state exchange about every 2 seconds| API
  Local -. initial state on share .-> API
```

`public/` runs in the browser; `src/server.js` composes startup; `src/features/rooms/http.js` handles room requests and composes the access and file features. Both runtimes load the feature-owned document models under `public/features/documents/`. The server is authoritative for durable shared-room snapshots, invitation lookup, policy checks, admission, folder scope, and file quotas. It is not a user-authentication service and it does not act as an editor lock.

The server stores a room snapshot by writing a temporary JSON file and renaming it into place. A room snapshot includes the room ID, room token, invitation code, owner token, access policy, immutable document kind, typed CRDT snapshot, files metadata, folder metadata, folder invitations, and pending byte-cleanup work. File bytes are stored separately under `data/files/<room-id>/` with opaque names. Back up the entire `data/` directory as one logical unit.

## 3. Document kinds and CRDTs

`public/shared/document-kind.js` defines exactly `markdown` and `docx`. Missing kinds default to Markdown in legacy records and snapshots without requiring a rewrite. Explicit null, unknown values, and cross-format snapshots are rejected. The browser record kind cannot change during merging, and room kind cannot change during synchronization. A folder capability still uses `room.kind: "folder"`; its local placeholder record is Markdown and never participates in document sync.

### Markdown

The text CRDT is implemented by `Document` in `public/features/documents/crdt.js`. It is a replicated growable array (RGA)-style sequence. Each inserted Unicode JavaScript string code unit is one immutable node:

```text
{ id: "<actor>:<clock>", after: "<parent-id-or-empty>", value: "x", clock: 17, actor: "..." }
```

The `after` field points to the preceding character in the insertion's observed sequence. The root is the empty string. A node's ID is its actor and clock pair. The node never changes after insertion; removing text adds its node ID to the grow-only `deleted` set (a tombstone). Tombstoning is monotonic: later delivery cannot make that node visible again.

### Deterministic ordering

Nodes that share the same `after` parent are concurrent siblings or inserts at the same logical position. The renderer sorts siblings by descending Lamport clock, then descending actor string for ties, and walks the resulting tree depth first. Every replica with the same node and tombstone sets therefore renders the same sequence, independent of message order. Descendants of deleted nodes are still traversed, preserving text inserted after content another replica later deleted.

This ordering gives deterministic convergence, not necessarily the ordering a human would expect for every simultaneous insertion. The RGA structure prioritizes stable references and convergence over intention reconstruction.

### Local edit translation

The editor exposes a whole text value. `Document.edit(value)` finds the longest common prefix and suffix between the visible old value and the new value. It tombstones the old nodes in the changed middle, then inserts the new middle as a chain after the unchanged prefix. This is a compact translation for ordinary typing but does not preserve per-character identity through arbitrary edits as a syntax-aware editor might. For example, replacing a large middle section creates tombstones and new nodes for that entire section.

### Logical clocks and title

The local logical clock advances when inserting a node or renaming the title, and merging state raises it to the largest observed node/title clock. New local operations increment it. The title is a last-writer-wins register ordered by `(clock, actor)`; ties resolve by lexicographically larger actor. The title is capped at 120 JavaScript string units.

### Embedded images

Image records are keyed by image ID and merged by set union. Reusing an ID with different data is rejected as a conflict. Markdown references point to these records using internal `docdoc-image:` URLs. Deleting a Markdown reference does not remove the image record; image data remains in CRDT history and contributes to the serialized document limit.

### Merge and validation

`merge(snapshot)` validates the snapshot shape and node/title/image constraints, rejects conflicting values for an existing node or image ID, and unions nodes, tombstones, and images. It uses no operation log or central sequence number. Missing `after` parents are retained in state but are not reachable from the root until their parent arrives; the next merge can make them visible. This permits out-of-order delivery.

In mathematical terms, node and tombstone union, image union (with conflict rejection), and max-register title selection are designed to be associative, commutative, and idempotent for valid, non-conflicting operations. Those properties explain why duplicate and reordered whole-state delivery converges. They do not by themselves protect against malicious state, actor-ID reuse, resource exhaustion, or semantic conflicts in formatting.

### Important limits

- Text is represented as UTF-16 code units because JavaScript string indexing is used. A visible emoji may be multiple CRDT nodes.
- Tombstones and image records are never compacted. The state grows with edit history, even when visible text stays short.
- The Markdown editor uses plain text; its character CRDT does not model paragraphs, rich-text marks, tables, formulas, or spreadsheet cell identities.
- There is no durable operation history, revision browser, selective undo, or cross-device undo. Undo reverses local editor text changes by making new CRDT operations.
- Actor uniqueness depends on random per-tab IDs. Reusing an actor/clock ID for a different node is rejected as a conflict.

### DOCX structured state

`RichDocument` in `public/features/documents/rich-document.js` wraps a Yjs document whose `body` XML fragment is bound to Tiptap by its collaboration extension. The schema permits paragraphs, headings 1–6, bullet/ordered lists, list items, text, line breaks, bold, italic, links, and inline images. Other StarterKit content is disabled. Editor transactions are checked before applying unsupported content. This uses Yjs and the Tiptap binding; it does not implement a second custom rich-text CRDT.

The JSON wire/local snapshot is `{format: "docdoc-yjs-v1", update: "<base64 Yjs v1 update>", title: {value, clock, actor}}`. The title keeps the same Lamport-register semantics as Markdown so local list/title behavior remains consistent. Images are attributes of Yjs image nodes, containing validated embedded PNG/JPEG/WebP data; no shared-file credential is needed to render them. The browser has a separate Yjs client ID per model instance and persists the entire encoded update, including deletion state.

Merging decodes the binary into a candidate Y.Doc, rejects malformed/trailing bytes and unsupported shared types/fields, validates the resulting XML tree and ProseMirror schema, validates links/images/attributes, and enforces the state size budget before applying the update to the live document. The host persists a changed candidate atomically before acknowledging it. Invalid state or failed persistence leaves the prior host state available. Duplicate and reordered Yjs updates converge, including updates awaiting earlier structs. Normal browser polling sends full updates for simple recovery; it is not a state-vector delta transport.

Tiptap supplies local collaborative undo. Remote state is applied to the bound Y.Doc without replacing the editor contents or selection. Switching documents destroys the old editor and Y.Doc. The browser preserves records of either kind during cross-tab storage merges, rejecting kind changes.

### Browser DOCX conversion

Mammoth converts a bounded DOCX archive to HTML in a dedicated worker. `fflate` checks expanded ZIP size/entry count and rebuilds the archive before handing it to Mammoth; external file access and embedded style maps are disabled. A 20-second timeout terminates stuck imports. Inert template parsing removes unsupported elements and attributes before ProseMirror schema parsing, and links and embedded images are validated. A candidate replacement checks the resulting state budget, including existing edit history. Only a successful conversion with the same active, unchanged document reaches `setContent`; errors retain the current document.

The `docx` package generates a downloadable file from current editor JSON in the browser. It writes paragraph/heading styles, nested numbering, bold/italic runs, hyperlinks, and image runs. Browser image decoding supplies dimensions; WebP images are converted to PNG for export. Export filenames omit filesystem separators and unsafe punctuation.

Supported fidelity is semantic content, not Word page rendering. Tables flatten to text; page layout, headers/footers, fonts/colors, comments, tracked changes, fields, footnotes, and advanced features may be simplified or omitted. Custom style names, list starts/restarts, and image sizing/positioning may be simplified. Import accepts at most 10 MiB compressed, 20 MiB expanded, 2,000 ZIP entries, 4 MiB per XML entry, and 256 KiB per embedded raster image. Export supports nine nested list levels. No host or third-party conversion service receives document contents.

## 4. Persistence, synchronization, and recovery

### Browser-local persistence

The browser stores document records, credentials, preferences, and identity in `localStorage`. After local changes, the app snapshots the in-memory CRDT and writes the document records back. A storage failure is surfaced to the user; the page retains in-memory changes, but they are at risk if the tab closes. Export Markdown or DOCX as a portable content backup. Local storage is scoped to the exact origin, so `localhost` and a LAN hostname are separate workspaces.

### Full-state anti-entropy

For a joined document, the browser sends its complete current snapshot to `POST /api/rooms/:id/sync` approximately every two seconds, and when the browser reports network connectivity restored. The server:

1. validates invitation bearer token and access policy;
2. validates the presented browser identity and checks the five-identity active limit;
3. checks the immutable room kind and validates/merges the matching CRDT state into a candidate;
4. rejects it if serialized CRDT state exceeds 2 MiB (DOCX additionally reserves request headroom with a 1,900 KiB encoded-state budget);
5. atomically persists a changed candidate before accepting it;
6. returns `kind`, the merged snapshot, and current participant labels.

The browser checks response kind and merges the returned snapshot into the matching model, refreshes the editor, and persists again. This is anti-entropy by repeated full snapshots, rather than a push stream or delta protocol. It is easy to recover missed edits after temporary disconnection but costs bandwidth and CPU proportional to accumulated state on every exchange. Synchronization does not happen while the editor is composing an IME input.

### Offline and reconnection behavior

Local editing does not require the server. If the host cannot be reached, the browser keeps changes locally and retries during later synchronization. Once connectivity returns, client and server snapshots are merged in both directions. A client that was offline does not hold a lock and does not lose its state merely because other clients continued editing.

Offline reload has browser security constraints: the service worker is registered only in a secure context (localhost or HTTPS). On plain HTTP LAN, an already-open page can continue editing offline, but a cold offline reload is not available. The shared file store is host-only and cannot be browsed or downloaded while the host is unavailable.

### Durability boundaries

- Browser `localStorage`: per-origin client copy and credentials; lost when site storage is cleared or unavailable.
- Host `data/<room-id>.json`: durable shared room snapshot and metadata; room memory is reconstructed from this file after restart.
- Host `data/files/<room-id>/`: shared file bytes; separate from document text snapshots.
- In-memory only: active users and heartbeat times, upload reservations, rate-limit counters, and short-lived download tickets. These reset on restart.

There is no multi-host replication, quorum, host election, or automatic migration. One process should own a data directory because active admission and upload reservations are in memory.

## 5. Sharing, access, and trust boundaries

### Document invitation flow

The host creates a room from an initial client snapshot and optional validated access policy. It returns a room ID, room kind, room bearer token, short code, and owner token. A code resolves on that host to the document capability. Joining exchanges the code for the room credentials and kind, then admits the browser through a typed sync before opening the editor; it does not create an account. A participant must present the room token for document APIs.

Document invitation access is currently edit access. There is no view-only role and no document-invitation revocation control. Revoking a credential is not possible through the user-facing MVP; anyone who already copied document content retains that copy.

### Session access policy

An optional whitelist is evaluated with OR semantics: any matching allowed IP, normalized MAC, or case-insensitive display name permits the request. Forwarded IP headers are ignored. MAC matching depends on the host's local IPv4 ARP table and may not be available for remote/routed clients. A whitelist supplements the invitation; it does not replace the bearer secret. The owner token permits policy administration and owner operations, with an owner override in policy evaluation.

### Admission and presence

Room presence uses the browser profile's `user` ID. All tabs in one profile consume one place; distinct profiles consume separate places. Sync refreshes a participant's `seen` time. A participant expires after 15 seconds without activity unless an active transfer retains its slot. Five is the maximum number of presented IDs; the server cannot verify that IDs correspond to five distinct people or prevent deliberate identity spoofing.

### Folder scope

A folder invitation is a separate bearer capability whose authority is a folder and its descendants. Server-side checks enforce scope for inventory, upload, download, and folder creation, and document-only routes require the room token. Revocation and scope changes affect future requests and download-ticket redemption; bytes already downloaded cannot be recalled.

### Web security controls and limits

The server sets a same-origin content security policy, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`; it rejects cross-origin API requests. Bearer credentials are sent in authorization headers and not placed in invitation URLs. Short-code joins are rate-limited by peer address. These controls reduce accidental exposure but do not turn the app into an authenticated internet service. Deploy on a trusted LAN; protect host backups because they contain bearer and owner credentials.

## 6. Shared files domain

File metadata references opaque server-generated byte paths. User-supplied names are metadata and are never disk paths. Folder IDs form a parent-child tree; duplicate file names are allowed, while folder names must be unique among siblings. The server enforces per-file and per-room byte limits, file and folder count caps, and upload reservations before concurrent streams consume capacity.

Uploads stream to temporary files and become visible after completion and metadata persistence. Folder uploads preserve relative paths. Retry keys make a repeated upload request idempotent for the same browser queue. Downloads stream either the selected file or a ZIP archive. A short-lived, one-use ticket lets the browser invoke the native download manager without buffering a large file in JavaScript memory; ticket redemption rechecks current access.

Deletion removes metadata and quota immediately. If physical byte removal fails, a garbage-cleanup record is retained for a later retry. The host uses private uploader deletion credentials (stored as hashes), while the owner can delete any file. Folder guests cannot rename, move, or delete arbitrary files, though an uploader may delete their own upload.

## 7. HTTP protocol reference

All API bodies are JSON except raw file upload bodies and streamed downloads. Room credentials are sent as `Authorization: Bearer <token>`. User-bearing file/folder requests include `user` and `name`; owner operations additionally send `X-Owner-Key`.

| Endpoint | Purpose and key behavior |
| --- | --- |
| `POST /api/rooms` | Create room from `{kind?, state, policy?}` (missing kind means Markdown); returns room credentials and invitation code |
| `POST /api/invitations/join` | Resolve `{code, user, name}`; returns document capability with `kind`, or scoped `kind: "folder"` capability |
| `POST /api/rooms/:id/sync` | Submit `{user, name, kind?, state}`; returns immutable `kind`, merged `state`, `users`, and limit |
| `POST /api/rooms/:id/leave` | Release the presented browser identity's active place |
| `POST /api/rooms/:id/invitation` | Return or create the room's invitation details |
| `POST /api/rooms/:id/access` | Owner gets or sets whitelist policy and sees connection/participant metadata |
| `GET/POST /api/rooms/:id/files` | List inventory or stream an upload; folder can be selected by query |
| `GET/PATCH/DELETE /api/rooms/:id/files/:fileId` | Download, move, or delete an individual file |
| `GET/POST /api/rooms/:id/folders` | Scoped inventory and folder create/rename/move/delete actions |
| `POST /api/rooms/:id/folder-invitations` | Owner creates, lists, or revokes folder capabilities |
| `POST /api/rooms/:id/download-tickets` | Create a short-lived ticket for file or folder download |
| `GET /api/downloads/:ticket` | Redeem once; rechecks access and streams content |

The authoritative route behavior is in `src/features/rooms/http.js`, `src/features/files/routes.js`, and their feature modules. This table is a domain-level map; consult those handlers before changing wire compatibility.

## 8. Operational limits and failure modes

| Limit | Current value / behavior |
| --- | --- |
| Active presented users per room | 5, including owner |
| Presence expiry | 15 seconds without activity; transfers retain the slot |
| Serialized CRDT sync request/state | 2 MiB |
| Photo upload input | 10 MiB; normalized image at most 1600 px and 256 KiB |
| File size | 1 GiB per file |
| Total file bytes per room | 1 GiB |
| File count | 1,000 per room |
| Folder metadata count | 5,000 per room |
| Download ticket | One use, 60 seconds, in-memory only |

Storage pressure can arise before visible text is large because CRDT tombstones are retained. Exporting Markdown or DOCX does not preserve CRDT history, access policy, invitation credentials, folders, or shared-file bytes. Host backups must include snapshot JSON and file bytes. A filesystem or browser-storage write failure should be treated as a durability warning, not as proof that a change was saved.

## 9. Current scope and extension points

The MVP deliberately covers text and LAN collaboration. It supports a limited DOCX subset. It does not implement full office file compatibility, spreadsheet cells/formulas, comment/review workflows, account authentication, role-based view-only access, document invitation revocation, host migration, delta synchronization, tombstone compaction, or cross-host replication.

Before adding spreadsheets, define stable row/column identity, concurrent cell write policy, behavior for row/column deletion versus references, and deterministic formula evaluation. Before compacting history, establish replica acknowledgement or another safe rule proving no offline replica still needs a tombstoned element.

## 10. Code map and build

- `public/app.js`: small browser startup; `public/features/documents/workspace.js`: composes the document workspace with collaboration, access, file, and preference features.
- `public/features/documents/`: local records and typed model factory; existing Markdown CRDT/editor/Vim/photos; rich schema, Yjs model, Tiptap editor, browser DOCX import/export.
- `public/features/collaboration/`: invitation parsing, API requests, display names. `public/features/access/`: access/defaults UI. `public/features/files/`: file/folder UI. `public/features/preferences/`: theme and focus.
- `public/shared/`: immutable kind contract, policy validation shared with the host, and icons shared across UI features.
- `src/server.js`: startup; `src/features/rooms/`: document routes, room persistence and invitation index; `src/features/access/`: authorization/admission and LAN identity; `src/features/files/`: routes, storage, quotas, folder scope, ZIP streams.
- `tests/features/`: documents, collaboration, access, and files, including feature browser scenarios. `tests/support/`: shared request/browser harnesses and fixtures. Server integration tests invoke the request listener without TCP.
- `scripts/build.mjs`: esbuild bundles `public/app.js` and the DOCX worker into gitignored `public/assets/`, then generates `public/sw.js` from `scripts/service-worker.js` with all required bundles/chunks, shell assets, and a content hash. Secure-origin offline reloads include the conversion worker. File bytes/API responses are never cached.

Node 20+ with npm is required. Run `npm ci`, `npm run build`, then `node src/server.js`; `npm start` and `npm run dev` build automatically before starting. Rebuild after browser source edits. Run `npm test`, `npm run check`, and `npm run test:browser` (Chromium required; `CHROMIUM` overrides its path). Browser tests build first and update screenshots in `docs/screenshots/`. `npm run check` recursively checks source syntax. Dependency versions are locked: Tiptap/Yjs for rich editing, Mammoth for browser import, `docx` for export, `fflate` for ZIP limits, `buffer`/`lib0` for browser and binary support, and esbuild for build-time bundling. The Docker build installs development dependencies to build assets, then prunes them for runtime.

Upstream references: [Tiptap collaboration](https://tiptap.dev/docs/editor/extensions/functionality/collaboration), [Yjs](https://docs.yjs.dev/), [Mammoth conversion and security](https://github.com/mwilliamson/mammoth.js), and [docx generation](https://docx.js.org/). DocDoc implements the subset and limits above; upstream library support does not imply additional format compatibility.
