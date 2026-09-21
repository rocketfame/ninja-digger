import { describe, expect, it } from "vitest";
import { gateVerdict, postmasterVerdict, rampDecision, type DayMetrics, type PostmasterMetrics, type RampConfig } from "../rampPolicy";

const cfg: RampConfig = { start: "2026-09-19", steps: [100, 150, 250, 400], stepDays: 2, hours: 8 };
const good: DayMetrics = { pushed: 200, delivered: 196, opened: 40, hardBounce: 2, unsub: 0, spam: 0 };
const base = { cfg, today: "2026-09-21", level: 0, levelSince: "2026-09-19", stopped: false, manualHold: false, metrics: good };

describe("ramp ladder", () => {
  it("is off before the start date or without a config", () => {
    expect(rampDecision({ ...base, today: "2026-09-18" }).action).toBe("off");
    expect(rampDecision({ ...base, cfg: null }).action).toBe("off");
  });
  it("starts on the first rung the first day", () => {
    expect(rampDecision({ ...base, today: "2026-09-19", levelSince: null, metrics: null })).toMatchObject({ action: "start", level: 0, push: 100 });
  });
  it("holds while the rung has not run its days", () => {
    expect(rampDecision({ ...base, today: "2026-09-20" })).toMatchObject({ action: "hold", push: 100 });
  });
  it("climbs after stepDays when every gate passed", () => {
    expect(rampDecision(base)).toMatchObject({ action: "climb", level: 1, push: 150 });
  });
  it("never climbs past the last rung", () => {
    expect(rampDecision({ ...base, level: 3, levelSince: "2026-09-10" })).toMatchObject({ action: "hold", level: 3, push: 400 });
  });
  it("holds on a manual hold and on soft gates", () => {
    expect(rampDecision({ ...base, manualHold: true }).action).toBe("hold");
    expect(rampDecision({ ...base, metrics: { ...good, opened: 24 } })).toMatchObject({ action: "hold", push: 100 }); // 12.2 % < 15 % on rung 1
    expect(rampDecision({ ...base, level: 2, metrics: { ...good, opened: 24 } })).toMatchObject({ action: "climb" }); // 12.2 % ≥ 10 % later
    expect(rampDecision({ ...base, metrics: { ...good, unsub: 4 } }).action).toBe("hold");
  });
  it("pulls the stop cord only on hard signals: complaints, bounces — never on quiet opens", () => {
    expect(rampDecision({ ...base, metrics: { ...good, pushed: 1000, delivered: 990, opened: 200, spam: 1 } })).toMatchObject({ action: "stop", push: 0 });
    expect(rampDecision({ ...base, metrics: { ...good, hardBounce: 10 } })).toMatchObject({ action: "stop" });
    expect(rampDecision({ ...base, metrics: { ...good, opened: 0 } })).toMatchObject({ action: "hold", push: 100 }); // the system keeps running (user, 21.09)
  });
  it("stays stopped until a human clears it", () => {
    expect(rampDecision({ ...base, stopped: true })).toMatchObject({ action: "stop", push: 0 });
  });
  it("lets Gmail's own verdict stop or hold the ladder", () => {
    const pm: PostmasterMetrics = { date: "2026-09-19", spamRatio: 0.0005, authRatio: 1, deliveryErrorRatio: 0, needsWork: [], verdict: null };
    expect(rampDecision({ ...base, postmaster: pm })).toMatchObject({ action: "climb" });
    expect(rampDecision({ ...base, postmaster: { ...pm, spamRatio: 0.001 } })).toMatchObject({ action: "stop" });
    expect(rampDecision({ ...base, postmaster: { ...pm, deliveryErrorRatio: 0.42 } })).toMatchObject({ action: "stop" });
    expect(rampDecision({ ...base, postmaster: { ...pm, verdict: "SPAM_RATE_HIGH" } })).toMatchObject({ action: "hold" });
    expect(rampDecision({ ...base, postmaster: { ...pm, authRatio: 0.58 } })).toMatchObject({ action: "hold" });
    expect(rampDecision({ ...base, postmaster: { ...pm, needsWork: ["DMARC_ALIGNMENT"] } })).toMatchObject({ action: "hold" });
    expect(rampDecision({ ...base, postmaster: { ...pm, needsWork: ["USER_REPORTED_SPAM_RATE"] } })).toMatchObject({ action: "climb" }); // the ratio itself decides
    expect(postmasterVerdict({ ...pm, spamRatio: null, authRatio: null })).toEqual({ stop: "", hold: "" });
  });
  it("does not judge a day too small to read", () => {
    expect(gateVerdict({ pushed: 100, delivered: 100, opened: 0, hardBounce: 0, unsub: 0, spam: 1 }, 0)).toEqual({ stop: "", hold: "" });
    expect(gateVerdict(null, 0)).toEqual({ stop: "", hold: "" });
  });
});
