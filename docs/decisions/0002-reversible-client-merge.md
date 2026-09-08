---
status: accepted
---

# Record merge provenance before allowing client separation

A client merge moves conversations and business relations into one canonical
card. Reconstructing their former owner later from names, timestamps or channel
labels is unsafe. Each new merge therefore stores an immutable operation with
the source and target client snapshots, exact identifiers of relations moved,
and any AI settings removed by deduplication. Separation restores only recorded
ownership and conditionally restores copied target fields when they have not
been edited since the merge. A changed target `updatedAt` is treated as an
operator edit even if a field later returns to the merge-produced value. Later records with ambiguous ownership remain on
the canonical client, so no order or business history is moved by guesswork.
Records tied to an exactly restored conversation follow that conversation; its
provider identity is sufficient ownership evidence. Conversation-owned writes
are serialized with merge and separation in PostgreSQL, lock the referenced
conversation, and derive `clientId` from its current owner. The conversation is
moved before its dependent records inside merge/separation transactions. This
prevents a writer that began against the canonical card from committing a stale
owner after the conversation has been restored. A later canonical order
that references a restored athlete blocks separation to preserve the invariant
that the client owns every athlete and measurement used by its orders.

Redirects created before operation provenance existed can be separated only by
channels recorded in the durable `CLIENTS_MERGED` activity at merge time; source
profile hints are not accepted as ownership evidence. Ambiguous legacy chains
remain blocked. The UI must label this as a limited separation before
confirmation.

Merge chains are unwound strictly in reverse order. For `A → B → C`, `B` must
first be separated from `C`; only then can `A` be separated from `B`. The
immutable merge operation and audit history remain after routing is returned to
the source client. Database constraints preserve the actor references, and a
trigger permits only the one-way `splitAt`/`splitById` transition while rejecting
mutation or deletion of provenance.
