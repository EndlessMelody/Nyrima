import { beforeEach, describe, expect, it } from "vitest";
import { useLocalLibraryStore } from "./local-library-store";
import { localLibrary } from "./local-source";

/** A `File` with `webkitRelativePath` set, as `<input webkitdirectory>` produces. */
function virtualFile(relativePath: string, content = "x"): File {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = new File([content], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

function fileList(files: File[]): FileList {
  return files as unknown as FileList;
}

const initialState = useLocalLibraryStore.getInitialState();

beforeEach(() => {
  useLocalLibraryStore.setState(initialState, true);
  localLibrary.setRoot(null);
});

describe("connectVirtualDirectory", () => {
  it("indexes a webkitdirectory FileList in memory, marking the root virtual", async () => {
    await useLocalLibraryStore.getState().connectVirtualDirectory(
      fileList([
        virtualFile("My Library/Movies/Episode 01.mkv"),
        virtualFile("My Library/Music/Track 01.flac"),
      ]),
    );

    const state = useLocalLibraryStore.getState();
    expect(state.status).toBe("ready");
    expect(state.isVirtualRoot).toBe(true);
    expect(state.rootName).toBe("My Library");
    expect(state.scans.movies?.files.length).toBe(1);
    expect(state.scans.music?.files.length).toBe(1);
  });

  it("is a no-op for an empty FileList", async () => {
    await useLocalLibraryStore.getState().connectVirtualDirectory(fileList([]));

    const state = useLocalLibraryStore.getState();
    expect(state.status).toBe(initialState.status);
    expect(state.isVirtualRoot).toBe(false);
  });
});

describe("rescan with a virtual root", () => {
  it("re-walks the in-memory tree without touching IDB", async () => {
    await useLocalLibraryStore.getState().connectVirtualDirectory(
      fileList([virtualFile("My Library/Movies/Episode 01.mkv")]),
    );

    await useLocalLibraryStore.getState().rescan();

    const state = useLocalLibraryStore.getState();
    expect(state.status).toBe("ready");
    expect(state.isVirtualRoot).toBe(true);
    expect(state.rootName).toBe("My Library");
    expect(state.scans.movies?.files.length).toBe(1);
  });
});

describe("disconnect after a virtual root", () => {
  it("clears scans and the virtual flag", async () => {
    await useLocalLibraryStore.getState().connectVirtualDirectory(
      fileList([virtualFile("My Library/Movies/Episode 01.mkv")]),
    );

    await useLocalLibraryStore.getState().disconnect();

    const state = useLocalLibraryStore.getState();
    expect(state.isVirtualRoot).toBe(false);
    expect(state.rootName).toBe("");
    expect(state.scans).toEqual({});
    expect(localLibrary.hasRoot()).toBe(false);
  });
});
