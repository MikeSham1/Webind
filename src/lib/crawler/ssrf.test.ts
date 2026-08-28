import { describe, it, expect, vi } from "vitest";
import {
  BlockedUrlError,
  assertPublicUrl,
  isBlockedHostname,
  isBlockedIp,
  normalizeUrl,
} from "./ssrf";

describe("isBlockedIp", () => {
  it("blocks loopback, private, and link-local IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud instance metadata
      "100.64.0.1", // carrier-grade NAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("gets the 172.16/12 boundaries right", () => {
    expect(isBlockedIp("172.15.255.255")).toBe(false);
    expect(isBlockedIp("172.16.0.0")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("172.32.0.0")).toBe(false);
  });

  it("blocks loopback, unique-local, link-local, and multicast IPv6", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv6", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
  });

  it("sees through IPv4-in-IPv6 wrappers", () => {
    // A v6 wrapper must not launder a private v4 address past the check.
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:192.168.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true); // hex-encoded 127.0.0.1
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("refuses anything that isn't an IP", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("isBlockedHostname", () => {
  it("blocks internal names and suffixes", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "printer.local",
      "metadata.google.internal",
      "db.internal",
      "wiki.intranet",
      "router.home.arpa",
    ]) {
      expect(isBlockedHostname(host), host).not.toBeNull();
    }
  });

  it("blocks single-label hostnames", () => {
    expect(isBlockedHostname("intranet-box")).not.toBeNull();
  });

  it("blocks private IP literals, including bracketed IPv6", () => {
    expect(isBlockedHostname("169.254.169.254")).not.toBeNull();
    expect(isBlockedHostname("[::1]")).not.toBeNull();
  });

  it("allows ordinary public hostnames and public IP literals", () => {
    expect(isBlockedHostname("example.com")).toBeNull();
    expect(isBlockedHostname("www.example.co.uk")).toBeNull();
    expect(isBlockedHostname("8.8.8.8")).toBeNull();
  });

  it("is case- and trailing-dot-insensitive", () => {
    expect(isBlockedHostname("LOCALHOST")).not.toBeNull();
    expect(isBlockedHostname("localhost.")).not.toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("defaults a missing scheme to https", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrl("  example.com/path  ")).toBe("https://example.com/path");
  });

  it("keeps an explicit http scheme", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects non-web schemes", () => {
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects embedded credentials", () => {
    expect(normalizeUrl("https://user:pass@example.com")).toBeNull();
  });

  it("rejects internal targets that the old dotted-hostname check let through", () => {
    // Every one of these is dotted, which is why "must contain a dot" was not
    // an SSRF defence.
    expect(normalizeUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(normalizeUrl("http://127.0.0.1:3000")).toBeNull();
    expect(normalizeUrl("http://10.0.0.5")).toBeNull();
    expect(normalizeUrl("http://192.168.1.1")).toBeNull();
  });

  it("rejects adult-content domains", () => {
    expect(normalizeUrl("https://porn-example.com")).toBeNull();
    expect(normalizeUrl("https://subdomain.pornhub.com")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("assertPublicUrl", () => {
  const resolvingTo = (...addresses: string[]) =>
    vi.fn(async () => addresses);

  it("accepts a domain resolving only to public addresses", async () => {
    await expect(
      assertPublicUrl("https://example.com/", resolvingTo("93.184.216.34")),
    ).resolves.toBeUndefined();
  });

  it("rejects a domain resolving to a private address", async () => {
    // The `*.nip.io` style of attack: a perfectly ordinary public name whose
    // A record points inside.
    await expect(
      assertPublicUrl("https://127-0-0-1.nip.io/", resolvingTo("127.0.0.1")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects when any one record is private", async () => {
    await expect(
      assertPublicUrl("https://mixed.example/", resolvingTo("8.8.8.8", "10.0.0.1")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects a domain that resolves to nothing", async () => {
    await expect(
      assertPublicUrl("https://void.example/", resolvingTo()),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects when resolution fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    await expect(
      assertPublicUrl("https://nope.example/", failing),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("does not resolve an IP literal — it is already fully checked", async () => {
    const resolver = resolvingTo("8.8.8.8");
    await expect(
      assertPublicUrl("https://8.8.8.8/", resolver),
    ).resolves.toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();

    await expect(
      assertPublicUrl("https://10.0.0.1/", resolver),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects non-http schemes before resolving anything", async () => {
    const resolver = resolvingTo("8.8.8.8");
    await expect(
      assertPublicUrl("file:///etc/passwd", resolver),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects adult-content domains before resolving anything", async () => {
    const resolver = resolvingTo("8.8.8.8");
    await expect(
      assertPublicUrl("https://porn-example.com/", resolver),
    ).rejects.toThrow(/adult-content/i);
    expect(resolver).not.toHaveBeenCalled();
  });
});
