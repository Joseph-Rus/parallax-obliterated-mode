import { expect, test } from "vite-plus/test";

import { splitFiles, withFiles } from "./uploads";

test("splitFiles takes back what withFiles added, and leaves other text alone (PLX-779)", () => {
  const paths = ["/u/1/paper v3.pdf", "/u/2/notes.md"];
  expect(splitFiles(withFiles("Summarize this.\n\nThanks", paths))).toEqual({
    text: "Summarize this.\n\nThanks",
    paths,
  });
  expect(splitFiles(withFiles("", paths))).toEqual({ text: "", paths });
  expect(splitFiles("Attached files: none")).toEqual({ text: "Attached files: none", paths: [] });
});
