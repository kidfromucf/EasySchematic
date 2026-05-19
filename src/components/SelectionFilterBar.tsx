import { useState, useMemo } from "react";
import { useSchematicStore } from "../store";
import type { SchematicNode, ConnectionEdge } from "../types";
import type { AlignOperation } from "../alignUtils";
import BulkConnectionEditPanel from "./BulkConnectionEditPanel";

type EntityKind = "device" | "room" | "stub-label" | "note" | "annotation" | "waypoint" | "edge";

const KIND_LABELS: Record<EntityKind, { singular: string; plural: string }> = {
  device: { singular: "device", plural: "devices" },
  room: { singular: "room", plural: "rooms" },
  "stub-label": { singular: "stub", plural: "stubs" },
  note: { singular: "note", plural: "notes" },
  annotation: { singular: "annotation", plural: "annotations" },
  waypoint: { singular: "waypoint", plural: "waypoints" },
  edge: { singular: "connection", plural: "connections" },
};

const KIND_ORDER: EntityKind[] = ["device", "room", "edge", "waypoint", "stub-label", "note", "annotation"];

const ALIGN_TOOLS: { op: AlignOperation; title: string }[] = [
  { op: "left", title: "Align selected devices left" },
  { op: "center-h", title: "Align selected devices center" },
  { op: "right", title: "Align selected devices right" },
  { op: "top", title: "Align selected devices top" },
  { op: "middle-v", title: "Align selected devices middle" },
  { op: "bottom", title: "Align selected devices bottom" },
  { op: "distribute-h", title: "Space selected devices evenly horizontally" },
  { op: "distribute-v", title: "Space selected devices evenly vertically" },
];

function ToolIcon({ op }: { op: AlignOperation }) {
  switch (op) {
    case "left":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="1" y="1" width="2" height="14" /><rect x="5" y="3" width="8" height="4" opacity={0.6} /><rect x="5" y="9" width="5" height="4" opacity={0.6} /></svg>;
    case "center-h":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="7" y="1" width="2" height="14" /><rect x="3" y="3" width="10" height="4" opacity={0.6} /><rect x="4" y="9" width="8" height="4" opacity={0.6} /></svg>;
    case "right":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="13" y="1" width="2" height="14" /><rect x="3" y="3" width="8" height="4" opacity={0.6} /><rect x="6" y="9" width="5" height="4" opacity={0.6} /></svg>;
    case "top":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="1" y="1" width="14" height="2" /><rect x="2" y="5" width="4" height="8" opacity={0.6} /><rect x="8" y="5" width="4" height="5" opacity={0.6} /></svg>;
    case "middle-v":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="1" y="7" width="14" height="2" /><rect x="2" y="2" width="4" height="12" opacity={0.6} /><rect x="8" y="4" width="4" height="8" opacity={0.6} /></svg>;
    case "bottom":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="1" y="13" width="14" height="2" /><rect x="2" y="3" width="4" height="8" opacity={0.6} /><rect x="8" y="6" width="4" height="5" opacity={0.6} /></svg>;
    case "distribute-h":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="1" y="1" width="1.5" height="14" /><rect x="13.5" y="1" width="1.5" height="14" /><rect x="4" y="4" width="3" height="8" opacity={0.6} /><rect x="9" y="4" width="3" height="8" opacity={0.6} /></svg>;
    case "distribute-v":
      return <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor"><rect x="1" y="1" width="14" height="1.5" /><rect x="1" y="13.5" width="14" height="1.5" /><rect x="4" y="4" width="8" height="3" opacity={0.6} /><rect x="4" y="9" width="8" height="3" opacity={0.6} /></svg>;
  }
}

function classifyNode(n: SchematicNode): EntityKind | null {
  switch (n.type) {
    case "device": return "device";
    case "room": return "room";
    case "stub-label": return "stub-label";
    case "note": return "note";
    case "annotation": return "annotation";
    case "waypoint": return "waypoint";
    default: return null;
  }
}

export default function SelectionFilterBar() {
  // Serialize selection into a stable string so the selector minimizes re-renders
  const selectionKey = useSchematicStore((s) => {
    let nodeBits = "";
    for (const n of s.nodes) if (n.selected) nodeBits += `${n.id}:${n.type};`;
    let edgeBits = "";
    for (const e of s.edges) if (e.selected) edgeBits += `${e.id};`;
    return `${nodeBits}|${edgeBits}`;
  });

  const counts = useMemo(() => {
    const out: Partial<Record<EntityKind, number>> = {};
    const state = useSchematicStore.getState();
    for (const n of state.nodes) {
      if (!n.selected) continue;
      const k = classifyNode(n);
      if (!k) continue;
      out[k] = (out[k] ?? 0) + 1;
    }
    let edgeCount = 0;
    for (const e of state.edges) if (e.selected) edgeCount++;
    if (edgeCount > 0) out.edge = edgeCount;
    return out;
    // selectionKey is the invalidation signal for this getState() snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const edgeCount = counts.edge ?? 0;
  const deviceCount = counts.device ?? 0;
  const presentKinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0);
  const totalSelected = presentKinds.reduce((sum, k) => sum + (counts[k] ?? 0), 0);

  const [panelOpen, setPanelOpen] = useState(false);
  const alignSelectedDevices = useSchematicStore((s) => s.alignSelectedDevices);

  // Show bar whenever 2+ entities are selected, or the edit panel is pinned open
  if (totalSelected < 2 && !panelOpen) return null;

  const apply = (kind: EntityKind, mode: "deselect" | "solo") => {
    const state = useSchematicStore.getState();
    const matchesNode = (n: SchematicNode) => classifyNode(n) === kind;
    const matchesEdge = (_e: ConnectionEdge) => kind === "edge";

    const newNodes = state.nodes.map((n) => {
      if (!n.selected) return n;
      const isMatch = matchesNode(n);
      const keep = mode === "deselect" ? !isMatch : isMatch;
      return keep ? n : { ...n, selected: false };
    });
    const newEdges = state.edges.map((e) => {
      if (!e.selected) return e;
      const isMatch = matchesEdge(e);
      const keep = mode === "deselect" ? !isMatch : isMatch;
      return keep ? e : { ...e, selected: false };
    });
    useSchematicStore.setState({ nodes: newNodes, edges: newEdges });
  };

  const clearAll = () => {
    const state = useSchematicStore.getState();
    useSchematicStore.setState({
      nodes: state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    });
  };

  return (
    <>
      {panelOpen && <BulkConnectionEditPanel onClose={() => setPanelOpen(false)} />}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[40] flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1.5 px-2 py-1.5 bg-white border border-[var(--color-border)] rounded-lg shadow-lg"
        data-print-hide
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] px-1">
          {totalSelected} selected
        </span>
        {presentKinds.map((kind) => {
            const count = counts[kind] ?? 0;
            const labels = KIND_LABELS[kind];
            const label = count === 1 ? labels.singular : labels.plural;
            return (
              <button
                key={kind}
                title={`Click to keep only ${labels.plural}. ${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}+click to deselect ${labels.plural}.`}
                className="px-2 py-0.5 text-[11px] rounded bg-[var(--color-surface-hover)] hover:bg-blue-50 hover:text-blue-700 border border-[var(--color-border)] transition-colors cursor-pointer"
                onClick={(e) => {
                  const deselect = e.metaKey || e.ctrlKey;
                  apply(kind, deselect ? "deselect" : "solo");
                }}
              >
                {count} {label}
              </button>
            );
          })}
        {deviceCount >= 2 && (
          <>
            <div className="w-px h-5 bg-[var(--color-border)] mx-0.5" />
            <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] px-0.5">
              Align
            </span>
            <div className="flex items-center gap-0.5">
              {ALIGN_TOOLS.slice(0, 6).map((tool) => (
                <button
                  key={tool.op}
                  title={tool.title}
                  className="w-6 h-6 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text)] bg-white hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer"
                  onClick={() => alignSelectedDevices(tool.op)}
                >
                  <ToolIcon op={tool.op} />
                </button>
              ))}
            </div>
          </>
        )}
        {deviceCount >= 3 && (
          <>
            <div className="w-px h-5 bg-[var(--color-border)] mx-0.5" />
            <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] px-0.5">
              Space
            </span>
            <div className="flex items-center gap-0.5">
              {ALIGN_TOOLS.slice(6).map((tool) => (
                <button
                  key={tool.op}
                  title={tool.title}
                  className="w-6 h-6 flex items-center justify-center rounded border border-[var(--color-border)] text-[var(--color-text)] bg-white hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer"
                  onClick={() => alignSelectedDevices(tool.op)}
                >
                  <ToolIcon op={tool.op} />
                </button>
              ))}
            </div>
          </>
        )}
        {(edgeCount >= 2 || panelOpen) && (
          <button
            title="Edit properties of selected connections"
            className={`px-2 py-0.5 text-[11px] rounded border transition-colors cursor-pointer ${
              panelOpen
                ? "bg-blue-600 text-white border-blue-600"
                : "text-blue-700 border-blue-300 bg-blue-50 hover:bg-blue-100"
            }`}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {edgeCount >= 2 ? `Edit ${edgeCount}…` : "Edit connections…"}
          </button>
        )}
        {totalSelected > 0 && (
          <button
            title="Clear selection (Esc)"
            className="px-2 py-0.5 text-[11px] rounded text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            onClick={clearAll}
          >
            ✕ Clear
          </button>
        )}
      </div>
    </>
  );
}
