Work in progress, NOT wired into the app.

A record-based general statement reader, profiled against 22 real statements.
Reconciles exactly on 5 of 22; the shipped generic parser manages 0-1 rows on
the same files. See ../STATEMENT-PATTERNS.md for the findings and what is left.

Do not ship this without re-running it against a real corpus - it produces
confident-looking rows whose signs are wrong on busy checking statements.
