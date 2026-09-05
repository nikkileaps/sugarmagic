/**
 * targets/web/src/ui/EpisodesScreen.test.tsx
 *
 * Purpose: the Episodes screen's two Season-shaped rules.
 *
 *   1. A card's ordinal restarts inside each Season. Under a
 *      heading reading "Season 2", a card numbered 7 is wrong.
 *   2. A one-Season game renders no heading at all, so a project
 *      that never makes a second Season looks exactly as it did
 *      before Seasons existed.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EpisodesScreen, type EpisodesViewModel } from "./EpisodesScreen";

function render(episodes: EpisodesViewModel): string {
  return renderToStaticMarkup(
    <EpisodesScreen
      episodes={episodes}
      onContinue={() => {}}
      onClose={() => {}}
    />
  );
}

const ONE_SEASON: EpisodesViewModel = {
  groups: [
    {
      seasonId: "season:one",
      displayName: "Season One",
      entries: [
        {
          episodeId: "e:a",
          displayName: "Arrival",
          description: "",
          status: "current"
        },
        {
          episodeId: "e:b",
          displayName: "Departure",
          description: "",
          status: "locked"
        }
      ]
    }
  ]
};

const TWO_SEASONS: EpisodesViewModel = {
  groups: [
    ONE_SEASON.groups[0]!,
    {
      seasonId: "season:two",
      displayName: "Season Two",
      entries: [
        {
          episodeId: "e:c",
          displayName: "Return",
          description: "",
          status: "locked"
        }
      ]
    }
  ]
};

describe("the Episodes screen", () => {
  it("hides the Season heading when there is only one Season", () => {
    const html = render(ONE_SEASON);
    expect(html).toContain("Arrival");
    expect(html).not.toContain("Season One");
  });

  it("shows a heading per Season once there are two", () => {
    const html = render(TWO_SEASONS);
    expect(html).toContain("Season One");
    expect(html).toContain("Season Two");
  });

  it("restarts the card ordinal inside each Season", () => {
    // Season two's only Episode is the third in the story. It must
    // read 1, not 3, or the number contradicts the heading above it.
    //
    // Read off the ordinal's own element rather than every digits-only
    // div on the page: any other number the card grows -- a count, a
    // percentage -- would otherwise join the list and this would fail
    // for a reason that has nothing to do with ordinals.
    const html = render(TWO_SEASONS);
    const ordinals = [
      ...html.matchAll(/<div style="font-size:22px[^"]*">(\d+)<\/div>/g)
    ].map((match) => match[1]);
    expect(ordinals).toEqual(["1", "2", "1"]);
  });

  it("still renders every card's status", () => {
    const html = render(TWO_SEASONS);
    expect(html).toContain("Current");
    expect(html).toContain("Locked");
  });
});
