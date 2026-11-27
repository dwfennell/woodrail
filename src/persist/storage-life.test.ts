import { describe, expect, it } from "vitest";
import { storageMayNotLast, webkitStorage } from "./storage-life";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0";

const page = (userAgent: string, over: Partial<{ framed: boolean; crossSite: boolean; platform: string; maxTouchPoints: number }> = {}) => ({ framed: true, crossSite: true, userAgent, platform: "iPhone", maxTouchPoints: 5, ...over });

describe("storageMayNotLast", () => {
  it("is so in another site's frame on an iPhone, in any browser there (all WebKit)", () => {
    expect(storageMayNotLast(page(IPHONE_SAFARI))).toBe(true);
    expect(storageMayNotLast(page(IPHONE_CHROME))).toBe(true);
  });

  it("is so on an iPad asking for the desktop site (a Mac with a touch screen), and in Safari on a Mac", () => {
    expect(storageMayNotLast(page(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 5 }))).toBe(true);
    expect(storageMayNotLast(page(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 0 }))).toBe(true);
  });

  it("isn't for Chrome on a Mac or Android, nor Firefox", () => {
    for (const ua of [MAC_CHROME, ANDROID, MAC_FIREFOX]) expect(webkitStorage({ userAgent: ua, platform: ua === ANDROID ? "Linux armv8l" : "MacIntel", maxTouchPoints: ua === ANDROID ? 5 : 0 }), ua).toBe(false);
  });

  it("isn't on the page itself, nor in a frame on its own site", () => {
    expect(storageMayNotLast(page(IPHONE_SAFARI, { framed: false, crossSite: false }))).toBe(false);
    expect(storageMayNotLast(page(IPHONE_SAFARI, { crossSite: false }))).toBe(false);
  });
});
