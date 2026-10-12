# Criminal public-record retrieval

`POST /api/criminal-records` and Lexara's person-specific criminal-background questions share a bounded retrieval service. Existing Railway credentials are reused; no account registration or new API key is required. The retrieval path makes no Claude calls and never purchases PACER records.

## Retrieved information

- **CourtListener/RECAP:** searches archived federal criminal dockets through the existing `COURTLISTENER_API_TOKEN` and existing read-only client/cache; retrieves available case-specific filing text. Two search pages, eight case candidates, and three filing reads at most. Names and case metadata are candidate evidence, not established criminal history.
- **Federal Bureau of Prisons:** reads the public locator's structured custody response. Matching names remain unconfirmed; a supplied BOP number must match exactly. A supplied birth date rejects incompatible reported ages. BOP custody does not establish charges or a conviction.
- **Oklahoma OSCN:** uses the public search form, resolves a requested county from that form, and reads up to four accessible felony/misdemeanor case pages. Counts and dispositions are associated with the matching party's row; another party's outcome is not assigned to the searched person. Complete sentence information may require the court minute.
- **Official public pages:** uses existing Lexara search providers without model-based planning, then reads up to six accessible official pages through the existing retrieval boundary. Search snippets never become record findings. Retrieved prose is provided for review rather than converted into guessed convictions.

## Coverage and identity

`caseCandidates` and `custodyCandidates` hold retrieved source records with source URLs, retrieval dates, and explicit identity status. They are separate from the legacy arrays of established facts. The service does not claim a complete criminal history or confirmed identity from a name match.

`recordsDetermined` remains false and `coverageLimited` remains true. `coverage` distinguishes checked, partial, unavailable, not-configured, manual-required, and not-checked sources. `no_matches_in_checked_sources` describes a limited search, not a clear history.

Registry status and risk score are null when undetermined. No speculative risk score, active-warrant finding, arrest, or conviction is generated from an absent result.

The shared state directory covers all 50 states and DC. Curated public entry points and notes explain limitations in selected states; a directory link does not mean a person-level search was completed. Examples:

- Minnesota defendant-name searches omit pending criminal cases. The BCA offers a separate criminal-history route.
- South Dakota PARS guest searches require a birth date and charge $20 even if no record is found. This service makes no purchase.
- Indiana MyCase prohibits automated extraction; its approved data-access process is required.
- NSOPW has a public browser interface but no public search API. Registry status stays not checked.
- State DOC links and local-warrant routes are supplied as unsearched routes unless an actual record was retrieved.

## Input

```json
{
  "fullName": "Avery Morgan Example",
  "dateOfBirth": "1985-01-01",
  "state": "OK",
  "county": "Example",
  "docketNumber": "CF-2024-1234",
  "inmateNumber": "12345-678"
}
```

Only `fullName` is required. Request fields are bounded. Work runs only when requested; the shared deadline is 12 seconds, with provider-specific limits and cancellation. Positive candidate reports have a bounded three-minute process-local cache. Outages are not cached as negative records. Logs contain counts/statuses rather than names or birth dates.

## Source references reviewed October 12, 2026

- https://wiki.free.law/c/courtlistener/help/api/rest/v4/search
- https://pacer.uscourts.gov/file-case/developer-resources
- https://www.bop.gov/inmateloc/about_records.jsp
- https://www.oscn.net/dockets/Search.aspx
- https://www.nsopw.gov/faqs
- https://mncourts.gov/access-case-records/mcro/faqs
- https://ujspars.sd.gov/GuestSearch.aspx
- https://www.in.gov/courts/policies/tou-mycase/
- https://www.judyrecords.com/api

Commercial services requiring new onboarding or credentials were researched but are not added to the active retrieval path.
