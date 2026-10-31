/**
 * Saving straight to a file without double-closing it.
 *
 * mediabunny's StreamTarget takes a lock on the stream it is given and closes
 * it itself when the video is finalised, and closes it again (committing a
 * half-written file) when an export is cancelled. Handing it the file stream
 * from the save dialog directly therefore meant (1) our own `close()`
 * afterwards threw "Cannot close a locked stream" after a successful export,
 * and (2) a cancelled export could leave a broken file behind.
 *
 * Here the engine writes into a pass-through stream whose close() does
 * nothing. We commit the real file only once the video is fully finalised
 * (`commit`), or throw the partial file away (`discard`).
 */
export interface SaveSink {
  /** Give this to the export engine. */
  stream: WritableStream;
  /** The engine has finished: write the file to disk (the browser commits it now). */
  commit: () => Promise<void>;
  /** Something went wrong or the export was cancelled: drop the partial file. */
  discard: () => Promise<void>;
}

export function saveSink(file: FileSystemWritableFileStream): SaveSink {
  let settled = false;
  let failed: unknown = null;
  const stream = new WritableStream({
    // StreamTarget writes { type: "write", data, position } chunks, which the file stream accepts as they are
    write: async (chunk) => {
      try { await file.write(chunk as FileSystemWriteChunkType); } catch (e) { failed = e; throw e; }
    },
    close: () => { /* the engine finished writing; the file is committed by commit() */ },
    abort: () => { /* handled by discard() */ },
  });
  return {
    stream,
    commit: async () => {
      if (settled) return;
      settled = true;
      if (failed) throw failed;
      await file.close();
    },
    discard: async () => {
      if (settled) return;
      settled = true;
      try { await file.abort(); } catch { /* already closed */ }
    },
  };
}
