# Ghost signed-intent production status

The signed-intent/coincidence-of-wants implementation remains source-available but is **not an active production capital primitive** until durable open-intent storage and an external registration surface are wired through Overflow.

Production invariants:
- no execution path may depend on process-memory-only intent state;
- no capability manifest may advertise signed-intent capital as production-ready;
- caller-funded flash/intermediation, configured delegated credit, and verified vault capital remain independent alternatives;
- enabling signed intents later requires durable Overflow persistence, restart recovery, nonce reconciliation, and behavior tests before advertising the capability.
