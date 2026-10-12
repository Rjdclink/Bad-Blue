# LegalWhat Android / Google Play (Trusted Web Activity)

This directory documents the **production-only** Android release path for https://legalwhat.com/. The Android app is a Trusted Web Activity (TWA) created from the existing Progressive Web App (PWA); LegalWhat's web features remain hosted by Railway.

## Prerequisites and verification

1. Serve `https://legalwhat.com/manifest.json` successfully from production and confirm the referenced icon file is a real square PNG, with **192x192 and 512x512 PNG versions**, ideally including a maskable variant. Do not invent icon sizes in the manifest. Update the manifest only after creating and verifying icon assets.
2. Verify HTTPS, mobile sign-in, audio input and output, uploads, document downloads, Lexara, Spectra, and navigation on real Android devices. Never cache legal documents, user sessions, or authenticated API replies in a PWA service worker.
3. Use a **Google Play developer account**, an Android signing key, and a unique application ID (suggestion: `com.legalwhat.app`; confirm available before release).
4. Review Google Play's **current Payments policy** before launch. The existing Square subscription flow must not be assumed compliant for Play-distributed digital subscriptions. Implement permitted in-app billing or an applicable authorized exception before publishing.
5. Prepare the Play listing, privacy policy, Data safety declaration, app access instructions for review, screenshots, content ratings, and required testing.

## Generate Android project (locally, not in Railway)

Install `@bubblewrap/cli` from the official Google Chrome tooling, then run:

```sh
npm install --global @bubblewrap/cli
bubblewrap init --manifest=https://legalwhat.com/manifest.json
bubblewrap build
```

Use production `https://legalwhat.com/` as the launch origin. Store signing keys **outside Git**. Build an Android App Bundle (.aab) for Google Play; verify the actual Bubblewrap CLI options for the version installed.

## Verify ownership (mandatory)

After Play App Signing is configured, obtain the **Play app signing certificate** SHA-256 fingerprint from Play Console. Create `https://legalwhat.com/.well-known/assetlinks.json` with the final application ID and the fingerprint:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.legalwhat.app",
    "sha256_cert_fingerprints": ["REPLACE_WITH_REAL_PLAY_APP_SIGNING_SHA256"]
  }
}]
```

**Never deploy this placeholder file.** Verify its fingerprint matches the real Play signing certificate; an upload-key fingerprint may differ. If ownership verification fails, Android opens a Custom Tab rather than an immersive TWA.

## Release guardrails

- No new Railway preview deployments; preserve the normal single-production-deployment workflow.
- Do not change the website's subscription or authentication code merely to package Android.
- Check current Google Play Android target API requirements and release format before submitting.
- Run end-to-end functional tests, manifest/Digital Asset Links verification, and regression checks before any production merge.
- Google Play publication is not automated by this repository change; developer account setup, final signing, and Play Console submission remain separately required.

References:
- https://developer.chrome.com/docs/android/trusted-web-activity/quick-start
- https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2
- https://support.google.com/googleplay/android-developer/answer/9858738
