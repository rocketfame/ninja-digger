import { describe, expect, it } from "vitest";
import { classifySmtpReply } from "../smtpVerify";

describe("classifySmtpReply", () => {
  it("treats an explicit 5xx mailbox rejection as dead", () => {
    expect(classifySmtpReply(550, "550-5.1.1 The email account that you tried to reach does not exist")).toBe("invalid");
    expect(classifySmtpReply(551, "551 User not local")).toBe("invalid");
    expect(classifySmtpReply(553, "553 mailbox name not allowed")).toBe("invalid");
  });

  it("never kills a lead when the 5xx is about US, not the mailbox", () => {
    for (const t of [
      "550 5.7.1 Message rejected due to spam content",
      "550 Blocked by policy",
      "554 your IP is on a blacklist",
      "550 sender reputation too low",
      "550 too many connections, rate limit",
      "550 Relay access denied",
    ]) expect(classifySmtpReply(550, t), t).toBe("unknown");
  });

  it("accepts 2xx and stays undecided on greylisting", () => {
    expect(classifySmtpReply(250, "250 2.1.5 OK")).toBe("valid");
    expect(classifySmtpReply(451, "451 4.7.1 Greylisted, try again later")).toBe("unknown");
    expect(classifySmtpReply(421, "421 Service not available")).toBe("unknown");
    expect(classifySmtpReply(0, "")).toBe("unknown");
  });
});
