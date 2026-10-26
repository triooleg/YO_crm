# Checkout 5.1.8 payload source fixture

`checkout-v518-source.php` contains the exact original PHP class used to create
`checkout-v518.json`, SHA256
`381d1aa2dd3a7d3a92eb321ff8d7208a7c9ba711cf28ba9b027f7aeaafc339d3`.
It is test-only, never imported by CRM runtime or executed through WordPress.

The original source was an untracked file in the neighboring CheckoutV2 project.
That working file subsequently advanced to a different protocol implementation;
reading it through an absolute workstation path made unrelated CRM checks change
without a CRM diff. The original class was recovered from its previously captured
tool output; line-ending reconstruction was accepted only after the complete
11,109-byte file matched the original oracle's SHA256 exactly. No expected payload,
PHP harness, source hash or production plugin code was changed.

Tests execute only `build_payload` with the existing synthetic WordPress boundary
stubs and compare all five full payloads. Missing/corrupt checked-in source fails
even if PHP is unavailable. PHP execution alone retains the pre-existing explicit
skip policy when the executable is unavailable. These checks certify the pinned
5.1.8 builder, not the newer sibling project, installed WordPress or live delivery.
