# LEXARA 31-Domain Expertise — 40-Source Legal Review

Date: 2026-09-19

## Objective

Cross-reference LegalWhat's 31 bookshelf practice areas against current high-authority legal research sources before implementing the selected-book specialization layer. The implementation deliberately treats these sources as research maps rather than frozen statements of controlling law: LEXARA must still resolve jurisdiction, search current authority, distinguish primary from secondary material, and verify deadlines/citations at answer time.

## Sources — exactly 40

1. U.S. Courts — Rules Governing Section 2254 and Section 2255 Proceedings — https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/rules-governing-section-2254-and-section-2255-proceedings
2. U.S. House, Office of the Law Revision Counsel — 28 U.S.C. § 2244 — https://uscode.house.gov/view.xhtml?edition=prelim&req=granuleid%3AUSC-prelim-title28-section2244
3. U.S. House, Office of the Law Revision Counsel — 28 U.S.C. § 2254 — https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title28-section2254
4. U.S. House, Office of the Law Revision Counsel — 28 U.S.C. § 2255 — https://uscode.house.gov/view.xhtml?req=%28title%3A28+section%3A2255+edition%3Aprelim%29
5. U.S. Supreme Court — McQuiggin v. Perkins, 569 U.S. 383 (bound volume) — https://www.supremecourt.gov/opinions/boundvolumes/569bv.pdf
6. U.S. Supreme Court — 2022 federal habeas evidentiary-development opinion, official opinion PDF — https://www.supremecourt.gov/opinions/21pdf/596us1r32_e29g.pdf
7. U.S. Courts — Federal Rules of Appellate Procedure — https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-appellate-procedure
8. U.S. Courts — Federal Rules of Civil Procedure — https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-civil-procedure
9. U.S. Courts — Federal Rules of Criminal Procedure — https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-criminal-procedure
10. U.S. Courts — Federal Rules of Evidence — https://www.uscourts.gov/forms-rules/current-rules-practice-procedure/federal-rules-evidence
11. Congress.gov Constitution Annotated — https://constitution.congress.gov/
12. DOJ EOIR — EOIR Policy Manual — https://www.justice.gov/eoir/policy-manual-eoir
13. DOJ EOIR — Immigration Court Practice Manual, Scope — https://www.justice.gov/eoir/policy-manual-eoir/part-II/icpm/chapter-1-1
14. DOJ EOIR — Immigration Court Jurisdiction and Authority — https://www.justice.gov/eoir/policy-manual-eoir/part-II/icpm/chapter-1-4
15. DOJ Office of Information Policy — DOJ Guide to the Freedom of Information Act — https://www.justice.gov/oip/doj-guide-freedom-information-act-0
16. DOJ Office of Information Policy — OIP Guidance — https://www.justice.gov/oip/oip-guidance
17. EEOC — Filing a Charge of Discrimination — https://www.eeoc.gov/filing-charge-discrimination
18. EEOC — Time Limits for Filing a Charge — https://www.eeoc.gov/time-limits-filing-charge
19. U.S. Department of Labor — Fact Sheet #28: FMLA — https://www.dol.gov/agencies/whd/fact-sheets/28-fmla
20. U.S. Department of Labor — Fact Sheet #13: FLSA Employment Relationship — https://www.dol.gov/agencies/whd/fact-sheets/13-flsa-employment-relationship
21. National Labor Relations Board — National Labor Relations Act — https://www.nlrb.gov/guidance/key-reference-materials/national-labor-relations-act
22. HUD — Housing Discrimination Under the Fair Housing Act — https://www.hud.gov/helping-americans/fair-housing-act-overview
23. ADA.gov / DOJ — Law, Regulations & Standards — https://www.ada.gov/law-and-regs/
24. ADA.gov / DOJ — Americans with Disabilities Act, as amended — https://www.ada.gov/law-and-regs/ada/
25. U.S. Department of Veterans Affairs — Decision Reviews and Appeals — https://www.va.gov/decision-reviews/
26. U.S. Department of Veterans Affairs — Board Appeal, VA Form 10182 — https://www.va.gov/find-forms/about-form-10182/
27. Internal Revenue Service — Taxpayer Bill of Rights — https://www.irs.gov/taxpayer-bill-of-rights
28. U.S. Patent and Trademark Office — Patent Basics — https://www.uspto.gov/patents/basics
29. U.S. Patent and Trademark Office — IP Basics and Toolkits — https://www.uspto.gov/learning-and-resources/inventors-and-entrepreneurs/ip-basic-toolkits
30. U.S. Copyright Office — What Is Copyright? — https://www.copyright.gov/what-is-copyright/
31. U.S. Securities and Exchange Commission — Rules and Regulations — https://www.sec.gov/rules-regulations
32. Consumer Financial Protection Bureau — Regulation X, 12 CFR Part 1024 — https://www.consumerfinance.gov/rules-policy/regulations/1024/
33. Consumer Financial Protection Bureau — Regulation Z, 12 CFR Part 1026 — https://www.consumerfinance.gov/rules-policy/regulations/1026/
34. Federal Trade Commission — Data Security Guidance — https://www.ftc.gov/business-guidance/privacy-security/data-security
35. U.S. Environmental Protection Agency — Laws and Regulations — https://www.epa.gov/laws-regulations
36. U.S. Environmental Protection Agency — Superfund/CERCLA Overview — https://www.epa.gov/superfund/superfund-cercla-overview
37. U.S. Environmental Protection Agency — Resource Conservation and Recovery Act (RCRA) — https://www.epa.gov/rcra
38. U.S. Citizenship and Immigration Services — Policy Manual — https://www.uscis.gov/policy-manual
39. U.S. Courts — Current Rules of Practice & Procedure — https://www.uscourts.gov/forms-rules/current-rules-practice-procedure
40. U.S. Tax Court — Rules of Practice and Procedure — https://www.ustaxcourt.gov/rules.html

## Cross-source findings adopted

- A bookshelf label is not enough to create legal specialization. Each selected domain needs its own issue-spotting map, procedure/deadline focus, authority hierarchy, jurisdiction questions, remedies, adjacent-domain triggers, and search vocabulary.
- Primary authority must remain superior to static prompt knowledge. The specialization layer therefore guides retrieval and reasoning but never substitutes for current controlling authority.
- High-consequence domains need explicit procedural posture. Post Conviction must first distinguish state versus federal conviction, direct review versus collateral review, judgment finality, custody/status, earlier collateral filings, exhaustion/default, AEDPA timing, successive-application rules, and the appropriate § 2254/§ 2255 path.
- Practice areas overlap. Domain selection should establish the specialist center of gravity without suppressing adjacent issues such as constitutional, procedural, appellate, tax, insurance, administrative, or federal/state overlays.
- Deadlines are jurisdiction- and posture-sensitive. LEXARA must not manufacture a deadline from a generic profile.
- Agency manuals and guidance are useful for procedure and research targeting, but must not be elevated above statutes, regulations, or controlling judicial authority.

## Repo/production resolution

The existing architecture already had a latency-bounded authority-research path and a separate Harmony reasoning path. The lowest-regression implementation is therefore a server-only, compile-time exhaustive domain registry keyed by the existing product law-type authority, then passing the selected profile into both the legal system prompt and the existing authority-research query. No new external provider or database becomes mandatory.
