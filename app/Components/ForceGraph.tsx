import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { hierarchy, tree, HierarchyPointNode } from "d3-hierarchy";

export interface CustomNode {
	id: string;
	depth: number;
	group: number;
	x?: number;
	y?: number;
}

export interface CustomLink {
	source: string | CustomNode;
	target: string | CustomNode;
	move?: string;
}

export enum Group {
	Start = 1,
	P1 = 2,
	P2 = 3,
	P1Win = 4,
	P2Win = 5,
}

interface MinimaxResult {
	value: number;
	optimalChildId?: string;
}

interface HNode {
	id: string;
}

const NODE_ID = (n: string | CustomNode) => (typeof n === "string" ? n : n.id);
const AUTO_EXPAND_DEPTH = 12;

function indexGraph(nodesData: CustomNode[], linksData: CustomLink[]) {
	const nodeById = new Map<string, CustomNode>();
	nodesData.forEach((n) => nodeById.set(n.id, n));

	const childrenOf = new Map<string, string[]>();
	const parentOf = new Map<string, string>(); // Fast parent lookup map
	const moveOf = new Map<string, string | undefined>();
	const hasParent = new Set<string>();

	linksData.forEach((l) => {
		const s = NODE_ID(l.source);
		const t = NODE_ID(l.target);
		if (!childrenOf.has(s)) childrenOf.set(s, []);
		childrenOf.get(s)!.push(t);
		if (!parentOf.has(t)) parentOf.set(t, s);
		moveOf.set(`${s}->${t}`, l.move);
		hasParent.add(t);
	});

	const rootId =
		nodesData.find((n) => !hasParent.has(n.id))?.id ?? nodesData[0]?.id;

	return { nodeById, childrenOf, parentOf, moveOf, rootId };
}

const MINIMAX_DECAY = 0.9;

function computeMinimax(
	rootId: string,
	nodeById: Map<string, CustomNode>,
	childrenOf: Map<string, string[]>,
	opposite: boolean = false,
): Map<string, MinimaxResult> {
	const result = new Map<string, MinimaxResult>();
	const onStack = new Set<string>();

	interface Frame {
		id: string;
		kids: string[];
		idx: number;
	}

	const stack: Frame[] = [
		{ id: rootId, kids: childrenOf.get(rootId) ?? [], idx: 0 },
	];
	onStack.add(rootId);

	while (stack.length) {
		const frame = stack[stack.length - 1];

		if (frame.idx < frame.kids.length) {
			const childId = frame.kids[frame.idx];
			if (result.has(childId) || onStack.has(childId)) {
				frame.idx++;
				continue;
			}
			onStack.add(childId);
			stack.push({ id: childId, kids: childrenOf.get(childId) ?? [], idx: 0 });
			continue;
		}

		stack.pop();
		onStack.delete(frame.id);

		const node = nodeById.get(frame.id);
		let value: number;
		let optimalChildId: string | undefined;

		if (!node) {
			value = 0;
		} else if (node.group === Group.P1Win) {
			// Terminal: undiscounted, this IS the distance-0 anchor decay
			// propagates outward from.
			value = opposite ? -1 : 1;
		} else if (node.group === Group.P2Win) {
			value = opposite ? 1 : -1;
		} else if (frame.kids.length === 0) {
			value = 0;
		} else {
			const maximizing = opposite
				? node.group === Group.P2
				: node.group !== Group.P2;

			let best: { id: string; value: number } | null = null;
			for (const childId of frame.kids) {
				const childResult = result.get(childId);
				if (!childResult) continue;

				// Apply one ply of decay as the value propagates up from
				// this child. A child that's already several plies removed
				// from its own terminal arrives here already-decayed, so
				// this compounds naturally with depth — no separate
				// distance counter needed.
				const decayed = childResult.value * MINIMAX_DECAY;

				if (
					best === null ||
					(maximizing ? decayed > best.value : decayed < best.value)
				) {
					best = { id: childId, value: decayed };
				}
			}
			value = best ? best.value : 0;
			optimalChildId = best?.id;
		}

		result.set(frame.id, { value, optimalChildId });
	}

	return result;
}

function computeOptimalEdgeKeys(
	rootId: string,
	minimax: Map<string, MinimaxResult>,
): Set<string> {
	const keys = new Set<string>();
	const visited = new Set<string>();
	let cur = rootId;
	while (true) {
		if (visited.has(cur)) break;
		visited.add(cur);

		let mm = minimax.get(cur);
		if (!mm?.optimalChildId) break;
		keys.add(`${cur}->${mm.optimalChildId}`);
		cur = mm.optimalChildId;
	}
	return keys;
}

const NEUTRAL = { r: 0x6b, g: 0x6b, b: 0x78 };
const P1_COLOR = { r: 0x22, g: 0xd3, b: 0xee };
const P2_COLOR = { r: 0xf4, g: 0x72, b: 0xb6 };

function lerp(a: number, b: number, t: number) {
	return Math.round(a + (b - a) * t);
}

function valueToColor(value: number): string {
	const t = Math.max(-1, Math.min(1, value));
	const target = t >= 0 ? P1_COLOR : P2_COLOR;
	const mag = Math.abs(t);
	const r = lerp(NEUTRAL.r, target.r, mag);
	const g = lerp(NEUTRAL.g, target.g, mag);
	const b = lerp(NEUTRAL.b, target.b, mag);
	return `rgb(${r},${g},${b})`;
}

/** Instant parsing & canonical normalization */
function parseStateInput(input: string): string | null {
	// if no commas, insert commas between every character
	if (!input.includes(",")) {
		for (let i = 1; i < input.length; i++) {
			if (input[i] !== ",") {
				input = input.slice(0, i) + "," + input.slice(i);
				i++;
			}
		}
	}
	const parts = input
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !isNaN(Number(s)));

	if (parts.length !== 5) return null;

	const turn = parts[0];
	const myHand = [Number(parts[1]), Number(parts[2])].sort((a, b) => a - b);
	const oppHand = [Number(parts[3]), Number(parts[4])].sort((a, b) => a - b);

	return `${turn},${myHand[0]},${myHand[1]},${oppHand[0]},${oppHand[1]}`;
}

export default function GameTree({
	nodesData,
	linksData,
	width,
	height,
}: {
	nodesData: CustomNode[];
	linksData: CustomLink[];
	width: number;
	height: number;
}) {
	const svgRef = useRef<SVGSVGElement | null>(null);
	const gRef = useRef<SVGGElement | null>(null);
	const zoomBehaviorRef = useRef<any>(null);
	const isInitialFitDone = useRef<boolean>(false);

	const [overridden, setOverridden] = useState<Set<string>>(new Set());
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const [stateInput, setStateInput] = useState<string>("");
	const [searchResult, setSearchResult] = useState<{
		foundNodeId?: string;
		moveNotation?: string;
		targetNodeId?: string;
		evalValue?: number;
		error?: string;
	} | null>(null);
	const [searchedNodeId, setSearchedNodeId] = useState<string | null>(null);

	const searchedP1NextTurn = useMemo(() => {
		const trimmed = stateInput.trim();
		return !trimmed.startsWith("0");
	}, [stateInput]);

	const dx = 26;
	const dy = 90;

	const { nodeById, childrenOf, parentOf, moveOf, rootId } = useMemo(
		() => indexGraph(nodesData, linksData),
		[nodesData, linksData],
	);

	const minimax = useMemo(
		() =>
			rootId
				? computeMinimax(rootId, nodeById, childrenOf)
				: new Map<string, MinimaxResult>(),
		[rootId, nodeById, childrenOf],
	);
	const oppositeMinimax = useMemo(
		() =>
			rootId
				? computeMinimax(rootId, nodeById, childrenOf)
				: new Map<string, MinimaxResult>(),
		[rootId, nodeById, childrenOf],
	);

	const optimalEdgeKeys = useMemo(
		() =>
			searchResult?.foundNodeId ? computeOptimalEdgeKeys(searchResult?.foundNodeId, searchResult.foundNodeId.startsWith("0") ? oppositeMinimax : minimax) : new Set<string>(),
		[searchResult?.foundNodeId, minimax, oppositeMinimax],
	);
	const hoveredOptimalEdgeKeys = useMemo(
		() =>
			hoveredId ? computeOptimalEdgeKeys(hoveredId, hoveredId.startsWith("0") ? oppositeMinimax : minimax) : new Set<string>(),
		[hoveredId, minimax, oppositeMinimax],
	);

	function defaultChildrenVisible(depth: number) {
		return depth < AUTO_EXPAND_DEPTH;
	}

	function childrenVisible(id: string, depth: number) {
		const def = defaultChildrenVisible(depth);
		return overridden.has(id) ? !def : def;
	}

	const { renderNodes, renderLinks, extent } = useMemo(() => {
		if (!rootId) {
			return {
				renderNodes: [],
				renderLinks: [],
				extent: { x0: 0, x1: 0, y0: 0, y1: 0 },
			};
		}

		const childrenAccessor = (
			d: HNode,
			pathAncestors = new Set<string>(),
		): HNode[] | null => {
			const kids = childrenOf.get(d.id);
			if (!kids || !kids.length) return null;

			const node = nodeById.get(d.id);
			const depth = node?.depth ?? 0;
			if (!childrenVisible(d.id, depth)) return null;

			const nextAncestors = new Set(pathAncestors).add(d.id);
			const validKids = kids.filter((kidId) => !nextAncestors.has(kidId));
			if (!validKids.length) return null;

			return validKids.map((id) => ({ id }));
		};

		const buildHierarchy = (
			currentId: string,
			visitedPaths = new Set<string>(),
		): any => {
			const kids = childrenAccessor({ id: currentId }, visitedPaths);
			const node: any = { id: currentId };
			if (kids) {
				const nextVisited = new Set(visitedPaths).add(currentId);
				node.children = kids.map((k) => buildHierarchy(k.id, nextVisited));
			}
			return node;
		};

		const rootData = buildHierarchy(rootId);
		const root = hierarchy<HNode>(rootData, (d: any) => d.children);

		const layout = tree<HNode>().nodeSize([dx, dy]);
		layout(root);

		const nodes = root.descendants() as HierarchyPointNode<HNode>[];
		const links = root.links() as {
			source: HierarchyPointNode<HNode>;
			target: HierarchyPointNode<HNode>;
		}[];

		let x0 = Infinity,
			x1 = -Infinity,
			y0 = Infinity,
			y1 = -Infinity;
		nodes.forEach((n) => {
			if (n.x < x0) x0 = n.x;
			if (n.x > x1) x1 = n.x;
			if (n.y < y0) y0 = n.y;
			if (n.y > y1) y1 = n.y;
		});

		return {
			renderNodes: nodes,
			renderLinks: links,
			extent: { x0, x1, y0, y1 },
		};
	}, [rootId, nodeById, childrenOf, overridden]);

	useEffect(() => {
		isInitialFitDone.current = false;
	}, [rootId]);

	useEffect(() => {
		if (!svgRef.current || !gRef.current) return;

		const z = zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.05, 8])
			.on("zoom", (e) => {
				select(gRef.current!).attr("transform", e.transform.toString());
			});

		zoomBehaviorRef.current = z;
		const svgSelection = select(svgRef.current).call(z);

		if (!isInitialFitDone.current && isFinite(extent.x0)) {
			const treeWidth = extent.x1 - extent.x0 + dx * 2;
			const treeHeight = extent.y1 - extent.y0 + dy;
			const scale = Math.min(
				1.2,
				Math.min(width / treeWidth, height / treeHeight, 1),
			);
			const tx = width / 2 - ((extent.x0 + extent.x1) / 2) * scale;
			const ty = 40;

			svgSelection.call(
				z.transform,
				zoomIdentity.translate(tx, ty).scale(scale),
			);
			isInitialFitDone.current = true;
		}

		return () => {
			svgSelection.on(".zoom", null);
		};
	}, [width, height, extent.x0, extent.x1, extent.y0, extent.y1]);

	const hoveredAncestorIds = useMemo(() => {
		if (!hoveredId) return null;
		const found = renderNodes.find((n) => n.data.id === hoveredId);
		if (!found) return null;
		return new Set(found.ancestors().map((a: any) => a.data.id));
	}, [hoveredId, renderNodes]);

	function toggleVisibility(id: string) {
		setOverridden((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function focusOnNode(nodeId: string) {
		const renderedNode = renderNodes.find((n) => n.data.id === nodeId);
		if (!renderedNode || !svgRef.current || !zoomBehaviorRef.current) return;
		console.log("zzz");

		const targetScale = 1.5;
		const tx = width / 2 - renderedNode.x * targetScale;
		const ty = height / 2 - renderedNode.y * targetScale;

		const selection: any = select(svgRef.current);
		selection
			.transition()
			.duration(750)
			.call(
				zoomBehaviorRef.current.transform,
				zoomIdentity.translate(tx, ty).scale(targetScale),
			);
	}

	// 1. Fixed handleSearch: Minimal set expansion without cascade explosion
	function handleSearch(e: React.FormEvent, stateInputOverride?: string) {
		e.preventDefault();
		const formattedId = parseStateInput(stateInputOverride ?? stateInput);

		if (!formattedId) {
			setSearchResult({
				error: "Invalid format. Use 5 numbers: turn,my1,my2,opp1,opp2",
			});
			setSearchedNodeId(null);
			return;
		}

		if (!nodeById.has(formattedId)) {
			setSearchResult({ error: `State (${formattedId}) not found in tree.` });
			setSearchedNodeId(null);
			return;
		}

		// --- BFS to find the shortest path from rootId to target ---
		const pathToTarget: string[] = [];
		const parentMap = new Map<string, string>();
		const queue: string[] = [rootId];
		const visited = new Set<string>([rootId]);
		let found = false;

		while (queue.length > 0) {
			const current = queue.shift()!;
			if (current === formattedId) {
				found = true;
				break;
			}

			const children = childrenOf.get(current) ?? [];
			for (const childId of children) {
				if (!visited.has(childId)) {
					visited.add(childId);
					parentMap.set(childId, current);
					queue.push(childId);
				}
			}
		}

		// Reconstruct path from target back to root
		if (found) {
			let curr: string | undefined = formattedId;
			while (curr) {
				pathToTarget.push(curr);
				curr = parentMap.get(curr);
			}
		} else {
			// Fallback if disconnected from current rootId
			pathToTarget.push(formattedId);
		}

		// Ensure nodes along the path are expanded
		setOverridden((prev) => {
			const next = new Set(prev);
			pathToTarget.forEach((id) => {
				const node = nodeById.get(id);
				if (node) {
					const defaultVis = defaultChildrenVisible(node.depth);
					if (!defaultVis) {
						next.add(id);
					}
				}
			});
			return next;
		});

		setSearchedNodeId(formattedId);

		const mmResult = searchedP1NextTurn
			? minimax.get(formattedId)
			: oppositeMinimax.get(formattedId);
		if (!mmResult || !mmResult.optimalChildId) {
			setSearchResult({
				foundNodeId: formattedId,
				evalValue: mmResult?.value ?? 0,
				error: "Terminal state or no valid moves available.",
			});
		} else {
			const edgeKey = `${formattedId}->${mmResult.optimalChildId}`;
			const notation = moveOf.get(edgeKey) ?? mmResult.optimalChildId;
			setSearchResult({
				foundNodeId: formattedId,
				moveNotation: notation,
				targetNodeId: mmResult.optimalChildId,
				evalValue: mmResult.value,
			});
		}

		setTimeout(() => focusOnNode(formattedId), 150);
	}

	return (
		<div style={{ position: "relative", width, height }}>
			<div
				style={{
					position: "absolute",
					top: 12,
					right: 12,
					background: "rgba(22, 22, 29, 0.92)",
					border: "1px solid #333",
					borderRadius: "8px",
					padding: "12px",
					color: "#ddd",
					fontSize: "12px",
					zIndex: 10,
					boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
					backdropFilter: "blur(4px)",
					width: "280px",
				}}
			>
				<div
		className="text-lg"
					style={{
						fontWeight: "bold",
						marginBottom: "12px",
						color: "#fff",
					}}
				>
					Find State & Best Move
				</div>
				<form
					onSubmit={handleSearch}
					style={{ display: "flex", flexDirection: "column", gap: "8px" }}
				>
					<input
						type="text"
						placeholder="0,1,2,2,3"
						value={stateInput}
						onChange={(e) => setStateInput(e.target.value)}
			className="text-2xl"
						style={{
							background: "#111116",
							border: "1px solid #444",
							color: "#fff",
							padding: "6px 8px",
							borderRadius: "4px",
							fontSize: "24px",
						}}
					/>
					<p className="text-sm">
						<b>Format</b>: turn,p1,p1,p2,p2
						<br />
						<br />
						Turn 1 = P1 next; turn 0 = P2 next
						<br />
						p1,p1 is p1's two hands
						<br />
						p2,p2 is p2's two hands
					</p>
					<button
						type="submit"
			className="text-2xl"
						style={{
							background: searchedP1NextTurn ? "#38bdf8" : "#f472b6",
							color: "#000",
							border: "none",
							borderRadius: "4px",
							padding: "6px",
							fontWeight: "bold",
							cursor: "pointer",
						}}
					>
						Find {searchedP1NextTurn ? "P1" : "P2"} Best Move
					</button>
					<p className="text-sm">Click node + alt/opt key = search</p>
				</form>

				{searchResult && (
					<div
						style={{
							marginTop: "10px",
							paddingTop: "8px",
							borderTop: "1px solid #333",
							lineHeight: "1.4",
						}}
					>
						{searchResult.error && !searchResult.foundNodeId && (
							<span style={{ color: "#f87171" }}>{searchResult.error}</span>
						)}
						{searchResult.foundNodeId && (
							<div>
								{searchResult.moveNotation ? (
									<div
										className="text-2xl"
										style={{
											marginTop: "6px",
											padding: "6px",
											background: "rgba(61, 220, 132, 0.15)",
											border: "1px solid #3ddc84",
											borderRadius: "4px",
											color: "#3ddc84",
											fontWeight: "bold",
											textAlign: "center",
										}}
									>
										Best Move: {searchResult.moveNotation}
									</div>
								) : (
									<div style={{ color: "#f87171", marginTop: "4px" }}>
										{searchResult.error}
									</div>
								)}
							</div>
						)}
					</div>
				)}

				<div
					style={{
						marginTop: "10px",
						paddingTop: "8px",
						borderTop: "1px solid #333",
						lineHeight: "1.4",
					}}
				>
					{
						optimalEdgeKeys.size > 0 && (
							<div>
								<b className="text-2xl">Optimal path:</b>
								<ul style={{ marginTop: "4px", paddingLeft: "20px" }}>
									{Array.from(optimalEdgeKeys).map((edgeKey) => {
										const move = moveOf.get(edgeKey);
										return (
											<p key={edgeKey} className="text-lg" style={{
												color: edgeKey.startsWith("0") ? "#f472b6" : "#38bdf8",
											}}>
												<span className="opacity-70">{edgeKey.split("->")[0]}</span> {"->"} <span className="font-bold">{edgeKey.split("->")[1]}</span> {move ? `(${move})` : ""}
											</p>
										);
									})}
								</ul>
							</div>
						)
					}
				</div>
			</div>

			<svg
				ref={svgRef}
				width={width}
				height={height}
				style={{ border: "1px solid #ccc", background: "#111116" }}
			>
				<g transform="translate(12,12)" style={{ pointerEvents: "none" }}>
					<circle cx={6} cy={0} r={5} fill={valueToColor(1)} />
					<text x={16} y={4} fontSize={11} fill="#ddd">
						P1 favored
					</text>
					<circle cx={6} cy={18} r={5} fill={valueToColor(-1)} />
					<text x={16} y={22} fontSize={11} fill="#ddd">
						P2 favored
					</text>
					<line
						x1={0}
						y1={36}
						x2={16}
						y2={36}
						stroke="#3ddc84"
						strokeWidth={3}
					/>
					<text x={22} y={40} fontSize={11} fill="#ddd">
						optimal line of play
					</text>
					<circle
						cx={6}
						cy={54}
						r={5}
						fill="none"
						stroke="#888"
						strokeDasharray="2,2"
					/>
					<text x={16} y={58} fontSize={11} fill="#ddd">
						click to expand/collapse
					</text>
				</g>

				<g ref={gRef}>
					<g className="links">
						{renderLinks.map((link, idx) => {
							const linkId = `${link.source.data.id}->${link.target.data.id}`;
							const key = `${linkId}-${idx}`;
							const isOptimal = optimalEdgeKeys.has(linkId);
							const isHoveredOptimal = hoveredOptimalEdgeKeys.has(linkId);
							const isHovered =
								!!hoveredAncestorIds?.has(link.source.data.id) &&
								!!hoveredAncestorIds?.has(link.target.data.id);

							const midY = (link.source.y + link.target.y) / 2;
							const move = moveOf.get(linkId);

							return (
								<g key={key}>
									<path
										d={`M${link.source.x},${link.source.y}
											C${link.source.x},${midY}
												${link.target.x},${midY}
												${link.target.x},${link.target.y}`}
										fill="none"
										stroke={
											isOptimal ? "#3ddc84" : isHoveredOptimal ? "#72e9a8" : isHovered ? "#f5f5f5" : "#555"
										}
										strokeWidth={isOptimal ? 3.5 : isHovered ? 2.5 : 1.2}
										strokeOpacity={isOptimal || isHovered ? 0.95 : 0.45}
									/>
									{move && (
										<text
											x={(link.source.x + link.target.x) / 2}
											y={midY}
											fontSize={9}
											textAnchor="middle"
											fill={isOptimal ? "#3ddc84" : "#999"}
											style={{ pointerEvents: "none" }}
										>
											{move}
										</text>
									)}
								</g>
							);
						})}
					</g>

					<g className="nodes">
						{renderNodes.map((n, idx) => {
							const id = n.data.id;
							const key = `${id}-${n.depth}-${idx}`;
							const node = nodeById.get(id);
							const mm = minimax.get(id);
							const value = mm?.value ?? 0;
							const isTerminal =
								node?.group === Group.P1Win || node?.group === Group.P2Win;
							const totalKidCount = childrenOf.get(id)?.length ?? 0;
							const childrenShown =
								totalKidCount > 0 && childrenVisible(id, node?.depth ?? 0);
							const hasHiddenChildren = totalKidCount > 0 && !childrenShown;

							const radius = isTerminal ? 10 : id === rootId ? 8 : 6;
							const isHovered = hoveredAncestorIds?.has(id);
							const isSearched = searchedNodeId === id;

							return (
								<Fragment key={key}>
									{isSearched && (
										<circle
											cx={n.x}
											cy={n.y}
											r={radius + 8}
											fill="none"
											stroke="#ffffff"
											strokeWidth={2}
										>
											<animate
												attributeName="r"
												values={`${radius + 4};${radius + 12};${radius + 4}`}
												dur="1.8s"
												repeatCount="indefinite"
											/>
											<animate
												attributeName="stroke-opacity"
												values="1;0.3;1"
												dur="1.8s"
												repeatCount="indefinite"
											/>
										</circle>
									)}

									<circle
										cx={n.x}
										cy={n.y}
										r={radius}
										fill={valueToColor(value)}
										stroke={
											isTerminal
												? node?.group === Group.P1Win
													? "#22d3ee"
													: "#f472b6"
												: "#000"
										}
										strokeWidth={
											isTerminal ? 2 : isHovered || isSearched ? 2 : 0.5
										}
										strokeOpacity={0.9}
										style={{
											cursor: totalKidCount > 0 ? "pointer" : "default",
										}}
										onClick={(e) => {
											if (e.altKey) {
												setStateInput(id.split("->")[0]);
												handleSearch(new Event("submit") as any, id.split("->")[0]);
											} else {
												totalKidCount > 0 && toggleVisibility(id)
											}
										}}
										onMouseEnter={() => setHoveredId(id)}
										// onMouseLeave={() =>
										// 	setHoveredId((prev) => (prev === id ? null : prev))
										// }
									>
										<title>
											{id}
											{/* {"\n"}value: {value.toFixed(2)} */}
											{/* {hasHiddenChildren ? "\n(click to expand)" : ""} */}
										</title>
									</circle>

									{hasHiddenChildren && (
										<circle
											cx={n.x}
											cy={n.y}
											r={radius + 4}
											fill="none"
											stroke="#888"
											strokeDasharray="2,2"
											strokeWidth={1}
											style={{ pointerEvents: "none" }}
										/>
									)}
								</Fragment>
							);
						})}
					</g>
				</g>
			</svg>

			{hoveredId && (
				<div className="fixed bottom-3 right-3">
					<p
						className="text-6xl"
						style={{
							color: hoveredId?.startsWith("0") ? "#f472b6" : "#38bdf8",
						}}
					>
						{hoveredId}
					</p>
					<p
					className="text-3xl"
						style={{
							color: valueToColor(minimax.get(hoveredId)?.value ?? 0),
						}}
					>
						Eval: {minimax.get(hoveredId)?.value?.toFixed(2) ?? "0.00"}
					</p>
					<p className="text-3xl">
						{hoveredId?.startsWith("0") ? "P2" : "P1"} next
					</p>
				</div>
			)}
		</div>
	);
}
