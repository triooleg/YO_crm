---
status: accepted
---

# Keep merged client identities through a durable redirect

When an operator merges duplicate clients, the source card stays archived and
all business relations move transactionally to the selected canonical client.
We store a durable source-to-target redirect instead of squeezing every old
identity into the canonical card's single-value contact fields: this preserves
inbound routing for old phone, e-mail and social identities without reactivating
the duplicate. Redirect chains are flattened during later merges. An exclusive
merge window and shared inbound window keep a complete redirect chain stable
while a webhook is persisted. Database triggers serialize direct client-owned
writes with the source row and route late inserts to the final canonical client;
once redirected, the archived source is immutable. This protects writes from
older code paths that did not participate in the advisory-lock protocol. The
table and triggers are additive, but an application rollback after real merges
requires the pre-deploy backup because versions before 0.1.9 do not follow these
redirects.
