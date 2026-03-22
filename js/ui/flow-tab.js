// Progression graph — JointJS + DirectedGraph (dagre) layout
/* global joint */

import * as data from "../data-loader.js";
import { goodName, buildingName } from "./components.js";

const NODE_HEIGHT = 24, TEXT_PADDING = 14;
const ACCENT_COLOR = "#c8a050", TEXT_COLOR = "#e0e0e0";
const EDGE_COLOR = "#555", BUILDCOST_COLOR = "#7a6a9a";
const EDGE_HIGHLIGHT = "#88bb88", BUILDCOST_HIGHLIGHT = "#bb88cc";

const NODE_STYLES = {
  good:     { fill: "#1a2818", stroke: "#6aaa4a" },
  building: { fill: "#1e1e28", stroke: "#8080a0" },
  nature:   { fill: "#28231a", stroke: "#a0884a" },
};

// Custom JointJS element with <path> body for varied shapes
const FlowNode = joint.dia.Element.define("flow.Node", {
  attrs: {
    body: { strokeWidth: 1.5, cursor: "pointer" },
    label: {
      x: "calc(0.5*w)", y: "calc(0.5*h)",
      textVerticalAnchor: "middle", textAnchor: "middle",
      fill: TEXT_COLOR, fontSize: 11,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      pointerEvents: "none",
    },
  },
}, { markup: joint.util.svg`<path @selector="body"/><text @selector="label"/>` });

// --- Libavoid edge routing ---

let Avoid = null;

async function loadLibavoid() {
  await import("https://cdn.jsdelivr.net/npm/libavoid-js@0.4.5/+esm").then(async mod => {
    const avoidLib = mod.AvoidLib || mod.default;
    await avoidLib.load("https://cdn.jsdelivr.net/npm/libavoid-js@0.4.5/dist/libavoid.wasm");
    Avoid = avoidLib.getInstance();
  }).catch(err => console.warn("libavoid unavailable:", err));
}

function routeAllLinks(extraEdges = []) {
  if (!Avoid) return;
  const router = new Avoid.Router(Avoid.OrthogonalRouting);
  router.setRoutingParameter(Avoid.idealNudgingDistance, 10);
  router.setRoutingParameter(Avoid.shapeBufferDistance, 6);
  router.setRoutingOption(Avoid.nudgeSharedPathsWithCommonEndPoint, true);
  router.setRoutingOption(Avoid.nudgeOrthogonalSegmentsConnectedToShapes, true);
  router.setRoutingOption(Avoid.performUnifyingNudgingPreprocessingStep, true);

  const shapeRefs = {};
  for (const [nodeId, element] of cellMap) {
    const { x, y } = element.position(), { width, height } = element.size();
    const ref = new Avoid.ShapeRef(router,
      new Avoid.Rectangle(new Avoid.Point(x, y), new Avoid.Point(x + width, y + height)));
    const pin = new Avoid.ShapeConnectionPin(ref, 1, 0.5, 0.5, true, 0, Avoid.ConnDirAll);
    pin.setExclusive(false);
    shapeRefs[nodeId] = ref;
  }

  const allEdges = [...edgeCells, ...extraEdges];
  const connections = [];
  for (const { link, edge } of allEdges) {
    const sourceRef = shapeRefs[edge.from], targetRef = shapeRefs[edge.to];
    if (!sourceRef || !targetRef) continue;
    const connRef = new Avoid.ConnRef(router);
    connRef.setSourceEndpoint(new Avoid.ConnEnd(sourceRef, 1));
    connRef.setDestEndpoint(new Avoid.ConnEnd(targetRef, 1));
    connections.push({ connRef, link, edge });
  }

  router.processTransaction();

  for (const { connRef, link, edge } of connections) {
    const route = connRef.displayRoute(), routeSize = route.size();
    if (routeSize < 2) continue;
    const vertices = [];
    for (let i = 1; i < routeSize - 1; i++) {
      const point = route.get_ps(i);
      vertices.push({ x: point.x, y: point.y });
    }
    const sourcePoint = route.get_ps(0), targetPoint = route.get_ps(routeSize - 1);
    const sourceCenter = cellMap.get(edge.from).getBBox().center();
    const targetCenter = cellMap.get(edge.to).getBBox().center();
    link.set({
      vertices, router: null,
      source: { id: cellMap.get(edge.from).id, anchor: { name: "modelCenter", args: { dx: sourcePoint.x - sourceCenter.x, dy: sourcePoint.y - sourceCenter.y } } },
      target: { id: cellMap.get(edge.to).id, anchor: { name: "modelCenter", args: { dx: targetPoint.x - targetCenter.x, dy: targetPoint.y - targetCenter.y } } },
    });
  }
}

// --- Module state ---

let selectedNodeId = null, currentSearch = "", graphData = null;
let paper = null, jGraph = null;
let cellMap = new Map(), edgeCells = [], tempLinks = [];
let wheelAbort = null;
const advancedMode = new URLSearchParams(location.search).get("advanced-graph-controls") === "1";

// --- Public API ---

export async function initFlowTab() {
  document.getElementById("flow-search").addEventListener("input", evt => {
    currentSearch = evt.target.value.toLowerCase();
    if (!selectedNodeId) applySearch();
  });
  document.getElementById("flow-reset-view").addEventListener("click", () => {
    selectedNodeId = null;
    currentSearch = "";
    document.getElementById("flow-search").value = "";
    applyHighlight();
    if (paper) paper.transformToFitContent({ padding: 20 });
  });
  await loadLibavoid();
}

export async function renderFlowTab() {
  const common = data.getCommon(), faction = data.getFaction();
  if (!common || !faction) return;

  graphData = buildGraph(common, faction);
  selectedNodeId = null;
  currentSearch = "";
  document.getElementById("flow-search").value = "";
  await renderWithJointJS();
}

// --- Graph construction ---

function getYieldsByResourceGroup(naturalResources) {
  const groups = new Map();
  function addYield(group, goodId) {
    if (!groups.has(group)) groups.set(group, new Set());
    groups.get(group).add(goodId);
  }
  for (const crop of Object.values(naturalResources.crops)) addYield(crop.resourceGroup, crop.yield.id);
  for (const tree of Object.values(naturalResources.trees)) {
    addYield(tree.resourceGroup, tree.yield.id);
    if (tree.gatherableYield) addYield(tree.gatherableYield.resourceGroup, tree.gatherableYield.id);
  }
  for (const bush of Object.values(naturalResources.bushes)) addYield(bush.resourceGroup, bush.yield.id);
  // Scrap metal comes from ruins, not a natural resource blueprint
  addYield("Ruin", "ScrapMetal");
  return groups;
}

function deduplicateBuildings(common, faction) {
  // Group buildings by their "signature" — the set of goods they produce
  // (or the resource group they harvest). Keep only the lowest scienceCost
  // building in each group.
  const dominated = new Set();

  // Recipe buildings: group by produced good IDs
  const byProducts = new Map();
  for (const [buildingId, building] of Object.entries(faction.buildings)) {
    const products = new Set();
    for (const rid of building.recipeIds) {
      const r = common.recipes[rid];
      if (r) for (const p of r.products) products.add(p.id);
    }
    if (products.size === 0) continue;
    const key = [...products].sort().join(",");
    if (!byProducts.has(key)) byProducts.set(key, []);
    byProducts.get(key).push(buildingId);
  }
  for (const group of byProducts.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => faction.buildings[a].scienceCost - faction.buildings[b].scienceCost);
    for (let i = 1; i < group.length; i++) dominated.add(group[i]);
  }

  // Harvester buildings: group by resource group
  const byResourceGroup = new Map();
  for (const [buildingId, building] of Object.entries(faction.buildings)) {
    const rg = building.yieldRemovingResourceGroup;
    if (!rg) continue;
    if (!byResourceGroup.has(rg)) byResourceGroup.set(rg, []);
    byResourceGroup.get(rg).push(buildingId);
  }
  for (const group of byResourceGroup.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => faction.buildings[a].scienceCost - faction.buildings[b].scienceCost);
    for (let i = 1; i < group.length; i++) dominated.add(group[i]);
  }

  return dominated;
}

function buildGraph(common, faction) {
  const nodes = new Map(), edgeMap = new Map();
  const yieldsByGroup = getYieldsByResourceGroup(common.naturalResources);
  const dominated = deduplicateBuildings(common, faction);

  for (const [buildingId, building] of Object.entries(faction.buildings)) {
    if (dominated.has(buildingId)) continue;
    // Harvester buildings — yield goods from natural resources
    const resourceGroup = building.yieldRemovingResourceGroup;
    if (resourceGroup && yieldsByGroup.has(resourceGroup)) {
      const nodeId = `bldg:${buildingId}`;
      nodes.set(nodeId, { id: nodeId, displayName: buildingName(building), nodeType: "building", groupId: null, isSource: true });
      for (const goodId of yieldsByGroup.get(resourceGroup)) addEdge(edgeMap, nodeId, goodId, null, "recipe");
      for (const cost of building.buildingCost) addEdge(edgeMap, cost.id, nodeId, null, "buildcost");
      continue;
    }

    // Recipe buildings
    const recipes = building.recipeIds.map(recipeId => common.recipes[recipeId])
      .filter(recipe => recipe && (recipe.ingredients.length > 0 || recipe.products.length > 0));
    if (!recipes.length) continue;

    const nodeId = `bldg:${buildingId}`;
    nodes.set(nodeId, { id: nodeId, displayName: buildingName(building), nodeType: "building", groupId: null, isSource: false });

    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredients) addEdge(edgeMap, ingredient.id, nodeId, recipe, "recipe");
      for (const product of recipe.products) addEdge(edgeMap, nodeId, product.id, recipe, "recipe");
    }
    for (const cost of building.buildingCost) addEdge(edgeMap, cost.id, nodeId, null, "buildcost");
  }

  const edges = Array.from(edgeMap.values());
  const goodIds = new Set();
  for (const edge of edges) {
    if (!edge.from.startsWith("bldg:")) goodIds.add(edge.from);
    if (!edge.to.startsWith("bldg:")) goodIds.add(edge.to);
  }

  const availableGoods = new Set(faction.availableGoodIds);
  for (const goodId of goodIds) {
    if (!availableGoods.has(goodId)) continue;
    const good = common.goods[goodId];
    if (!good) continue;
    nodes.set(goodId, {
      id: goodId, displayName: goodName(good), nodeType: "good", groupId: good.goodGroupId,
      isSource: data.getNaturalResourcesByYield(goodId).length > 0 ||
        data.getRecipesByProduct(goodId).some(recipeId => {
          const recipe = common.recipes[recipeId]; return recipe && !recipe.ingredients.length && !recipe.fuel;
        }),
    });
  }

  const validEdges = edges.filter(edge => nodes.has(edge.from) && nodes.has(edge.to));
  breakCycles(validEdges);
  const redundant = computeRedundantEdges(validEdges);
  for (const edge of validEdges) edge.isRedundant = redundant.has(edge);

  // Collect no-cost source building node IDs for clustering
  const freeSources = [];
  for (const node of nodes.values()) {
    if (node.nodeType === "building" && node.isSource) {
      const hasBuildCost = validEdges.some(e =>
        e.kind === "buildcost" && (e.reversed ? e.from === node.id : e.to === node.id)
      );
      if (!hasBuildCost) freeSources.push(node.id);
    }
  }

  // Compute edge weights for dagre layout
  const buildingsWithCost = new Set();
  const buildingCostGoodCount = new Map(); // buildingNodeId -> number of unique cost goods
  for (const edge of validEdges) {
    if (edge.kind !== "buildcost") continue;
    const building = edge.reversed ? edge.from : edge.to;
    const good = edge.reversed ? edge.to : edge.from;
    buildingsWithCost.add(building);
    if (!buildingCostGoodCount.has(building)) buildingCostGoodCount.set(building, new Set());
    buildingCostGoodCount.get(building).add(good);
  }
  for (const edge of validEdges) {
    if (edge.kind === "buildcost") {
      const building = edge.reversed ? edge.from : edge.to;
      if (buildingCostGoodCount.get(building)?.size === 1) edge.weight = 10;
    } else if (edge.kind === "recipe" && edge.from.startsWith("bldg:")) {
      edge.weight = buildingsWithCost.has(edge.from) ? 10 : 100;
    }
  }

  return { nodes, edges: validEdges, freeSources };
}

function addEdge(map, from, to, recipe, kind) {
  const key = `${kind}:${from}->${to}`;
  if (!map.has(key)) map.set(key, { from, to, recipes: [], kind });
  if (recipe && !map.get(key).recipes.some(existing => existing.id === recipe.id))
    map.get(key).recipes.push({ id: recipe.id, name: recipe.displayName || recipe.id });
}

function breakCycles(edges) {
  // Build adjacency from recipe edges only (the "spine" of the graph).
  const recipeAdj = new Map();
  for (const edge of edges) {
    if (edge.kind !== "recipe") continue;
    if (!recipeAdj.has(edge.from)) recipeAdj.set(edge.from, new Set());
    recipeAdj.get(edge.from).add(edge.to);
  }

  // For each buildcost edge, check if it creates a cycle: is there a recipe
  // path from the building (edge.to) back to the good (edge.from)?
  for (const edge of edges) {
    if (edge.kind !== "buildcost") continue;
    // edge goes: good (from) -> building (to)
    // cycle exists if: building ->recipe...-> good
    if (reachable(recipeAdj, edge.to, edge.from)) {
      // Reverse this edge's direction for layout purposes
      const tmp = edge.from;
      edge.from = edge.to;
      edge.to = tmp;
      edge.reversed = true;
    }
  }
}

function reachable(adj, start, target) {
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of (adj.get(current) || [])) {
      if (next === target) return true;
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return false;
}

function computeRedundantEdges(edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    adjacency.get(edge.from).add(edge.to);
  }
  const redundant = new Set();
  for (const edge of edges) {
    const visited = new Set([edge.from]);
    const queue = [];
    for (const neighbor of (adjacency.get(edge.from) || []))
      if (neighbor !== edge.to && visited.add(neighbor)) queue.push(neighbor);
    let found = false;
    while (queue.length && !found) {
      const current = queue.shift();
      for (const next of (adjacency.get(current) || [])) {
        if (next === edge.to) { found = true; break; }
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    if (found) redundant.add(edge);
  }
  return redundant;
}

// --- Node shapes ---

function roundedRect(width, height, radius) {
  return `M${radius} 0H${width-radius}Q${width} 0 ${width} ${radius}V${height-radius}Q${width} ${height} ${width-radius} ${height}H${radius}Q0 ${height} 0 ${height-radius}V${radius}Q0 0 ${radius} 0Z`;
}

function nodeShape(type, width, height) {
  if (type === "building") return `M0 0H${width}V${height}H0Z`;
  return roundedRect(width, height, height / 2);
}

// --- Text measurement ---

function textWidth(text) {
  return text.length * 8;
}

// --- Directed graph layout (dagre) ---

const { DirectedGraph } = joint.layout;

const layoutParams = {
  ranker: "network-simplex",
  rankDir: "TB",
  align: "UL",
  rankSep: 8,
  edgeSep: 8,
  nodeSep: 8,
};

function getLayoutOptions() {
  return { setVertices: false, clusterPadding: { top: 0, left: 0, right: 0, bottom: 0 }, ...layoutParams };
}

function relayout() {
  if (!jGraph || !paper) return;
  const container = document.getElementById("flow-container");
  paper.setDimensions(container.clientWidth, container.clientHeight);
  DirectedGraph.layout(jGraph, getLayoutOptions());
  routeAllLinks();
  paper.transformToFitContent({ padding: 20 });
}

// --- Diagnose bar ---

export function initAdvancedGraphControls() {
  const bar = document.createElement("div");
  bar.className = "advanced-graph-controls";

  const controls = [
    { key: "ranker", type: "select", options: ["network-simplex", "tight-tree", "longest-path"] },
    { key: "rankDir", type: "select", options: ["LR", "RL", "TB", "BT"] },
    { key: "align", type: "select", options: ["UL", "UR", "DL", "DR"] },
    { key: "rankSep", type: "number", min: 0, max: 200 },
    { key: "edgeSep", type: "number", min: 0, max: 200 },
    { key: "nodeSep", type: "number", min: 0, max: 200 },
  ];

  for (const ctrl of controls) {
    const label = document.createElement("label");
    label.className = "advanced-graph-control";
    label.textContent = ctrl.key + " ";

    let input;
    if (ctrl.type === "select") {
      input = document.createElement("select");
      for (const opt of ctrl.options) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt === layoutParams[ctrl.key]) o.selected = true;
        input.appendChild(o);
      }
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.min = ctrl.min;
      input.max = ctrl.max;
      input.value = layoutParams[ctrl.key];
    }

    input.addEventListener("input", () => {
      layoutParams[ctrl.key] = ctrl.type === "number" ? Number(input.value) : input.value;
      relayout();
    });

    label.appendChild(input);
    bar.appendChild(label);
  }

  document.querySelector("main").appendChild(bar);
  relayout();
}

// --- JointJS rendering ---

async function renderWithJointJS() {
  const container = document.getElementById("flow-container");
  if (paper) paper.remove();   // removes the wrapper div, not the container
  container.innerHTML = "";

  const paperEl = document.createElement("div");
  container.appendChild(paperEl);

  jGraph = new joint.dia.Graph({}, { cellNamespace: joint.shapes });
  paper = new joint.dia.Paper({
    el: paperEl, model: jGraph,
    width: container.clientWidth, height: container.clientHeight,
    interactive: false, async: false,
    background: { color: "transparent" },
    defaultConnector: { name: "rounded", args: { radius: 6 } },
    defaultConnectionPoint: { name: "anchor" },
  });

  cellMap.clear(); edgeCells = []; tempLinks = [];
  const elements = [], links = [];

  for (const node of graphData.nodes.values()) {
    const category = node.nodeType === "building" ? "building" : node.isSource ? "nature" : "good";
    const style = NODE_STYLES[category];
    const fontSize = category === "good" ? 11 : 10;
    const width = textWidth(node.displayName) + TEXT_PADDING, height = NODE_HEIGHT;
    const element = new FlowNode({
      size: { width, height },
      attrs: {
        body: { d: nodeShape(category, width, height),
          fill: style.fill, stroke: style.stroke, strokeWidth: 1.5,
          strokeDasharray: "none" },
        label: { text: node.displayName, fontSize },
      },
    });
    element.set("nodeId", node.id);
    element.set("baseStyle", { ...style, strokeWidth: 1.5 });
    elements.push(element);
    cellMap.set(node.id, element);
  }

  for (const edge of graphData.edges) {
    if (edge.isRedundant) continue;
    const link = makeLink(edge);
    if (link) { links.push(link); edgeCells.push({ link, edge }); }
  }

  // Cluster styling: visible in advanced mode, invisible otherwise
  const clusterAttrs = advancedMode
    ? { body: { fill: "rgba(255,255,255,0.04)", stroke: "#555", strokeWidth: 1, strokeDasharray: "4 3", pointerEvents: "none" }, label: { text: "" } }
    : { body: { fill: "transparent", stroke: "none", pointerEvents: "none" }, label: { text: "" } };

  // Group free-source buildings under a compound parent for dagre clustering
  if (graphData.freeSources.length > 1) {
    const clusterParent = new joint.shapes.standard.Rectangle({
      size: { width: 1, height: 1 },
      attrs: clusterAttrs,
    });
    elements.push(clusterParent);
    for (const nodeId of graphData.freeSources) {
      const child = cellMap.get(nodeId);
      if (child) clusterParent.embed(child);
    }
  }


  jGraph.resetCells([...elements, ...links]);

  relayout();

  // Tooltips
  for (const { link, edge } of edgeCells) {
    const linkView = paper.findViewByModel(link);
    if (!linkView) continue;
    const tooltip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tooltip.textContent = edge.kind === "buildcost" ? "Building cost" : edge.recipes.map(recipe => recipe.name).join(", ");
    linkView.el.prepend(tooltip);
  }

  // Click & pan
  let clickedElement = false;
  let isPanning = false, panStart = null, panMoved = false;

  paper.on("element:pointerdown", (view) => {
    const id = view.model.get("nodeId");
    if (!id) return;
    clickedElement = true;
    selectedNodeId = selectedNodeId === id ? null : id;
    applyHighlight();
  });

  const onPointerMove = evt => {
    if (!isPanning) return;
    const deltaX = evt.clientX - panStart.x, deltaY = evt.clientY - panStart.y;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) panMoved = true;
    const matrix = paper.matrix();
    paper.matrix(joint.V.createSVGMatrix().translate(deltaX, deltaY).multiply(matrix));
    panStart = { x: evt.clientX, y: evt.clientY };
  };
  const onPointerUp = () => {
    if (isPanning && !panMoved) { selectedNodeId = null; applyHighlight(); }
    isPanning = false;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  };

  paper.on("blank:pointerdown", (evt) => {
    if (clickedElement) { clickedElement = false; return; }
    isPanning = true; panMoved = false;
    panStart = { x: evt.clientX, y: evt.clientY };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  });

  if (wheelAbort) wheelAbort.abort();
  wheelAbort = new AbortController();
  container.addEventListener("wheel", evt => {
    evt.preventDefault();
    const zoomFactor = evt.deltaY < 0 ? 1.08 : 1 / 1.08;
    const cursorPoint = paper.clientToLocalPoint(evt.clientX, evt.clientY);
    const matrix = paper.matrix();
    paper.matrix(
      joint.V.createSVGMatrix()
        .translate(cursorPoint.x, cursorPoint.y)
        .scale(zoomFactor)
        .translate(-cursorPoint.x, -cursorPoint.y)
        .multiply(matrix)
    );
  }, { passive: false, signal: wheelAbort.signal });
}

function makeLink(edge) {
  // For layout, use edge.from/to (which may be reversed to break cycles).
  // The link source/target determines dagre rank ordering.
  const sourceElement = cellMap.get(edge.from), targetElement = cellMap.get(edge.to);
  if (!sourceElement || !targetElement) return null;
  const isBuildcost = edge.kind === "buildcost";
  const weight = edge.weight || 1;
  const link = new joint.shapes.standard.Link({
    source: { id: sourceElement.id },
    target: { id: targetElement.id },
    attrs: { line: { stroke: isBuildcost ? BUILDCOST_COLOR : EDGE_COLOR, strokeWidth: 1,
      strokeDasharray: isBuildcost ? "3 3" : "none", opacity: 0.5, targetMarker: null } },
    weight,
    z: -1,
  });
  if (advancedMode) {
    link.appendLabel({
      attrs: {
        text: { text: String(weight), fill: "#888", fontSize: 9 },
        rect: { fill: "transparent" },
      },
      position: { distance: 0.5 },
    });
  }
  return link;
}

// --- Interaction ---

function setNodeAppearance(element, stroke, strokeWidth, opacity) {
  element.attr("body", { stroke, strokeWidth, opacity });
  element.attr("label", { opacity });
}

function setLinkAppearance(link, stroke, strokeWidth, opacity, dasharray) {
  link.attr("line", { stroke, strokeWidth, opacity, strokeDasharray: dasharray || "none" });
}

function animateLink(link, animate) {
  const view = paper.findViewByModel(link);
  if (!view) return;
  if (animate) view.el.classList.add("flow-link-animated");
  else view.el.classList.remove("flow-link-animated");
}

function applyHighlight() {
  for (const tempLink of tempLinks) tempLink.remove();
  tempLinks = [];

  if (!selectedNodeId) {
    for (const [, element] of cellMap) {
      const baseStyle = element.get("baseStyle");
      setNodeAppearance(element, baseStyle.stroke, baseStyle.strokeWidth, 1);
    }
    for (const { link, edge } of edgeCells) {
      setLinkAppearance(link, edge.kind === "buildcost" ? BUILDCOST_COLOR : EDGE_COLOR, 1, 0.5, edge.kind === "buildcost" ? "3 3" : "none");
      animateLink(link, false);
    }
    if (currentSearch) applySearch();
    return;
  }

  // 2-hop neighborhood, recipe-aware: only expand through shared recipes
  const connectedNodes = new Set([selectedNodeId]), directEdges = [];
  const hop1Edges = [];
  for (const edge of graphData.edges)
    if (edge.from === selectedNodeId || edge.to === selectedNodeId) { hop1Edges.push(edge); directEdges.push(edge); connectedNodes.add(edge.from); connectedNodes.add(edge.to); }

  const hop1 = new Set(connectedNodes);
  hop1.delete(selectedNodeId);
  for (const neighbor of hop1) {
    const connectingRecipeIds = new Set();
    let hasRecipeEdge = false;
    for (const e of hop1Edges)
      if ((e.from === neighbor || e.to === neighbor) && e.kind === "recipe") { hasRecipeEdge = true; for (const r of e.recipes) connectingRecipeIds.add(r.id); }
    if (!hasRecipeEdge || connectingRecipeIds.size === 0) continue;
    for (const edge of graphData.edges) {
      if ((edge.from !== neighbor && edge.to !== neighbor) || edge.kind !== "recipe") continue;
      if (edge.recipes.some(r => connectingRecipeIds.has(r.id))) {
        directEdges.push(edge); connectedNodes.add(edge.from); connectedNodes.add(edge.to);
      }
    }
  }
  const directEdgeKeys = new Set(directEdges.map(edge => `${edge.kind}:${edge.from}->${edge.to}`));

  for (const [id, element] of cellMap) {
    if (connectedNodes.has(id)) {
      const baseStyle = element.get("baseStyle");
      setNodeAppearance(element, baseStyle.stroke, id === selectedNodeId ? 2.5 : baseStyle.strokeWidth, 1);
    } else {
      setNodeAppearance(element, element.get("baseStyle").stroke, element.get("baseStyle").strokeWidth, 0.15);
    }
  }

  for (const { link, edge } of edgeCells) {
    const edgeKey = `${edge.kind}:${edge.from}->${edge.to}`;
    if (directEdgeKeys.has(edgeKey)) {
      setLinkAppearance(link, edge.kind === "buildcost" ? BUILDCOST_HIGHLIGHT : EDGE_HIGHLIGHT, 2, 1, "12 4");
      animateLink(link, true);
    } else {
      setLinkAppearance(link, EDGE_COLOR, 1, 0.05, edge.kind === "buildcost" ? "3 3" : "none");
      animateLink(link, false);
    }
  }

  const redundantEdges = directEdges.filter(edge => edge.isRedundant);
  if (redundantEdges.length) {
    const extraEdges = [];
    for (const edge of redundantEdges) {
      const link = makeLink(edge);
      if (!link) continue;
      const hlColor = edge.kind === "buildcost" ? BUILDCOST_HIGHLIGHT : EDGE_HIGHLIGHT;
      link.attr("line", { stroke: hlColor, strokeWidth: 2, opacity: 0.8, strokeDasharray: "12 4" });
      jGraph.addCell(link);
      tempLinks.push(link);
      extraEdges.push({ link, edge });
    }
    routeAllLinks(extraEdges);
    for (const { link } of extraEdges) animateLink(link, true);
  }
}

function applySearch() {
  for (const [, element] of cellMap) {
    const node = graphData.nodes.get(element.get("nodeId"));
    const isMatch = currentSearch && node && node.displayName.toLowerCase().includes(currentSearch);
    const baseStyle = element.get("baseStyle");
    if (isMatch) {
      setNodeAppearance(element, ACCENT_COLOR, 2.5, 1);
    } else if (currentSearch) {
      setNodeAppearance(element, baseStyle.stroke, baseStyle.strokeWidth, 0.15);
    } else {
      setNodeAppearance(element, baseStyle.stroke, baseStyle.strokeWidth, 1);
    }
  }
  if (currentSearch) {
    for (const [, element] of cellMap) {
      const node = graphData.nodes.get(element.get("nodeId"));
      if (node && node.displayName.toLowerCase().includes(currentSearch)) {
        paper.findViewByModel(element)?.el.scrollIntoView({ block: "nearest", inline: "nearest" });
        break;
      }
    }
  }
}
