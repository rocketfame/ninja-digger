import { describe, expect, it } from "vitest";
import { classifyEmail, isJunkEmail, normalizeEmail, pickBestEmail } from "../emailJunk";

const bad = (e: string, reasonPart?: string) => {
  const r = classifyEmail(e);
  expect(r.ok, `${e} should be junk`).toBe(false);
  if (reasonPart && !r.ok) expect(r.reason).toContain(reasonPart);
};
const good = (e: string) => {
  const r = classifyEmail(e);
  expect(r.ok, `${e} should be ok (${!r.ok ? r.reason : ""})`).toBe(true);
};

describe("normalizeEmail", () => {
  it("lowercases, trims and strips trailing punctuation / mailto", () => {
    expect(normalizeEmail("  Max@Example.ORG.,")).toBe("max@example.org");
    expect(normalizeEmail("mailto:a@b.co")).toBe("a@b.co");
    expect(normalizeEmail("u003ebooking@artist.com")).toBe("booking@artist.com");
  });
  it("fixes well-known freemail typo domains instead of dropping them", () => {
    expect(normalizeEmail("john@gmial.com")).toBe("john@gmail.com");
    expect(normalizeEmail("john@gmail.con")).toBe("john@gmail.com");
    expect(normalizeEmail("john@hotmial.com")).toBe("john@hotmail.com");
    expect(normalizeEmail("john@yaho.com")).toBe("john@yahoo.com");
  });
});

describe("classifyEmail — syntax & artifacts", () => {
  it("rejects invalid syntax and file names picked up by regex", () => {
    bad("not-an-email", "syntax");
    bad("logo@2x.png", "artifact");
    bad("icon@site.svg", "artifact");
    bad("a@b", "syntax");
  });
  it("rejects machine ids and tracking endpoints", () => {
    bad("7c33659f530ef43fb4532fc6e83354dd@o363271.ingest.us.sentry.io", "tracking");
    bad("5d1795a2db124a268f1e1bd88f503500@sentry.wixpress.com", "tracking");
    bad("x@cloudfront.net", "tracking");
    bad("a@fonts.googleapis.com", "tracking");
  });
});

describe("classifyEmail — placeholders, platforms, disposable, hostile", () => {
  it("rejects placeholder addresses", () => {
    bad("user@domain.com", "placeholder");
    bad("youremail@example.com", "placeholder");
    bad("email@ejemplo.com", "placeholder");
    bad("john.doe@email.com", "placeholder");
    bad("your@email.com", "placeholder");
    bad("test@test.com", "placeholder");
    bad("name@yourdomain.com", "placeholder");
  });
  it("rejects platform mailboxes that are not a person's inbox", () => {
    bad("didi.florin@facebook.com", "platform");
    bad("artist@bandcamp.com", "platform");
    bad("team@latofonts.com", "platform");
    bad("promo@soundcloud.com", "platform");
    bad("x@linktr.ee", "platform");
  });
  it("rejects disposable domains from the vendored blocklist", () => {
    bad("a@mailinator.com", "disposable");
    bad("a@10minutemail.com", "disposable");
    bad("a@guerrillamail.com", "disposable");
  });
  it("rejects hostile-country domains", () => {
    bad("dj@mail.ru", "hostile");
    bad("dj@yandex.com", "hostile");
    bad("dj@promo.by", "hostile");
  });
});

describe("classifyEmail — role addresses (RFC 2142 + common)", () => {
  it("always rejects hard role/system mailboxes", () => {
    for (const l of ["noreply", "no-reply", "do-not-reply", "postmaster", "abuse", "webmaster", "hostmaster", "admin", "root",
      "mailer-daemon", "support", "helpdesk", "help", "billing", "sales", "orders", "newsletter", "unsubscribe", "jobs", "careers",
      "legal", "dmca", "copyright", "privacy", "security", "notifications", "alerts", "feedback", "marketing", "accounts", "invoice"]) {
      bad(`${l}@nickferrington.com`, "role");
    }
  });
  it("allows soft roles on an artist's own domain (their real work inbox)", () => {
    for (const e of ["info@nickferrington.com", "booking@donermusic.it", "bookings@matteoangelini.com", "mgmt@tonyquattro.com",
      "management@lieblingsstueck-music.de", "contact@bouki.co", "hello@deadmotionrecords.pt", "demos@somelabel.net", "press@artist.io",
      "music@artist.io", "studio@artist.io", "demo@skrecordings.com", "demos@ockrecords.com"]) good(e);
  });
  it("rejects soft roles on generic/platform/freemail domains", () => {
    bad("info@gmail.com", "role");
    bad("contact@outlook.com", "role");
    bad("booking@yahoo.com", "role");
    bad("info@wix.com", "platform");
  });
});

describe("classifyEmail — real inboxes pass", () => {
  it("accepts normal personal and artist addresses", () => {
    for (const e of ["maxpower@gmail.com", "dj.sasha.music@outlook.com", "kyle@icloud.com", "artist@protonmail.com",
      "hello.world@artistdomain.co.uk", "m.angelini@matteoangelini.com", "stereotribe@email.com", "mail@artist-site.de", "Firstname.Lastname@label-records.com"]) good(e);
  });
  it("isJunkEmail is the boolean shorthand", () => {
    expect(isJunkEmail("support@x.com")).toBe(true);
    expect(isJunkEmail("kyle@icloud.com")).toBe(false);
    expect(isJunkEmail(null)).toBe(true);
  });
});

describe("pickBestEmail", () => {
  it("returns the first non-junk, normalized email from free text", () => {
    const text = "Contact: noreply@site.com, booking: Booking@ArtistName.com; img@2x.png";
    expect(pickBestEmail(text)).toBe("booking@artistname.com");
  });
  it("prefers a personal inbox over a soft role when both are present", () => {
    const text = "info@artist.com / max@artist.com";
    expect(pickBestEmail(text)).toBe("max@artist.com");
  });
  it("decodes html/unicode escapes before matching", () => {
    expect(pickBestEmail('\\u003econtact@bouki.co\\u003c')).toBe("contact@bouki.co");
    expect(pickBestEmail("&gt;mail@artist.de&lt;")).toBe("mail@artist.de");
  });
  it("returns null when nothing usable", () => {
    expect(pickBestEmail("support@x.com user@domain.com")).toBeNull();
  });
});
