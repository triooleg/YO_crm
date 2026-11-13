"use client";

import { useLayoutEffect, useRef } from "react";

/** Keep the native table header in its horizontal scroller; only move it vertically. */
export function useStickyListControls(tableRevision?: unknown) {
  const workspaceRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const controls = controlsRef.current;
    const scroller = workspace?.closest<HTMLElement>(".crm-content");
    if (!workspace || !controls || !scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = controls.getBoundingClientRect().height;
      workspace.style.setProperty("--list-controls-height", `${height}px`);
      workspace.style.setProperty("--list-viewport-height", `${scroller.clientHeight}px`);
      const table = tableRef.current;
      const header = table?.tHead;
      if (!table || !header) return;
      workspace.style.setProperty("--list-header-height", `${header.offsetHeight}px`);
      const top = scroller.getBoundingClientRect().top + scroller.clientTop + height;
      const shift = Math.max(0, Math.min(top - table.getBoundingClientRect().top,
        table.offsetHeight - header.offsetHeight));
      header.style.setProperty("--list-header-shift", `${shift}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(controls);
    observer.observe(scroller);
    // Includes appended rows and column/wrapping changes, without a second table.
    observer.observe(workspace);
    scroller.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, [tableRevision]);

  return { workspaceRef, controlsRef, tableRef };
}
