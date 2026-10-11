# SPECTRA institutional city field benchmark — 2026-10-10

## Scope and independently verifiable ground truth

This benchmark uses **public institutional and venue addresses only**, never
person or device locations. Each independently identified institution has an
official public source and a separately operated public source. URLs were
manually reviewed using public web retrieval on **2026-10-10**; that date is
the *research/retrieval date*, not each page's publication date.

| Venue / ground truth (municipal city only) | Owner/institution source | Independent source | Publication date on page |
| --- | --- | --- | --- |
| Boston Public Library, Central Library — **Boston, MA** (700 Boylston St.) | https://www.bpl.org/locations/central/ | https://content.boston.gov/departments/boston-public-library | Neither page exposed a reliably verified publication date for its current address |
| Wisconsin Historical Society headquarters — **Madison, WI** (816 State St.) | https://legacy.wisconsinhistory.org/ | https://www.visitmadison.com/listings/wisconsin-historical-society/181825/ | The archived institutional website expressly says updates stopped **2026-04-13**; this is a last-edit limit, **not** a publication date. The tourism listing did not expose a verified publication date. |
| Seattle Public Library, Central Library — **Seattle, WA** (1000 Fourth Ave.) | https://www.spl.org/hours-and-locations/central-library | https://www.visitseattle.org/things-to-do/sightseeing/modern-wonders/ | No verified publication date for either venue listing. The tourism article gives the street address but does **not** itself give a city/state postal address beside that listing; this tests **abstention** on incomplete evidence. |

Ground truth was adjudicated independently of model predictions by matching the
building name and **same street address** across institution and separately
operated destination/public-agency sources. These facts describe **buildings**,
not their occupants' or visitors' current physical city. Publication status
must remain `undated` where the page does not establish it. A page accessed
today is not automatically current.

## Reproducible, read-only live execution

Run `npm run verify:spectra:public-city-field` on a networked checkout. The
script fetches only six listed, publicly accessible institutional pages through
the production SPECTRA public retrieval function, logs requested URL, final
redirected URL, retrieval timestamp, source publication timestamp if available,
postal-city candidate, and abstention reason. It does not accept a personal
name, private location, credentials, provider endpoint or phone number.

Pass conditions are conservative: require two **different publishers** with
the venue name and unambiguous matching city/state postal addresses;
otherwise report `abstained`. Wrong-city predictions fail the run. A run
without a single supported prediction is `inconclusive`, not a pass. Direct
venue-address claims, public residence assertions, employer/office addresses,
user search clues, and authenticated opted-in device observations remain
different evidence classes.

Negative controls: removing one publisher must cause abstention; pairing
venues in contradictory cities must cause abstention; an undated webpage must
not acquire a fake publication date from its retrieval timestamp; a public
venue geotag must never be promoted to an individual GPS observation.

## Verified observations and limitations

The external web retrieval review on **2026-10-10** found address agreement
for all three institutions. This is **manual independent verification of the
benchmark oracle**, **not** an execution or success result of the SPECTRA
production retrieval/inference code. In particular, web search being able to
read a URL does not establish that Railway's bounded direct GET can retrieve
it, nor that the present HTML excerpt includes a uniquely parsable postal
city. Do not report site-pair success rates until an actual recorded live
benchmark run is available.

Real-world **person-current-city accuracy remains unverified**. To validate
that separately, the system owner must onboard an authorized opt-in source
(e.g. a managed Android/Apple MDM or Cisco Spaces device-location provider,
or a consented equivalent) with the corresponding `SPECTRA_*` endpoint and
credential configuration, documented lawful authority, consent, timestamped
device-to-subject binding, revocation and independently established *current*
city ground truth. As checked in the Bad-Blue **production** service
configuration on **2026-10-10**, there were no variable names beginning
`SPECTRA_`; web citations cannot substitute for an authorized provider.

This benchmark cannot validate real-world person-location accuracy or sub-city
positioning, and must never be represented as doing so.
