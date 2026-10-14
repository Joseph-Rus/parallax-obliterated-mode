// Files attached to a message that aren't images (PLX-779, decision 0071): plxd saves each on the
// host with `host/upload`, and the message lists their paths for the agent to read.
import type { ConnectionState } from "../preload/bridge";
import { describeError } from "./errors";

/** The `fileUploads` cap on one file's base64. Undefined while the host isn't connected, or when its plxd takes no files. */
export function uploadBytes(connection?: ConnectionState): number | undefined {
  const max =
    connection?.status === "connected"
      ? connection.capabilities["fileUploads"]?.["maxBytes"]
      : undefined;
  return typeof max === "number" ? max : undefined;
}

/** How long `file`'s base64 is, which the cap is measured on. */
export const base64Length = (file: Blob) => Math.ceil(file.size / 3) * 4;

/** Saves each of `files` on the host, in order, and resolves to their paths there, or to why not. */
export async function uploadFiles(hostId: string, files: File[]): Promise<string[] | string> {
  const paths: string[] = [];
  for (const file of files) {
    const answer = await window.parallax.request(hostId, "host/upload", {
      name: file.name,
      data: await base64Of(file),
    });
    if ("error" in answer) return `${file.name} couldn't be sent: ${describeError(answer.error)}`;
    paths.push(answer.result.path);
  }
  return paths;
}

/** `text` as the agent gets it: the paths of the files sent with it listed after it. */
export function withFiles(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const list = `Attached files:\n${paths.map((p) => `- ${p}`).join("\n")}`;
  return text.trim() ? `${text}\n\n${list}` : list;
}

function base64Of(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // `data:<type>;base64,<data>`
    reader.onload = () => resolve((reader.result as string).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("couldn't read the file"));
    reader.readAsDataURL(file);
  });
}
