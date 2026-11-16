import {describe, expect, it} from "vitest";
import {
  findActiveEpisodeIdInPageState,
  parseMediaRoute,
  resolveBangumiIdentity,
  resolveVideoIdentity
} from "../src/core/media";

describe("parseMediaRoute", () => {
  it("parses regular and multipart video URLs", () => {
    expect(parseMediaRoute("https://www.bilibili.com/video/BV1Jt411P77c")).toEqual({
      kind: "video",
      bvid: "BV1Jt411P77c",
      pageNumber: 1
    });
    expect(parseMediaRoute("https://www.bilibili.com/video/BV1Jt411P77c?p=3")).toEqual({
      kind: "video",
      bvid: "BV1Jt411P77c",
      pageNumber: 3
    });
  });

  it("parses Bangumi episode and season URLs", () => {
    expect(parseMediaRoute("https://www.bilibili.com/bangumi/play/ep678060")).toEqual({
      kind: "bangumi-episode",
      episodeId: 678060
    });
    expect(parseMediaRoute("https://www.bilibili.com/bangumi/play/ss42542")).toEqual({
      kind: "bangumi-season",
      seasonId: 42542
    });
  });

  it("rejects unsupported routes", () => {
    expect(() => parseMediaRoute("https://www.bilibili.com/anime/")).toThrowError(
      /not supported/i
    );
  });
});

describe("resolveVideoIdentity", () => {
  const payload = {
    code: 0,
    data: {
      aid: 60977932,
      bvid: "BV1Jt411P77c",
      cid: 106101299,
      videos: 2,
      pages: [
        {page: 1, cid: 106101299, part: "Introduction"},
        {page: 2, cid: 106132694, part: "Dynamic connectivity"}
      ]
    }
  };

  it("selects the cid belonging to the requested part", () => {
    const identity = resolveVideoIdentity(
      {kind: "video", bvid: "BV1Jt411P77c", pageNumber: 2},
      payload
    );

    expect(identity).toMatchObject({
      pageType: "multipart-video",
      aid: 60977932,
      bvid: "BV1Jt411P77c",
      cid: 106132694,
      pageNumber: 2,
      partTitle: "Dynamic connectivity"
    });
  });

  it("rejects a part missing from metadata", () => {
    expect(() =>
      resolveVideoIdentity({kind: "video", bvid: "BV1Jt411P77c", pageNumber: 8}, payload)
    ).toThrowError(/part 8/i);
  });

  it("rejects metadata for a different BV identifier", () => {
    const mismatched = {
      ...payload,
      data: {...payload.data, bvid: "BV9999999999"}
    };
    expect(() =>
      resolveVideoIdentity({kind: "video", bvid: "BV1Jt411P77c", pageNumber: 1}, mismatched)
    ).toThrowError(/did not match/i);
  });
});

describe("resolveBangumiIdentity", () => {
  const payload = {
    code: 0,
    result: {
      season_id: 42542,
      episodes: [
        {id: 670007, aid: 387410180, bvid: "BV1zd4y1d7kV", cid: 833636899, title: "1"}
      ],
      section: [
        {
          episodes: [
            {
              ep_id: 678060,
              aid: 560363393,
              bvid: "BV19e4y1h7fF",
              cid: 828065295,
              title: "Bonus",
              long_title: "Section episode"
            }
          ]
        }
      ]
    }
  };

  it("finds episode-route entries nested in sections", () => {
    expect(
      resolveBangumiIdentity({kind: "bangumi-episode", episodeId: 678060}, payload)
    ).toMatchObject({
      pageType: "bangumi-episode",
      aid: 560363393,
      bvid: "BV19e4y1h7fF",
      cid: 828065295,
      episodeId: 678060,
      seasonId: 42542,
      resolutionSource: "route"
    });
  });

  it("uses a validated page hint on a season route", () => {
    expect(
      resolveBangumiIdentity(
        {kind: "bangumi-season", seasonId: 42542},
        payload,
        {activeEpisodeId: 678060}
      )
    ).toMatchObject({
      pageType: "bangumi-season",
      episodeId: 678060,
      resolutionSource: "page-hint"
    });
  });

  it("falls back to the first main episode when a season has no valid hint", () => {
    expect(
      resolveBangumiIdentity(
        {kind: "bangumi-season", seasonId: 42542},
        payload,
        {activeEpisodeId: 999999}
      )
    ).toMatchObject({
      episodeId: 670007,
      resolutionSource: "season-default"
    });
  });

  it("rejects metadata for a different season", () => {
    const mismatched = {
      ...payload,
      result: {...payload.result, season_id: 99999}
    };
    expect(() =>
      resolveBangumiIdentity({kind: "bangumi-season", seasonId: 42542}, mismatched)
    ).toThrowError(/did not match/i);
  });
});

describe("findActiveEpisodeIdInPageState", () => {
  it("finds the current episode in nested Next.js data", () => {
    expect(
      findActiveEpisodeIdInPageState({
        props: {pageProps: {queries: [{state: {data: {episode_info: {episode_id: 670007}}}}]}}
      })
    ).toBe(670007);
  });
});
