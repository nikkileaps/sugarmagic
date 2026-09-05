/**
 * apps/studio/src/StoryStructureView.test.tsx
 *
 * Purpose: the Season level of the structure workspace actually
 * renders, and its guards are scoped to the container they belong
 * to rather than the project.
 *
 * A disabled button is invisible in code review and to the
 * typechecker: it compiles and it looks correct in the diff. These
 * render the panel and read the guard text the buttons actually
 * carry.
 *
 * They stop at rendered markup. There is no DOM test environment in
 * this repo, so nothing here fires a click; whether a control is
 * wired to the right handler is checked by hand in Studio.
 *
 * Status: active
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  createDefaultEpisode,
  createDefaultScene,
  createDefaultSeason,
  type Season
} from "@sugarmagic/domain";
import { StoryStructureView } from "./StoryStructureView";

function seasonWith(seasonId: string, episodeIds: string[]): Season {
  return createDefaultSeason({
    seasonId,
    displayName: seasonId,
    episodes: episodeIds.map((episodeId) =>
      createDefaultEpisode({
        episodeId,
        displayName: episodeId,
        scenes: [createDefaultScene({ sceneId: `${episodeId}:s1` })]
      })
    )
  });
}

const NOOP = () => {};

function render(seasons: Season[]): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <StoryStructureView
        seasons={seasons}
        activeSceneId={null}
        questDefinitions={[]}
        environmentDefinitions={[]}
        regions={[{ regionId: "region:town", displayName: "Town" }]}
        soundCueDefinitions={[]}
        onAddScene={NOOP}
        onRenameScene={NOOP}
        onUpdateScene={NOOP}
        onDeleteScene={NOOP}
        onReorderScene={NOOP}
        onSelectScene={NOOP}
        episodeEndRouting="episodes-screen"
        onUpdateEpisodeEndRouting={NOOP}
        onAddEpisode={NOOP}
        onUpdateEpisode={NOOP}
        onDeleteEpisode={NOOP}
        onReorderEpisode={NOOP}
        onMoveSceneToEpisode={NOOP}
        onMoveQuestToScene={NOOP}
        onAddSeason={NOOP}
        onUpdateSeason={NOOP}
        onDeleteSeason={NOOP}
        onReorderSeason={NOOP}
        onMoveEpisodeToSeason={NOOP}
      />
    </MantineProvider>
  );
}

describe("the structure workspace shows Seasons", () => {
  it("renders every Season, Episode and Scene", () => {
    const html = render([
      seasonWith("season:one", ["e:a", "e:b"]),
      seasonWith("season:two", ["e:c"])
    ]);
    for (const name of ["season:one", "season:two", "e:a", "e:b", "e:c"]) {
      expect(html).toContain(name);
    }
  });

  it("offers an Add Season control and one Add Episode control per Season", () => {
    const html = render([
      seasonWith("season:one", ["e:a"]),
      seasonWith("season:two", ["e:c"])
    ]);
    expect(html).toContain("+ Add Season");
    expect(html).toContain("New Episode in season:one");
    expect(html).toContain("New Episode in season:two");
    // One input per Season is the point: a single project-wide input
    // would have to guess which Season the Episode lands in.
    expect([...html.matchAll(/New Episode in /g)]).toHaveLength(2);
  });

  it("will not let the last Season be deleted", () => {
    const html = render([seasonWith("season:one", ["e:a"])]);
    expect(html).toContain("A project always has at least one Season");
  });

  it("lets a Season be deleted once there are two", () => {
    const html = render([
      seasonWith("season:one", ["e:a"]),
      seasonWith("season:two", ["e:c"])
    ]);
    expect(html).not.toContain("A project always has at least one Season");
    expect(html).toContain("Delete this Season and every Episode in it");
  });

  it("guards Episode delete on the OWNING Season, not the project", () => {
    // Season two holds one Episode while the project holds three. A
    // project-wide count would offer the delete and leave Season two
    // empty.
    const html = render([
      seasonWith("season:one", ["e:a", "e:b"]),
      seasonWith("season:two", ["e:c"])
    ]);
    expect(html).toContain("A Season always has at least one Episode");
    expect(html).toContain("Delete this Episode and every Scene in it");
  });
});
