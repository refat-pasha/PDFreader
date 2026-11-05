import { useEffect } from "react";
import { activePane, activeDocumentMeta, useWorkspace } from "../workspace/store";
import type { Tool } from "../../types";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

type Handlers = {
  open: () => void;
  save: () => void;
  saveAs: () => void;
  exportFile: () => void;
  print: () => void;
  find: () => void;
  commandPalette: () => void;
  toggleShortcuts: () => void;
  insertImage: () => void;
};

export function useKeyboard(handlers: Handlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useWorkspace.getState();
      const mod = event.ctrlKey || event.metaKey;
      const pane = activePane(state);
      const doc = activeDocumentMeta(state);
      const editable = isEditable(event.target);
      const key = event.key.toLowerCase();

      if (mod && key === "o") { event.preventDefault(); handlers.open(); return; }
      if (mod && key === "s") { event.preventDefault(); if (event.shiftKey) handlers.saveAs(); else handlers.save(); return; }
      if (mod && key === "p") { event.preventDefault(); handlers.print(); return; }
      if (mod && key === "f") { event.preventDefault(); handlers.find(); return; }
      if (mod && key === "k") { event.preventDefault(); handlers.commandPalette(); return; }
      if (mod && event.shiftKey && key === "e") { event.preventDefault(); handlers.exportFile(); return; }
      if (mod && event.shiftKey && key === "i") { event.preventDefault(); handlers.insertImage(); return; }
      if (mod && key === "m") {
        event.preventDefault();
        state.setSidebar("notes");
        state.setRightPanel("notes");
        return;
      }
      if (event.key === "F1") { event.preventDefault(); handlers.toggleShortcuts(); return; }
      if (event.key === "F11") {
        event.preventDefault();
        state.toggleFocusMode();
        return;
      }
      if (mod && key === "w") {
        event.preventDefault();
        if (pane.activeDocId) state.closeTab(pane.id, pane.activeDocId);
        return;
      }
      if (mod && key === "tab") {
        event.preventDefault();
        const order = state.panes;
        const index = order.findIndex((p) => p.id === state.activePaneId);
        const direction = event.shiftKey ? -1 : 1;
        state.setActivePane(order[(index + direction + order.length) % order.length].id);
        return;
      }
      if (mod && event.key === "\\") {
        event.preventDefault();
        state.splitPane(pane.id);
        return;
      }
      if (mod && key === "z") {
        if (editable) return;
        event.preventDefault();
        if (doc) state.undo(doc.id);
        return;
      }
      if (mod && key === "y") {
        if (editable) return;
        event.preventDefault();
        if (doc) state.redoAction(doc.id);
        return;
      }
      if (mod && (event.key === "+" || event.key === "=")) { event.preventDefault(); state.setZoom(pane.id, pane.view.scale * 1.2); return; }
      if (mod && event.key === "-") { event.preventDefault(); state.setZoom(pane.id, pane.view.scale / 1.2); return; }
      if (mod && event.key === "0") { event.preventDefault(); state.setZoom(pane.id, 1, "custom"); return; }
      if (mod && event.key === "1") { event.preventDefault(); state.setZoom(pane.id, 1, "fit-width"); return; }
      if (mod && event.key === "2") { event.preventDefault(); state.setZoom(pane.id, 1, "fit-page"); return; }
      if (event.altKey && /^[1-4]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (state.panes[index]) {
          event.preventDefault();
          state.setActivePane(state.panes[index].id);
        }
        return;
      }
      if (mod && event.key === "Home" && doc) { event.preventDefault(); state.setPage(pane.id, 1, doc.pageCount); return; }
      if (mod && event.key === "End" && doc) { event.preventDefault(); state.setPage(pane.id, doc.pageCount, doc.pageCount); return; }

      if (editable) return;

      if (event.key === "PageUp" && doc) { event.preventDefault(); state.setPage(pane.id, pane.view.page - 1, doc.pageCount); return; }
      if (event.key === "PageDown" && doc) { event.preventDefault(); state.setPage(pane.id, pane.view.page + 1, doc.pageCount); return; }
      if (event.key === "ArrowLeft" && doc) { event.preventDefault(); state.setPage(pane.id, pane.view.page - 1, doc.pageCount); return; }
      if (event.key === "ArrowRight" && doc) { event.preventDefault(); state.setPage(pane.id, pane.view.page + 1, doc.pageCount); return; }

      const toolMap: Record<string, Tool> = {
        v: "select",
        d: "pen",
        h: "highlighter",
        n: "note",
        t: "text",
        e: "eraser",
        m: "rect",
      };
      if (!mod && !event.altKey && !event.shiftKey && toolMap[key]) {
        event.preventDefault();
        state.setActiveTool(toolMap[key]);
        if (toolMap[key] === "pen" || toolMap[key] === "highlighter") state.setPaletteOpen(true);
        return;
      }
      if (event.key === "Escape") {
        if (state.paletteOpen) { state.setPaletteOpen(false); return; }
        if (state.activeTool !== "select") { state.setActiveTool("select"); return; }
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !editable) {
        // Selection is owned by the annotation layer; this is a safe no-op fallback.
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
