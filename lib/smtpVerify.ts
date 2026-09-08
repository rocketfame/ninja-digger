/**
 * Mailbox-level verification (layer 3, after lib/emailJunk syntax/policy and MX).
 *
 * Talks SMTP to the recipient's MX and reads the RCPT TO answer. Measured on our
 * own labelled data (2026-09-08, addresses with known Brevo outcomes):
 *   - Gmail (70% of our base): 3/3 dead addresses caught, 0 false positives
 *   - custom/Workspace domains: most dead addresses caught
 *   - Microsoft/Yahoo: greylist probes, so they are NOT judged here
 *
 * DESIGN RULE — only an explicit 5xx on RCPT TO means "dead". Timeouts, refused
 * connections, 4xx greylisting and catch-all domains are inconclusive and never
 * remove a lead. The MIT package `deep-email-validator` was benchmarked on the
 * same set and marked a WORKING hotmail address invalid; a false positive burns
 * a real lead forever, so we keep the conservative rule instead of the
 * dependency. Port 25 egress is required, so this runs from scripts, never from
 * Vercel (serverless blocks port 25).
 */
import net from "node:net";
import dns from "node:dns/promises";

export type MailboxVerdict = "invalid" | "valid" | "catch_all" | "unknown";
export type MailboxResult = { email: string; verdict: MailboxVerdict; note?: string };

/** Providers that greylist/deny verification probes — their answers mean nothing. */
const UNVERIFIABLE_MX = /(protection\.outlook\.com|hotmail\.com|outlook\.com|yahoodns\.net|yahoo\.com|icloud\.com|apple\.com|mail\.ru|qq\.com|barracudanetworks|mimecast|proofpoint|messagelabs)/i;

/** Pure: map an SMTP reply to a verdict. Only 5xx is a dead mailbox. */
export function classifySmtpReply(code: number, text = ""): MailboxVerdict {
  if (code >= 500 && code < 600) {
    // Policy rejections are about US, not about the mailbox existing.
    if (/spam|policy|blocked|blacklist|reputation|rate limit|too many|greylist|denied due to|not authorized|relay access/i.test(text)) return "unknown";
    return "invalid";
  }
  if (code >= 200 && code < 300) return "valid";
  return "unknown"; // 4xx greylisting, anything else
}

function readReply(sock: net.Socket, cmd: string | null, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => { sock.off("data", onData); reject(new Error("timeout")); }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const lastLine = buf.split(/\r\n/).filter(Boolean).pop() ?? "";
      if (/^\d{3} /.test(lastLine)) { clearTimeout(timer); sock.off("data", onData); resolve(buf.trim()); }
    };
    sock.on("data", onData);
    if (cmd) sock.write(cmd + "\r\n");
  });
}

async function probe(host: string, email: string, from: string, helo: string): Promise<MailboxResult> {
  const domain = email.split("@")[1];
  return new Promise<MailboxResult>((resolve) => {
    const sock = net.createConnection({ host, port: 25, timeout: 9000 });
    let settled = false;
    const done = (verdict: MailboxVerdict, note?: string) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* already closed */ }
      resolve({ email, verdict, note: note?.slice(0, 80) });
    };
    sock.on("error", (e) => done("unknown", `conn: ${e.message}`));
    sock.on("timeout", () => done("unknown", "socket timeout"));
    void (async () => {
      try {
        await readReply(sock, null);
        await readReply(sock, `EHLO ${helo}`);
        await readReply(sock, `MAIL FROM:<${from}>`);
        const reply = await readReply(sock, `RCPT TO:<${email}>`);
        const verdict = classifySmtpReply(parseInt(reply.slice(0, 3), 10), reply);
        if (verdict === "valid") {
          // Catch-all probe: if a random mailbox is also accepted, "valid" is meaningless.
          try {
            const rnd = `zz${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@${domain}`;
            const r2 = await readReply(sock, `RCPT TO:<${rnd}>`, 6000);
            if (classifySmtpReply(parseInt(r2.slice(0, 3), 10), r2) === "valid") return done("catch_all");
          } catch { /* inconclusive — keep "valid" */ }
        }
        try { await readReply(sock, "QUIT", 3000); } catch { /* ignore */ }
        done(verdict, reply.split("\n")[0]);
      } catch (e) {
        done("unknown", e instanceof Error ? e.message : String(e));
      }
    })();
  });
}

/**
 * Verify one mailbox. Tries up to two MX hosts before giving up (a single
 * refused host is not evidence — that cost `deep-email-validator` two correct
 * detections on our set).
 */
export async function verifyMailbox(
  email: string,
  opts: { from?: string; helo?: string } = {}
): Promise<MailboxResult> {
  const from = opts.from ?? "max@promosound.net";
  const helo = opts.helo ?? "promosound.net";
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (!domain) return { email, verdict: "unknown", note: "no domain" };

  let hosts: string[];
  try {
    hosts = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((m) => m.exchange).filter(Boolean);
  } catch {
    return { email, verdict: "unknown", note: "mx lookup failed" };
  }
  if (hosts.length === 0) return { email, verdict: "unknown", note: "no mx" };
  if (hosts.some((h) => UNVERIFIABLE_MX.test(h))) return { email, verdict: "unknown", note: "provider blocks probes" };

  for (const host of hosts.slice(0, 2)) {
    const r = await probe(host, email, from, helo);
    if (r.verdict !== "unknown") return r;
  }
  return { email, verdict: "unknown", note: "all MX inconclusive" };
}
