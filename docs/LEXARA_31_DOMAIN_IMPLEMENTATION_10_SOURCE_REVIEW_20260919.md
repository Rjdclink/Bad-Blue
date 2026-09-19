# LEXARA 31-Domain Expertise — 10-Source Implementation Review

Date: 2026-09-19

## Sources — exactly 10

1. React — Sharing State Between Components — https://react.dev/learn/sharing-state-between-components
2. TypeScript Handbook — Narrowing and Exhaustiveness — https://www.typescriptlang.org/docs/handbook/2/narrowing
3. Supabase — Database Migrations — https://supabase.com/docs/guides/deployment/database-migrations
4. Supabase — Row Level Security — https://supabase.com/docs/guides/database/postgres/row-level-security
5. MDN — ARIA Live Regions — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
6. MDN — AbortController.abort() — https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort
7. OWASP — LLM Prompt Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
8. PostgreSQL — Constraints — https://www.postgresql.org/docs/current/ddl-constraints.html
9. web.dev — Code-split JavaScript — https://web.dev/learn/performance/code-split-javascript
10. W3C WAI — WCAG 2.2 Understanding Target Size (Minimum) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum

## Implementation decisions

- Keep one product law-type authority (LAW_TYPES / LAW_TYPE_DATA) rather than duplicating category state in the client, server, and database.
- Make the specialist registry compile-time exhaustive with satisfies Record<LawType, LexaraLegalDomainProfile> so a future book cannot silently ship without a profile.
- Keep the large expertise payload server-only so adding 31 profiles does not increase the client bundle or bookshelf interaction latency.
- Preserve the current AbortController cancellation and bounded authority-research behavior; specialization enriches the query without adding a blocking provider.
- Continue treating retrieved web/source text as untrusted evidence under LEXARA's existing trust boundary.
- Reuse the existing bookshelf BookSpine component. Adding Post Conviction through LAW_TYPE_DATA gives the new book identical layout, focus, touch, hover, and responsive behavior instead of creating a one-off visual path.
- Keep the opening greeting in the existing conversation message path so the same exact string is rendered and spoken; no duplicate greeting source is introduced.
- Do not add a mandatory Supabase dependency for practice profiles. Supabase inspection is currently timing out and production logs show database/auth degradation; making specialization database-dependent would increase regression risk. A future database override can be introduced only as an optional, versioned, validated layer.
- Keep Post Conviction as a first-class product law type rather than aliasing it to generic criminal or appellate law.
- Build verification must assert the 31-book count, exact greeting, all-books-to-LEXARA routing, exhaustive profile coverage, Post Conviction minimum doctrine map, and selected-profile research wiring.
