# Workstation transfer pulls completed archives with a paired read-only credential

The owner requested manual and automatic saving to `D:\YO_CRM_Backups`. A browser
cannot reliably save unattended to a fixed Windows folder after it closes, so an
explicitly installed user-level Windows helper pulls the existing verified archives;
it never creates another backup. Pairing requires an administrator's fresh password,
uses a revocable expiring credential limited to archive reads, and protects that
credential with the Windows user's DPAPI instead of storing the CRM password.

Manual is the default. Changing the CRM selection does not install software or
activate a Windows task. The local installer is an explicit operator action after
deployment approval. No computer agent, production setting or scheduled task is
activated during development. A transfer checksum and a restore drill remain
separate forms of evidence.
