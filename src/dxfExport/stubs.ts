import type { ReactFlowInstance } from "@xyflow/react";
import type { ConnectionEdge, DeviceData, SchematicNode, StubLabelData, StubLabelPageMode } from "../types";
import { computePageGrid } from "../printPageGrid";
import { getPaperSize } from "../printConfig";
import { resolvePortLabel } from "../packList";
import type { DxfWriter, EntityStyle } from "./writer";
import { cssFontPxToDxfHeight, pxToIn, rgbToTrueColor } from "./units";
import { CANONICAL_LAYERS, hexToTrueColor, resolveSignalColor } from "./layers";

const STUB_HEIGHT_PX = 14;
const STUB_RADIUS_PX = 2;
const STUB_TEXT_PX = 9;
const STUB_PAD_X_PX = 4;

type StubExportOptions = {
  signalColors?: Partial<Record<StubLabelData["signalType"], string>>;
  stubLabelShowPort: boolean;
  stubLabelShowRoom: boolean;
  stubLabelPageMode: StubLabelPageMode;
  printView: boolean;
  printPaperId: string;
  printCustomWidthIn?: number;
  printCustomHeightIn?: number;
  printOrientation: "portrait" | "landscape";
  printScale: number;
  titleBlockLayoutHeightIn: number;
  printOriginOffsetX: number;
  printOriginOffsetY: number;
};

function absolutePos(node: SchematicNode | undefined, nodeMap: Map<string, SchematicNode>): { x: number; y: number } {
  if (!node) return { x: 0, y: 0 };
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function findOwnEdge(stubId: string, side: StubLabelData["side"], edges: ConnectionEdge[]): ConnectionEdge | undefined {
  return edges.find((e) => side === "source" ? e.target === stubId : e.source === stubId);
}

function findPartnerStub(
  linkedConnectionId: string,
  side: StubLabelData["side"],
  nodes: SchematicNode[],
): SchematicNode | undefined {
  const otherSide = side === "source" ? "target" : "source";
  return nodes.find((n) =>
    n.type === "stub-label" &&
    (n.data as StubLabelData).linkedConnectionId === linkedConnectionId &&
    (n.data as StubLabelData).side === otherSide
  );
}

function estimateStubWidth(text: string): number {
  return Math.max(80, text.length * STUB_TEXT_PX * 0.58 + STUB_PAD_X_PX * 2 + 2);
}

function arrowFor(dx: number, dy: number): string {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "\u2192" : "\u2190";
  return dy >= 0 ? "\u2193" : "\u2191";
}

function resolveStubText(
  node: SchematicNode,
  data: StubLabelData,
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
  options: StubExportOptions,
): string {
  const ownEdge = findOwnEdge(node.id, data.side, edges);
  if (!ownEdge) return "?";

  const partnerEdge = edges.find(
    (e) => e.data?.linkedConnectionId === data.linkedConnectionId && e.id !== ownEdge.id,
  );
  if (!partnerEdge) return "?";

  const farDeviceId = data.side === "source" ? partnerEdge.target : partnerEdge.source;
  const farHandleId = data.side === "source" ? partnerEdge.targetHandle : partnerEdge.sourceHandle;
  const farDevice = nodes.find((n) => n.id === farDeviceId);
  if (!farDevice) return "?";

  const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));
  const partnerStub = findPartnerStub(data.linkedConnectionId, data.side, nodes);
  const myAbs = absolutePos(node, nodeMap);
  const partnerAbs = partnerStub ? absolutePos(partnerStub, nodeMap) : myAbs;
  const arrow = arrowFor(partnerAbs.x - myAbs.x, partnerAbs.y - myAbs.y);

  const farLabel = ((farDevice.data as DeviceData).label as string | undefined) ?? "";
  const farRoom = farDevice.parentId ? nodes.find((n) => n.id === farDevice.parentId) : null;
  const farRoomLabel = ((farRoom?.data as Record<string, unknown> | undefined)?.label as string | undefined) ?? "";
  const farPort = resolvePortLabel(farDevice, farHandleId ?? null);

  let myPage = "";
  let farPage = "";
  if (options.printView) {
    const paperSize = getPaperSize(options.printPaperId, options.printCustomWidthIn, options.printCustomHeightIn);
    const pages = computePageGrid(
      paperSize,
      options.printOrientation,
      options.printScale,
      nodes,
      options.titleBlockLayoutHeightIn,
      options.printOriginOffsetX,
      options.printOriginOffsetY,
    );
    if (pages.length > 1) {
      const findPage = (x: number, y: number) => {
        for (const p of pages) {
          if (x >= p.x && x < p.x + p.widthPx && y >= p.y && y < p.y + p.heightPx) return p.index + 1;
        }
        return 0;
      };
      const farAbs = absolutePos(farDevice, nodeMap);
      const mp = findPage(myAbs.x, myAbs.y);
      const fp = findPage(farAbs.x, farAbs.y);
      if (mp > 0) myPage = String(mp);
      if (fp > 0) farPage = String(fp);
    }
  }

  const showPort = data.showPort ?? options.stubLabelShowPort;
  const showRoom = data.showRoom ?? options.stubLabelShowRoom;
  const pageMode = data.pageMode ?? options.stubLabelPageMode;

  let text = `${arrow} ${farLabel}`;
  if (showPort && farPort) text += ` [${farPort}]`;
  if (showRoom && farRoomLabel) text += ` (${farRoomLabel})`;
  const showPage = !!farPage && (
    pageMode === "always" ||
    (pageMode === "cross-page" && farPage !== myPage)
  );
  if (showPage) text += ` Pg ${farPage}`;
  return text;
}

/** Emit the visible stub-label badge: white fill, signal-color border, and text. */
export function emitStubLabel(
  writer: DxfWriter,
  node: SchematicNode,
  rfInstance: ReactFlowInstance,
  nodes: SchematicNode[],
  edges: ConnectionEdge[],
  options: StubExportOptions,
) {
  if (node.type !== "stub-label") return;
  const internal = rfInstance.getInternalNode(node.id);
  if (!internal) return;

  const data = node.data as StubLabelData;
  const text = resolveStubText(node, data, nodes, edges, options);
  const ax = internal.internals.positionAbsolute.x;
  const ay = internal.internals.positionAbsolute.y;
  const w = node.measured?.width ?? estimateStubWidth(text);
  const h = node.measured?.height ?? STUB_HEIGHT_PX;

  const x = pxToIn(ax);
  const y = -pxToIn(ay + h);
  const width = pxToIn(w);
  const height = pxToIn(h);
  const signalHex = resolveSignalColor(data.signalType, options.signalColors);
  const borderStyle: EntityStyle = { trueColor: hexToTrueColor(signalHex) };

  writer.addSolidHatchRect(
    CANONICAL_LAYERS.LABELS,
    x,
    y,
    width,
    height,
    { trueColor: rgbToTrueColor(255, 255, 255) },
  );
  writer.addRoundedRect(CANONICAL_LAYERS.LABELS, x, y, width, height, pxToIn(STUB_RADIUS_PX), borderStyle);
  writer.addText(
    CANONICAL_LAYERS.LABELS,
    x + width / 2,
    y + height / 2,
    text,
    {
      height: cssFontPxToDxfHeight(STUB_TEXT_PX),
      align: "center",
      vAlign: "middle",
      style: { trueColor: rgbToTrueColor(55, 65, 81) },
    },
  );
}
