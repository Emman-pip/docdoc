# DocDoc Application Plan

## Goal and Working Assumptions

Build an offline office application where users keep local document copies and collaborate with selected people over a LAN. The first version targets a web-based application with collaborative text documents and a maximum of five users collaborating on a document at once, including its owner. The implementation uses a Node.js host and browser client; team size and delivery schedule remain open decisions.

Web-based deployment, text documents before spreadsheets, and the five-user collaboration limit are confirmed priorities. The implemented architecture uses one host per collaboration session.

## MVP User Experience

1. Choose Markdown (default) or DOCX, then create, open, rename, and delete a local document.
2. Edit paragraphs, headings, lists, and basic formatting without a network.
3. Save automatically and reopen after restarting the application.
4. Open the application in a browser through a LAN host and invite selected collaborators.
5. Show connection status, connected collaborators, and available places within the five-user limit.
6. Merge concurrent edits and synchronize after a temporary disconnection.
7. Export Markdown or the supported DOCX subset; import DOCX locally in the browser.

Defer full Word/Excel compatibility, advanced layout, cloud accounts, internet collaboration, and complex spreadsheet formulas. Define supported import/export formats explicitly; office-file compatibility is a separate feature, not implied by an editor UI.

## Architecture

- **Web application:** serves the browser interface from a self-hosted LAN server. Cache the application for offline use after initial setup; validate browser support and secure-origin requirements in the prototype.
- **Editor:** presents document content and applies local edits.
- **Document model:** uses a CRDT for collaborative content; keeps session state separate from persisted content.
- **Local persistence:** stores document metadata, snapshots, and incremental updates in browser storage. Confirms successful persistence before reporting a document as saved. Provide export/backup because clearing browser data can remove local copies.
- **Collaboration transport:** exchanges updates with authorized session participants. Starts with a manually entered host address or invitation; automatic LAN discovery can follow.
- **Session host:** a LAN server admits participants, relays updates, and provides catch-up synchronization. Enforce a maximum of five active users per document on the server, including its owner. Each participant retains a browser-local copy.

A host-based session limits initial networking complexity. If the LAN server becomes unavailable, local editing continues, but collaboration pauses until it returns. Host migration and direct peer synchronization require a later design decision.

## Sharing and Access Rules

Treat LAN discovery as discovery, not authorization. Require explicit invitations and validate access before sending document content. Define whether participants can edit or only view. Count both toward the five-user limit. Reject a sixth user with a clear session-full message. Count users rather than browser tabs; define a reconnect grace period and release inactive slots after it expires.

For the MVP, scope edit permission to trusted collaborators. Define how previously authorized offline edits are treated after access changes before implementing revocation. Removing a participant cannot erase copies they already received.

## Delivery Milestones

| Milestone | Deliverable | Exit criteria |
| --- | --- | --- |
| 1. Collaboration prototype | Two editor instances, local persistence, update exchange | Concurrent edits converge; restart preserves content; reconnection catches up |
| 2. Offline editor | Document list, basic formatting, autosave, export | Core editing works with networking disabled; interrupted writes do not corrupt saved content |
| 3. LAN sessions | Browser host/join flow, invitations, presence, five-user limit | Five users synchronize; a sixth is rejected; unauthorized participants receive no document data |
| 4. Resilience | Recovery, backups, large-document checks | Duplicate and reordered updates converge; host interruptions preserve local edits |
| 5. Spreadsheet prototype | Cell editing and a small formula subset | Stable row/column identity; defined concurrent-cell behavior; deterministic formula results |

Estimate dates after milestone 1 establishes editor integration and synchronization complexity.

## Validation Strategy

Test up to five browser users editing the same content, delayed and duplicate updates, disconnections, application crashes, and restarts. Compare resulting document state across clients after synchronization. Add integration checks for invitations and unauthorized access, plus manual LAN testing in supported browsers. Verify simultaneous join requests cannot exceed five users, multiple tabs do not consume extra user slots, and expired sessions release capacity. Test offline loading after initial setup and recovery from browser storage failures.

For spreadsheets, decide whether concurrent edits to a cell resolve to one value or expose a conflict. Test references after row/column insertion and deletion. Formula calculation and import/export need their own compatibility specifications.

## Remaining Product Decisions

- Supported browsers and LAN server deployment.
- Supported document size.
- User identity and reconnect grace period for enforcing the five-user limit.
- Whether collaboration must continue when the original host leaves.
- Required file formats and the acceptable level of fidelity.
- Preferred stack, team capacity, and delivery constraints.

## Next Action

Broaden browser/LAN validation of the delivered Markdown and DOCX editors. Define spreadsheet identity and formula semantics before beginning a spreadsheet prototype.

## Implemented First Version

The repository now contains a Node.js host and browser document workspace with locked npm dependencies. It supports local document management, Markdown shortcuts and preview, optional Vim bindings, uploaded photo previews, local autosave, export, invitation links, CRDT synchronization, presence, and a five-user limit per document. Polling exchanges full document state every two seconds; inactive participant slots expire after 15 seconds.

Markdown retains the small character CRDT. DOCX uses Tiptap with Yjs for paragraphs, headings, lists, bold, italic, links, and images. Browser-local copies use local storage, while shared snapshots persist on the host. Offline page reloads use a service worker on localhost or HTTPS. Plain HTTP LAN connections retain offline editing only in an already-open page.

Remaining product work includes authenticated identities, revocable invitations, view-only access, advanced document layout, spreadsheet support, and broader browser/LAN validation. Full-state synchronization is capped at 2 MB of serialized history; incremental transport and more scalable storage are future improvements.

Optional Vim bindings are a browser preference and share the existing text edit/undo path. Uploaded raster photos are compressed and stored as immutable attachments in document snapshots, with Markdown references for placement. Attachments merge across replicas and are included in exports; they count toward the document size limit.

File-sharing mode now provides per-document session uploads and downloads through the existing invitation, with a shared five-user admission limit. File bytes persist separately on the host (1 GiB per file and per session, up to 1,000 files and 5,000 folders) and require an online host. Vim now opens in Insert mode with visible mode controls above the editor.

The interface now follows the system light/dark theme. The Markdown editor expands to show the entire document, with scrolling at page level. All Vim modes draw a solid, nonblinking caret, and Visual mode retains its selection highlight. Shared files display the original uploader’s name and connection IP, captured at upload and preserved with the file metadata. Stable short invitation codes (for example, `xyz-jnk-dvc`) support compact links and manual joining on the same LAN host; legacy invitation links remain supported.

Session owners can now enable an any-match whitelist of exact IP addresses, case-insensitive self-declared usernames, or host-detected MAC addresses. Rules are enforced for joining, synchronization, and file transfers and persist across restarts. A separate private owner key controls settings. MAC detection uses Linux IPv4 ARP entries; unavailable MACs do not match. Authenticated usernames remain future work.

## Collaborative DOCX Delivery

New document offers Markdown and DOCX; the first-run starter and legacy records remain Markdown. Document kinds persist in local records and host snapshots and cannot change during synchronization. Type-specific state validation preserves Markdown's wire format and uses Yjs encoded updates for rich content. Existing invitations, selected-user access policy, five-user admission, reconnect/restart behavior, title editing, autosave, deletion, and shared files apply to both formats.

DOCX parsing (Mammoth) and generation (`docx`) run in the browser, with bundled offline assets. The supported subset is semantic paragraphs, headings, lists, bold, italic, hyperlinks, and embedded raster images. Tables flatten; page layout, fonts, headers/footers, comments, tracked changes, and advanced Word content may be simplified or omitted. Custom numbering and image layout may change. Failed imports retain existing contents. The README documents archive, image, state, and browser-storage limits. Full Word compatibility remains deferred.

The code is organized by feature and runtime under `public/features/`, `public/shared/`, and `src/features/`, with feature tests and shared fixtures. esbuild produces browser bundles and the offline cache manifest; Node 20+ and `npm ci` are required. Automated verification covers both CRDTs, concurrent rich formatting/images, duplicated/reordered updates, host persistence, access and capacity, conversion, and browser offline behavior.
