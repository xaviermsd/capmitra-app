"use client";

import { ToastProvider } from "./Toaster";
import { DialogProvider } from "./Dialog";
import { EditorProvider } from "./editor/EditorContext";
import { Workspace } from "./editor/Workspace";

export default function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <EditorProvider>
          <Workspace />
        </EditorProvider>
      </DialogProvider>
    </ToastProvider>
  );
}
