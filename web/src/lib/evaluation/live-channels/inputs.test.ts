import { describe, expect, it } from "vitest";
import {
  parseLiveChannelsInputs,
  resolveInputsSource,
  type LiveChannelsInput,
} from "./inputs";
import exampleFixture from "../__fixtures__/live-channels-eval-inputs.example.json";

describe("parseLiveChannelsInputs", () => {
  it("parses the checked-in example file into the expected shape (7 inputs, DOIs normalized)", () => {
    const { inputs, droppedSeedDois } = parseLiveChannelsInputs(exampleFixture);
    expect(inputs).toHaveLength(7);
    expect(droppedSeedDois).toHaveLength(0);
    const battery = inputs.find((i) => i.id === "battery-materials-profile");
    expect(battery).toBeDefined();
    expect(battery?.topics).toEqual([
      "battery materials",
      "solid-state electrolytes",
    ]);
    expect(battery?.seedDois).toEqual([
      "10.1021/cm901452z",
      "10.1038/451652a",
      "10.1038/35104644",
    ]);
    const starter = inputs.find((i) => i.id === "starter-machine-learning");
    expect(starter?.topics).toEqual(["machine learning"]);
    expect(starter?.seedDois).toEqual([]);
    expect(starter?.topicIds).toEqual([]);
  });

  it("drops a malformed seed DOI, reports input id + original string + reason, and keeps the well-formed ones", () => {
    const { inputs, droppedSeedDois } = parseLiveChannelsInputs({
      version: 1,
      inputs: [
        {
          id: "mixed-seeds",
          topics: ["battery materials"],
          seedDois: ["10.1038/451652a", "not-a-doi", "", "10.1021/cm901452z"],
          topicIds: [],
        },
      ],
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0].seedDois).toEqual(["10.1038/451652a", "10.1021/cm901452z"]);
    expect(droppedSeedDois).toHaveLength(2);
    expect(droppedSeedDois).toContainEqual({
      inputId: "mixed-seeds",
      doi: "not-a-doi",
      reason: "malformed DOI shape",
    });
    expect(droppedSeedDois).toContainEqual({
      inputId: "mixed-seeds",
      doi: "",
      reason: "malformed DOI shape",
    });
  });

  it("normalizes a doi.org URL / mixed-case DOI rather than dropping it", () => {
    const { inputs, droppedSeedDois } = parseLiveChannelsInputs({
      inputs: [
        {
          id: "url-doi",
          topics: ["x"],
          seedDois: ["https://doi.org/10.1038/451652A"],
          topicIds: [],
        },
      ],
    });
    expect(droppedSeedDois).toHaveLength(0);
    expect(inputs[0].seedDois).toEqual(["10.1038/451652a"]);
  });

  it("an input with seedDois: [] parses to zero seed DOIs and zero drops (no seed-channel attempts downstream)", () => {
    const { inputs, droppedSeedDois } = parseLiveChannelsInputs({
      inputs: [
        { id: "no-seeds", topics: ["quantum computing"], seedDois: [], topicIds: [] },
      ],
    });
    expect(inputs).toEqual<LiveChannelsInput[]>([
      { id: "no-seeds", topics: ["quantum computing"], seedDois: [], topicIds: [] },
    ]);
    expect(droppedSeedDois).toEqual([]);
  });

  it("never throws on a malformed top-level shape; degrades to zero inputs", () => {
    expect(parseLiveChannelsInputs(null)).toEqual({ inputs: [], droppedSeedDois: [] });
    expect(parseLiveChannelsInputs(undefined)).toEqual({ inputs: [], droppedSeedDois: [] });
    expect(parseLiveChannelsInputs("not an object")).toEqual({
      inputs: [],
      droppedSeedDois: [],
    });
    expect(parseLiveChannelsInputs({ inputs: "not an array" })).toEqual({
      inputs: [],
      droppedSeedDois: [],
    });
    expect(parseLiveChannelsInputs({})).toEqual({ inputs: [], droppedSeedDois: [] });
  });

  it("skips an input entry with no non-empty id rather than inventing one", () => {
    const { inputs } = parseLiveChannelsInputs({
      inputs: [
        { topics: ["x"], seedDois: [], topicIds: [] },
        { id: "  ", topics: ["y"], seedDois: [], topicIds: [] },
        { id: "kept", topics: ["z"], seedDois: [], topicIds: [] },
      ],
    });
    expect(inputs.map((i) => i.id)).toEqual(["kept"]);
  });
});

describe("resolveInputsSource", () => {
  const cwd = "/repo/web";

  it("prefers PEER_LIVE_CHANNELS_INPUTS_PATH when set, without checking the filesystem", () => {
    const exists = () => {
      throw new Error("must not check existence when an env override is set");
    };
    const source = resolveInputsSource(
      { PEER_LIVE_CHANNELS_INPUTS_PATH: "/custom/path.json" },
      exists,
      cwd,
    );
    expect(source).toEqual({ path: "/custom/path.json", label: "env override" });
  });

  it("falls back to the local override when it exists and no env var is set", () => {
    const source = resolveInputsSource({}, (p) => p.includes(".local-data"), cwd);
    expect(source.label).toBe("local override");
    expect(source.path).toContain(".local-data");
  });

  it("falls back to the checked-in example when neither an env var nor a local override exists", () => {
    const source = resolveInputsSource({}, () => false, cwd);
    expect(source.label).toBe("checked-in example");
    expect(source.path).toContain("live-channels-eval-inputs.example.json");
  });
});
