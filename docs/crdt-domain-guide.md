# CRDT Domain Guide for DocDoc

This guide explains the ideas needed to reason about DocDoc's collaborative text model. It focuses on the concrete implementation in `public/crdt.js`; it is not a general CRDT catalog.

## The problem CRDTs solve

Two people can edit local copies while disconnected. If both copies later synchronize, the system needs a deterministic result without discarding either person's operations. A CRDT (Conflict-free Replicated Data Type) is a data structure whose operations can be merged so replicas converge, provided replicas follow the operation rules.

DocDoc uses a **state-based** CRDT: clients exchange snapshots containing accumulated state. It does not transmit a durable stream of individual operations. Repeatedly exchanging the same state is safe because merge is idempotent.

## The replicated sequence

Imagine the visible text `CAT`. Its characters are nodes linked by insertion ancestry:

```text
root -> C -> A -> T
```

Each character gets a permanent ID such as `tab-a:41`. Inserting `X` between `A` and `T` creates a new node whose `after` points at `A`; it does not change or renumber `T`. This is the central design choice: edits add facts, and deletion adds a fact that an existing node is hidden.

### Why stable IDs matter

Numeric offsets are unstable under concurrent insertions. “Insert at position 3” can mean different things after another user inserts text before position 3. A stable parent ID says which observed character the new character follows, so later edits can still refer to the same element.

### Concurrent insertion example

Suppose replicas A and B both see `AB` and independently insert at the gap after `A`:

```text
A: inserts x after node A  -> sibling (clock 8, actor A)
B: inserts y after node A  -> sibling (clock 8, actor B)
```

Neither insertion overwrites the other. Both nodes are children of the same parent. The implementation sorts siblings by clock and actor in a fixed descending order, then traverses the sequence. Both replicas render the same order, for example `AxyB` or `AyxB` depending on actor ordering. The chosen order is deterministic; preserving a user's inferred cursor intent is a separate quality concern.

## Tombstones and deletion

Deleting a character adds its ID to `deleted`. It does not physically remove its node. This is necessary because another user may have concurrently inserted a child after that character. The deleted parent is hidden, but traversal still reaches its descendants:

```text
Before: A -> B -> C
Other replica inserts x after B: A -> B -> x -> C
Deletion of B: B hidden; x and C remain traversable
Visible result: A x C
```

Tombstones are grow-only so a delayed snapshot cannot “undelete” a character. The cost is unbounded historical state growth. A safe compaction policy would need to know that no offline replica can later reintroduce references to discarded nodes; DocDoc does not yet have that acknowledgement protocol.

## How DocDoc maps editor changes

The browser editor supplies a new complete string. The CRDT compares old and new text, retains the longest unchanged prefix and suffix, tombstones the old changed middle, and inserts the new changed middle after the retained prefix. This makes ordinary typing efficient enough for small documents while keeping the editor a simple textarea-like control.

This is not an operation-aware text editor. A large paste or rewrite can tombstone many nodes. Formatting syntax is plain text; Markdown preview is derived from the string, not a separate replicated rich-text structure.

## Merge properties in practice

For well-formed, non-conflicting state:

- **Commutative:** A merged with B and B merged with A yield equivalent content.
- **Associative:** grouping multiple merges does not change the result.
- **Idempotent:** merging the same snapshot twice does not duplicate characters.

Node maps and deletion sets are combined by union. Images are combined by ID, with rejection if the same ID carries different data. The title chooses the maximum `(Lamport clock, actor)` pair. This is why duplicates and reordering are tolerated, and why a client can be offline while other replicas continue.

These properties assume unique actor/clock IDs and valid operations. A malformed or conflicting payload is rejected. CRDT convergence does not mean every merge is semantically desirable: two different title edits resolve to one title, while two body insertions both survive.

## Lamport clocks

A Lamport clock is a logical counter, not a timestamp in seconds. Before creating a new insertion or title operation, a replica increments its counter. When it observes remote state, it raises its counter to at least the largest counter it has seen. A subsequent local operation therefore sorts after observed operations by clock.

Two replicas can produce the same clock value concurrently. The actor ID is the deterministic tie-breaker. Wall-clock skew does not affect ordering.

## What is and is not a CRDT here

| Feature | Model | Consequence |
| --- | --- | --- |
| Body text | RGA-style immutable character nodes plus tombstones | Concurrent insertions survive; deletions hide observed nodes |
| Title | Last-writer-wins register `(clock, actor)` | One concurrent rename wins deterministically |
| Photos | Grow-only map by image ID | Duplicate delivery is safe; conflicting data under one ID fails |
| Markdown formatting | Plain characters and syntax | No independently mergeable rich-text marks |
| File/folder workspace | Host-side metadata and bytes | Not available as offline replicated content |

## Synchronization loop

Every roughly two seconds, a connected browser posts its full snapshot. The host merges it with the durable room snapshot and returns the merged state. The browser merges that response and saves locally. Reconnect runs the same merge cycle, so it is also a catch-up mechanism. Because full snapshots include history, the request size is governed by tombstones and image bytes as well as visible text.

The server applies invitation and policy checks before sending document state, enforces active-user admission, checks the 2 MiB serialized state limit, and persists changed state atomically. The CRDT itself handles content merge; the server handles authority, routing, durability, and admission.

## Failure and threat cases

- **Duplicate snapshot:** harmless due to set/map union and deterministic register selection.
- **Reordered snapshot:** missing parents remain stored; nodes become visible when ancestors arrive.
- **Temporary disconnection:** local edits remain in local storage and merge on reconnection.
- **Simultaneous delete and insert after target:** deleted parent stays hidden while descendants remain in traversal.
- **Concurrent renames:** one title wins using the logical clock and actor tie-breaker.
- **Actor ID collision:** distinct operations can claim one ID; differing payloads are rejected as a conflict.
- **Large history:** tombstones are not compacted; sync/storage limits can eventually be reached.
- **Untrusted collaborator:** a valid invitation grants edit capability; this is not a hostile multi-tenant system with authenticated identities.

## Useful invariants when changing the model

1. A node ID uniquely identifies immutable content and its insertion parent.
2. Deletion is monotonic; a snapshot cannot erase an observed tombstone.
3. Every replica traverses siblings with the same total order.
4. Merge validates before accepting state and is safe to repeat.
5. Edits made while disconnected remain representable and merge later.
6. Any change to the serialized shape must preserve old snapshot loading or include an explicit migration.
7. Storage limits must account for hidden history, not only rendered text.

When changing ordering, edit translation, snapshot validation, or merge semantics, update tests for concurrent insertion, concurrent deletion, duplicate delivery, reordered delivery, reload from snapshot, malformed state, and deterministic title selection.
