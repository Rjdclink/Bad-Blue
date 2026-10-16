# ISB — Iron Smart Bubble: passive observer foundation

This is an **unconnected, out-of-path, non-enforcing foundation**, NOT a deployed firewall or complete protection system. It accepts already-sanitized HTTP metadata when invoked by a separate telemetry reader and returns only `scope`, `level`, and the constant `action: observe`. It never sees or needs request bodies, passwords, cookies, session tokens, IP addresses, or merchant payloads. It does not open ports, intercept requests, or modify LegalWhat.

Both `legalwhat.com` and `bad-blue-production.up.railway.app` are in one observation scope. Signups, logins (including repeated wrong passwords), and Square webhook paths never produce a security finding *on that basis alone*. Basic suspicious path probes are flagged passively for operator review, never blocked.

Run: `node --test isb/observer.test.cjs`.

## Activation gate

Do not connect this observer to live traffic until a **separate, passive metadata exporter** can be integrated, proven to never carry secret values or delay/alter requests, and validated against real signup, login, free trial, payments, Square callbacks, Lexara, and Spectra. Do not block or redirect traffic. Do not alter DNS, routing, or the Railway service. A telemetry export failure must not affect LegalWhat.

This simple observer is not a general WAF, moving-target defense, or sufficient protection against sophisticated threats. Further phases require threat-model review and actual end-to-end testing.
