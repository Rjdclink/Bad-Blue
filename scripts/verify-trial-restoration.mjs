import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getLegalWhatAccessState, LEGALWHAT_TRIAL_DURATION_MS } from "../server/trialAccess.ts";
import { isPaidAccessState } from "../shared/subscriptionPolicy.ts";
import { createSubscriptionGate } from "../server/subscriptionGate.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const read = f => readFileSync(resolve(root, f), "utf8");
const signup = read("client/src/pages/login.tsx");
const app = read("client/src/App.tsx");
const auth = read("server/auth.ts");
const gate = read("server/subscriptionGate.ts");
const trialPage = read("client/src/pages/trial-access.tsx");

assert.equal(LEGALWHAT_TRIAL_DURATION_MS, 259200000, "72-hour duration unchanged");
const t = Date.UTC(2026, 9, 1);
const active = {hasPaidForAccess:false,status:"active",trialStartedAt:new Date(t),trialExpiresAt:new Date(t+259200000),trialConsumedAt:new Date(t)};
assert.equal(getLegalWhatAccessState(active,t+1000),"trial_active");
assert.equal(getLegalWhatAccessState(active,t+259200000),"trial_expired");
assert.equal(getLegalWhatAccessState({...active,status:"suspended"},t+1000),"no_access");
assert.equal(isPaidAccessState("trial_active"),false,"trial must not become paid subscription");
assert.equal(isPaidAccessState("paid"),true);
assert.equal(isPaidAccessState("master"),true);

for (const p of ["/legal-consultation","/api/lexara/chat"]) {
  for(const [state,expected] of Object.entries({trial_active:true,paid:true,master:true,trial_expired:false,no_access:false})){
    const result={allowed:false,status:null,location:null};
    const req={path:p,method:p.startsWith("/api/")?"POST":"GET"};
    const res={setHeader(){return this},vary(){return this},status(s){result.status=s;return this},json(){return this},redirect(s,l){result.status=s;result.location=l;return this}};
    const access={authenticated:state!=="no_access",authorized:expected,accessState:state,reason:expected?"ok":"subscription_required"};
    await createSubscriptionGate(async()=>access)(req,res,()=>result.allowed=true);
    assert.equal(result.allowed,expected,state+" must have correct access to "+p);
  }
}

assert.match(auth,/activateLocalTrialHttp/);
assert.match(auth,/const skipTrial = req\.body\?\.skipTrial === true/);
assert.match(auth,/const activation = skipTrial \? null : await activateLocalTrialHttp\(createdUser\.id\)/);
assert.match(auth,/if \(user\.trialEligible && !user\.trialStartedAt\)/);
assert.match(auth,/const authorized = isPaidAccessState\(accessState\) \|\| accessState === "trial_active"/);
assert.match(signup,/skipTrial: signupSubscribeNow/);
assert.match(signup,/await completeLogin\(response, loginSubscribeNow\)/);
assert.match(signup,/if \(data\.accessState === "trial_active" && data\.trialOutcome === "ELIGIBLE"\)/);
assert.match(signup,/Skip my 72-hour free trial and subscribe now/);
assert.match(app,/accessState === "trial_active"/);
assert.match(app,/<TrialStatusBanner/);
assert.match(app,/<TrialAccessPage review \/>/);
assert.match(app,/<TrialAccessPage early \/>/);
assert.match(trialPage,/"Your free trial is still active"/);
assert.match(trialPage,/"We need to review trial eligibility"/);
assert.match(gate,/access\.authenticated && access\.authorized &&/);
console.log("PASS: trial signup, optional paid checkout, trial access, expiration, repeat protections, paid status isolation");
