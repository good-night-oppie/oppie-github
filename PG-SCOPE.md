# PG explicit authorization candidate

Only alias pg / App5665944 / installation179806482 is changed. Installation metadata must exactly match the six observed selected repository IDs: MontClip1441621868, MontClip-Cindy1446532339, montclip-rsi1450602468, rsi-playbooks1450603260, oppie-github1451885379, sglang-review-inbox1451900929. This observation is NOT authorization to operate all six.

PG execution allowlist and its execution token are exactly four: original MontClip/MontClip-Cindy plus oppie-github/sglang-review-inbox. PG has Administration write only through the existing bounded admin_get/admin_update operations (merge-method flags/delete-branch-on-merge), not arbitrary admin API routes. montclip-rsi/rsi-playbooks are rejected before reading credentials. Other accounts, including QQ and ReviewInbox, retain their original two-repository sets and gates.

Identity returns repositories (four executable) and installationRepositories (six observed) separately. Metadata-only probe is used to verify installation scope; the execution token is explicitly narrowed. Unknown/missing/wrong-ID repositories fail closed.

The legacy encrypted credential-envelope metadata is retained unchanged to preserve existing DPAPI/SecretService readability. Its historical admin/repository fields are not the live authorization source; core verifies current pinned App/install, permissions, repository sets and scoped execution token. No key is re-encrypted or copied.

Validation: new positive PG token-scope test failed before implementation; full76/76 pass after. Negative tests deny the two installation-only repos, other-account access to new repos, unexpected install/execution scopes and wrong repository IDs. Candidate live read-only identity authenticated pgoppiexyz and independently verified six installation repos plus four execution repos and Administration write. No admin mutation performed.

This branch is independent of Draft COMMENT PR#1 and managed Inbox PR#2. It is not installed; those candidates require deliberate integration and QQ review before release. Rebuilding the bundled ReviewInbox CLI changes its hash; the Inbox adapter pin must be jointly revalidated before any installation. This change does not grant ReviewInbox/other aliases PG permissions.
