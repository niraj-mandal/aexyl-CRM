// Self-check for regional greetings and script language: `npx tsx tests/call-script.check.ts`
import assert from "node:assert/strict";
import { defaultLang, greetingFor } from "../lib/call-script";

// The state named in the address, the discovery search (region), or only the PIN code.
assert.equal(greetingFor({ area: "Mithapukhuri Rd, Jorhat, Assam, 785001" }), "Nomoskar");
assert.equal(greetingFor({ area: "35, Jayanagar Road, Guwahati, 781022", region: "gym in Guwahati, Assam, India" }), "Nomoskar");
assert.equal(defaultLang({ area: null, place: null, region: "Guwahati, Assam, India" }), "assamese");
assert.equal(greetingFor({ area: "4 G.T Road, Jalandhar, 144008" }), "Sat Sri Akal ji");
assert.equal(greetingFor({ area: "Darbhanga, Bihar" }), "Pranam ji");
assert.equal(greetingFor({ area: "Pune, 411001" }), "Namaste ji");
assert.equal(defaultLang({ area: "Mohali, Punjab" }), "hinglish");
console.log("call-script: ok");
