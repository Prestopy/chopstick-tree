import { CustomLink, CustomNode, Group } from "./Components/ForceGraph";

class TreeNode {
    public readonly hands: readonly [readonly number[], readonly number[]];
    public readonly isP1Turn: boolean;
    public readonly turn: number = 0; // depth in the tree
    public readonly isTerminal: boolean;
    public children: TreeNode[];

    constructor(p1: number[], p2: number[], isP1Turn: boolean, turn: number = 0) {
        // Normalize each hand so [a, b] and [b, a] are the same state
        this.hands = [
            [Math.min(p1[0], p1[1]), Math.max(p1[0], p1[1])],
            [Math.min(p2[0], p2[1]), Math.max(p2[0], p2[1])],
        ];
        this.isP1Turn = isP1Turn;
        this.children = [];
        this.isTerminal =
            (this.hands[0][0] === 0 && this.hands[0][1] === 0) ||
            (this.hands[1][0] === 0 && this.hands[1][1] === 0);

        this.turn = turn;
    }

    stateKey(): string {
        const t = this.isP1Turn ? 1 : 0;
        const [[a, b], [c, d]] = this.hands;
        return `${t},${a},${b},${c},${d}`;
    }
}

export class Tree {
    public root: TreeNode;
    private nodeMap: Map<string, TreeNode>;

    constructor() {
        this.root = new TreeNode([1, 1], [1, 1], true, 1);
        this.nodeMap = new Map();
        this.generateTree(this.root);
    }

    private generateTree(node: TreeNode): void {
        const key = node.stateKey();
        if (this.nodeMap.has(key)) return;
        this.nodeMap.set(key, node);

        if (node.isTerminal) return;

        const turn = node.isP1Turn ? 0 : 1;
        const opp  = 1 - turn;
        const myHands  = node.hands[turn];
        const oppHands = node.hands[opp];

        // --- Attack moves ---
        // Use one of my live hands to tap one of the opponent's live hands.
        // My hands are unchanged; opponent's tapped hand gains my hand's value (mod 5, → 0 = dead).
        for (let mi = 0; mi < 2; mi++) {
            if (myHands[mi] === 0) continue;
            // Skip the second index if both my hands are equal — it would be a duplicate move
            if (mi === 1 && myHands[0] === myHands[1]) continue;

            for (let oi = 0; oi < 2; oi++) {
                if (oppHands[oi] === 0) continue;
                if (oi === 1 && oppHands[0] === oppHands[1]) continue;

                const newOpp: number[] = [oppHands[0], oppHands[1]];
                newOpp[oi] = (oppHands[oi] + myHands[mi]);
                if (newOpp[oi] >= 5) newOpp[oi] = 0;

                const [newP1, newP2] = turn === 0
                    ? [[...myHands], newOpp]
                    : [newOpp, [...myHands]];

                this.addChild(node, newP1, newP2, !node.isP1Turn, node.turn + 1);
            }
        }

        // --- Split moves ---
        // Redistribute total fingers between my two hands.
        // Only iterate i up to total/2 since the constructor normalizes, avoiding [i,j] and [j,i] duplicates.
        const total = myHands[0] + myHands[1];
        for (let i = 0; i <= Math.floor(total / 2); i++) {
            const j = total - i;
            if (j >= 5) continue;             // hand value must be 0–4
            if (i === myHands[0]) continue;   // same distribution as now (already normalized, so j === myHands[1] too)

            const [newP1, newP2] = turn === 0
                ? [[i, j], [...oppHands]]
                : [[...oppHands], [i, j]];

            this.addChild(node, newP1, newP2, !node.isP1Turn, node.turn + 1);
        }
    }

    private addChild(parent: TreeNode, p1: number[], p2: number[], isP1Turn: boolean, turn: number): void {
        const child = new TreeNode(p1, p2, isP1Turn, turn);
        const key = child.stateKey();

        // Re-use existing node for this state if we've seen it before (handles cycles/transpositions)
        const existing = this.nodeMap.get(key);
        const target = existing ?? child;

        if (!parent.children.includes(target)) {
            parent.children.push(target);
        }

        if (!existing) {
            this.generateTree(child);
        }
    }

    public getNodesAndLinks() {
        // convert tree into a list of nodes and links for visualization
        const nodes: CustomNode[] = [];
        const links: CustomLink[] = [];

        const visited = new Set<string>();

        // traverse the tree and assign an index to each node for linking
        const traverse = (node: TreeNode, index: number) => {
            const group = 
                node.stateKey() == "1,1,1,1,1" ? 1 :
                node.isTerminal ? (node.hands[0][0] === 0 && node.hands[0][1] === 0 ? Group.P2Win : Group.P1Win) :
                node.isP1Turn ? Group.P1 : Group.P2;

            const depth = node.turn;
            
            nodes.push({ id: node.stateKey(), group, depth: depth });
            visited.add(node.stateKey());
            node.children.forEach((child, childIndex) => {
                const childNodeIndex = nodes.length; // next index for the child
                links.push({ source: node.stateKey(), target: child.stateKey() });
                if (!visited.has(child.stateKey())) traverse(child, childNodeIndex);
            });
        };

        traverse(this.root, 0);
        return { nodes, links };
    }
}