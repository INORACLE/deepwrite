import { describe, expect, it } from "vitest";
import { announcedVersionStatus } from "./useAnnouncedVersion";

describe("announcement version reminders", () => {
  it("shows a reminder and manual download when the update source lags behind the announcement", () => {
    expect(announcedVersionStatus("1.5.3", "1.5.2", "1.5.0")).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: true
    });
  });

  it("uses character order for every version segment and prerelease suffix", () => {
    expect(
      announcedVersionStatus("1.10.0", "1.9.0", "1.9.9").manualUpdateRequired
    ).toBe(false);
    expect(
      announcedVersionStatus("1.5.3", "1.5.3-beta.2", "1.5.3-beta.10")
        .manualUpdateRequired
    ).toBe(false);
    expect(
      announcedVersionStatus("1.5.3", "1.5.2", "1.5.4").manualUpdateRequired
    ).toBe(false);
  });

  it("recognizes 1.6.4 as newer than historical 1.6.3xx builds", () => {
    expect(announcedVersionStatus("1.6.4", "1.6.303", "1.6.4")).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: false
    });
    expect(announcedVersionStatus("1.6.4", "1.6.303", "1.6.308")).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: true
    });
  });

  it("clears the reminder only when versions match or the announcement is removed", () => {
    expect(
      announcedVersionStatus("1.5.3", "1.5.3", "1.5.0").hasVersionNotice
    ).toBe(false);
    expect(
      announcedVersionStatus("1.5.3", "1.5.4", "1.5.3").hasVersionNotice
    ).toBe(true);
    expect(announcedVersionStatus(undefined, "1.5.2", "1.5.0")).toEqual({
      hasVersionNotice: false,
      manualUpdateRequired: false
    });
  });

  it("keeps the announcement reminder when no update source version is available", () => {
    expect(announcedVersionStatus("1.5.3", "1.5.2", undefined)).toEqual({
      hasVersionNotice: true,
      manualUpdateRequired: false
    });
    expect(
      announcedVersionStatus("invalid", "1.5.2", undefined).hasVersionNotice
    ).toBe(false);
  });
});
