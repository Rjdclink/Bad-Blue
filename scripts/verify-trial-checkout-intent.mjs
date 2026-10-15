import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import {getLegalWhatAccessState} from "../server/trialAccess.ts";

const root=resolve(new URL("..",import.meta.url).pathname);
const read=f=>readFileSync(resolve(root,f),"utf8");
const auth=read("server/auth.ts");
const login=read("client/src/pages/login.tsx");
const routes=read("server/routes/subscription.routes.ts");
const trialPage=read("client/src/pages/trial-access.tsx");
const trialAcceptance=read("scripts/verify-legalwhat-trial-sandbox-acceptance.mjs");

const expression=auth.match(/const skipTrial = ([^;]+);/)?.[1];
assert.ok(expression,"signup skip-trial decision must exist");
const skipTrial=new Function("req","return "+expression);
assert.equal(skipTrial({body:{skipTrial:true}}),false,"stale client must not silently skip trial");
assert.equal(skipTrial({body:{skipTrial:true,trialChoice:"subscribe_now"}}),true,"explicit skip-trial choice remains available");
assert.equal(skipTrial({body:{skipTrial:false,trialChoice:"subscribe_now"}}),false);
assert.match(login,/trialChoice:\s*signupSubscribeNow\s*\?\s*"subscribe_now"\s*:\s*"free_trial"/,"signup sends explicit trial choice");
assert.match(login,/apiRequest\("\/api\/subscription\/checkout",\s*"POST",\s*\{\s*subscribeNow:\s*true\s*\}\)/,"login user-initiated checkout must have explicit consent");
assert.match(trialPage,/apiRequest\("\/api\/subscription\/checkout",\s*"POST",\s*\{\s*subscribeNow:\s*true\s*\}\)/,"post-trial checkout must have explicit consent");
assert.match(trialAcceptance,/api\("\/api\/subscription\/checkout",\s*\{\s*subscribeNow:\s*true\s*\}\)/,"sandbox checkout still tests explicit intent");

function evaluateTypeScript(code,scope){
 const transformed=ts.transpileModule(code,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}});
 const errors=(transformed.diagnostics??[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,"extracted TypeScript handler must compile");
 return runInNewContext(transformed.outputText,scope,{timeout:2000});
}
const loginStart=login.indexOf("  const completeLogin = async (response: Response, subscribeNow = false) => {");
const loginEnd=login.indexOf("\n  const handleLogin = async (e: FormEvent) => {",loginStart);
assert.ok(loginStart>=0 && loginEnd>loginStart);
const loginHandlerSource=login.slice(loginStart,loginEnd)+"\ncompleteLogin;";
async function exerciseLogin(data,choice=false){
 const result={locations:[],checkouts:0,toasts:[]};
 const context={
  subscriptionResumeStarted:{current:false},
  queryClient:{invalidateQueries:async()=>{}},
  toast:msg=>result.toasts.push(msg),
  beginSubscriptionCheckout:async()=>{result.checkouts++},
  setLocation:location=>result.locations.push(location),
 };
 const handler=evaluateTypeScript(loginHandlerSource,context);
 await handler({ok:true,json:async()=>data},choice);
 return result;
}

assert.deepEqual((await exerciseLogin({accessState:"trial_active"})).locations,["/lexara-consent"]);
assert.equal((await exerciseLogin({accessState:"trial_active"})).checkouts,0);
const unpaidLogin=await exerciseLogin({accessState:"no_access"});
assert.equal(unpaidLogin.checkouts,0,"unpaid login cannot silently create Square checkout");
assert.deepEqual(unpaidLogin.locations,["/subscription-required"],"unpaid login presents user a choice");
const expiredLogin=await exerciseLogin({accessState:"trial_expired"});
assert.equal(expiredLogin.checkouts,0);
assert.deepEqual(expiredLogin.locations,["/trial-expired"]);
const reviewLogin=await exerciseLogin({accessState:"no_access",trialOutcome:"AMBIGUOUS"});
assert.deepEqual(reviewLogin.locations,["/trial-review"]);
assert.equal(reviewLogin.checkouts,0);
const paidLogin=await exerciseLogin({accessState:"paid",hasActiveSubscription:true});
assert.deepEqual(paidLogin.locations,["/lexara-consent"]);
assert.equal(paidLogin.checkouts,0);
const electedLogin=await exerciseLogin({accessState:"no_access"},true);
assert.equal(electedLogin.checkouts,1,"explicit early-payment preference still opens Square");

const signupStart=login.indexOf('  const handleSignup = async (e: FormEvent) => {');
const signupEnd=login.indexOf('\n  return (\n    <div className="min-h-screen relative">',signupStart);
assert.ok(signupStart>=0 && signupEnd>signupStart,"actual signup handler must be testable");
const signupHandlerSource=login.slice(signupStart,signupEnd)+"\nhandleSignup;";
async function exerciseSignup(data,payNow=false){
 const result={locations:[],checkouts:0,requestBody:null};
 const context={
  setIsLoading:()=>{},
  apiRequest:async(_url,_method,body)=>{result.requestBody=body;return {ok:true,json:async()=>data}},
  signupEmail:"fixture@example.invalid",signupPassword:"valid-password",signupFirstName:"Trial",signupLastName:"Fixture",
  signupSubscribeNow:payNow,
  queryClient:{invalidateQueries:async()=>{}},
  subscriptionResumeStarted:{current:false},
  toast:()=>{},
  beginSubscriptionCheckout:async()=>{result.checkouts++},
  setLocation:location=>result.locations.push(location),
 };
 const handler=evaluateTypeScript(signupHandlerSource,context);
 await handler({preventDefault(){}});
 return result;
}
const freshSignup=await exerciseSignup({accessState:"trial_active",trialOutcome:"ELIGIBLE"});
assert.equal(freshSignup.checkouts,0);
assert.deepEqual(freshSignup.locations,["/lexara-consent"]);
assert.equal(freshSignup.requestBody?.skipTrial,false);
assert.equal(freshSignup.requestBody?.trialChoice,"free_trial");
const activationMiss=await exerciseSignup({accessState:"no_access"});
assert.equal(activationMiss.checkouts,0,"trial activation problem cannot automatically trigger Square");
assert.deepEqual(activationMiss.locations,["/trial-review"]);
const ambiguousSignup=await exerciseSignup({accessState:"no_access",trialOutcome:"AMBIGUOUS"});
assert.equal(ambiguousSignup.checkouts,0);
assert.deepEqual(ambiguousSignup.locations,["/trial-review"]);
const repeatSignup=await exerciseSignup({accessState:"no_access",trialOutcome:"CLEAR_REPEAT"});
assert.equal(repeatSignup.checkouts,0,"repeat trial should never cause unsolicited payment");
assert.deepEqual(repeatSignup.locations,["/subscription-required"]);
const electedSignup=await exerciseSignup({accessState:"no_access",trialSkipped:true},true);
assert.equal(electedSignup.checkouts,1);
assert.equal(electedSignup.requestBody?.skipTrial,true);
assert.equal(electedSignup.requestBody?.trialChoice,"subscribe_now");

const checkoutMarker='app.post("/api/subscription/checkout", isIdentityAuthenticated, async (req: Request, res: Response) => ';
const beginning=routes.indexOf(checkoutMarker),end=routes.indexOf('\n  app.post("/api/subscription/confirm"',beginning);
assert.ok(beginning>=0 && end>beginning);
const raw=routes.slice(beginning+checkoutMarker.length,end).trim();
assert.ok(raw.endsWith("});"),"checkout handler end");
const checkoutBody=raw.slice(0,-3)+"}";
const checkoutSource='const checkoutHandler = async (req: Request, res: Response) => '+checkoutBody+';\ncheckoutHandler;';
const nowMs=Date.now();
const activeDate=new Date(nowMs-3600_000).toISOString();
const expiryDate=new Date(nowMs+71*3600_000).toISOString();
const expiredStart=new Date(nowMs-73*3600_000).toISOString();
const expiredEnd=new Date(nowMs-3600_000).toISOString();
const fresh={id:"fixture-id-001",email:"fixture@example.invalid",status:"pending_payment",hasPaidForAccess:false,trialEligible:true,trialStartedAt:null,trialExpiresAt:null,trialConsumedAt:null};
const active={...fresh,trialStartedAt:activeDate,trialExpiresAt:expiryDate,trialConsumedAt:activeDate};
const expired={...fresh,trialStartedAt:expiredStart,trialExpiresAt:expiredEnd,trialConsumedAt:expiredStart};
async function exerciseCheckout(current,requestBody){
 const trace={activations:0,squareCalls:0,cookies:0,status:200,body:null};
 const mock={
  getLocalUserByIdHttp:async()=>current,
  getLegalWhatAccessState,
  activateLocalTrialHttp:async()=>{trace.activations++;return {outcome:"ELIGIBLE",user:active}},
  hasPaidServiceAccess:user=>user?.hasPaidForAccess===true,
  isSuspended:user=>user?.status==="suspended",
  issueLocalSessionCookie:()=>{trace.cookies++},
  userId:()=>current.id,userEmail:()=>current.email,
  getSquareClient:()=>({checkout:{paymentLinks:{create:async()=>{trace.squareCalls++;return {paymentLink:{url:"https://square.link/test",orderId:"test-order"}}}}}}),
  getSquareLocationId:()=>"location",
  resolvePlanVariationId:async()=>"plan",
  getBaseUrl:()=>"https://legalwhat.com",
  noteForUser:()=>"fixture",
  SUBSCRIPTION_NAME:"LegalWhat Subscription",
  SUBSCRIPTION_PRICE_CENTS:1999,
  crypto,
  console:{error:()=>{}},
 };
 const handler=evaluateTypeScript(checkoutSource,mock);
 const res={status(n){trace.status=n;return this},json(data){trace.body=data;return this}};
 await handler({user:{id:current.id,email:current.email},body:requestBody},res);
 return trace;
}
const legacySignup=await exerciseCheckout(fresh,{});
assert.equal(legacySignup.activations,1,"old signup client must receive trial activation");
assert.equal(legacySignup.squareCalls,0,"old client cannot start Square without consent");
assert.equal(legacySignup.body?.alreadyActive,true);
assert.equal(legacySignup.cookies,1);
const legacyLogin=await exerciseCheckout(active,{});
assert.equal(legacyLogin.squareCalls,0,"old sign-in client cannot force checkout during trial");
assert.equal(legacyLogin.body?.alreadyActive,true);
const legacyNoTrial=await exerciseCheckout({...fresh,trialEligible:false},{});
assert.equal(legacyNoTrial.squareCalls,0,"unpaid client cannot automatically create Square checkout");
assert.equal(legacyNoTrial.status,409);
const userSelectedPay=await exerciseCheckout(active,{subscribeNow:true});
assert.equal(userSelectedPay.squareCalls,1,"active trial may subscribe early when explicitly requested");
assert.ok(userSelectedPay.body?.checkoutUrl?.startsWith("https://square.link/"));
const afterExpiration=await exerciseCheckout(expired,{subscribeNow:true});
assert.equal(afterExpiration.squareCalls,1,"expired trials may subscribe");
const existingPaid=await exerciseCheckout({...fresh,hasPaidForAccess:true},{subscribeNow:true});
assert.equal(existingPaid.squareCalls,0);
assert.equal(existingPaid.body?.alreadyActive,true);
const suspended=await exerciseCheckout({...fresh,status:"suspended"},{subscribeNow:true});
assert.equal(suspended.status,403);
assert.equal(suspended.squareCalls,0);

console.log(JSON.stringify({result:"PASS",loginScenarios:7,signupScenarios:5,serverCheckoutScenarios:7,activationIntent:"verified",paymentIntent:"explicit only"}));
