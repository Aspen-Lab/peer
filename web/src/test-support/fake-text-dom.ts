// P11-28: a stand-in for the few DOM members the Summary's and the answers' marks read and write (`lib/notes/anchor-blocks.ts`'s text model,
// `components/notes/block-marks.ts`'s painter). This project's tests run in plain Node — no jsdom, no dependency may be added — so, like
// `fake-dom.ts`, it is a tree of nodes; unlike it, a text node can be split (`splitText`, with a DOM's own rules for where the new node stands)
// and a range can be asked where a point lies against its start (`comparePoint`). Everything layout- or selection-shaped is measured in a real browser.

export class TextDomNode {
  nodeType: 1 | 3;
  nodeName: string;
  childNodes: TextDomNode[] = [];
  parentNode: TextDomNode | null = null;
  attrs: Record<string, string> = {};
  styles: Record<string, string> = {};
  data = "";
  /** Every `splitText` made on this tree, in order (so a test can tell a node was never moved). */
  static splits = 0;

  constructor(type: 1 | 3, name: string, data = "") {
    this.nodeType = type;
    this.nodeName = name;
    this.data = data;
  }

  get id(): string {
    return this.attrs.id ?? "";
  }
  get firstChild(): TextDomNode | null {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join("");
  }
  get style() {
    return {
      setProperty: (name: string, value: string) => {
        this.styles[name] = value;
      },
    };
  }
  appendChild(child: TextDomNode): TextDomNode {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: TextDomNode): TextDomNode {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw new Error("The node to be removed is not a child of this node.");
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore(child: TextDomNode, ref: TextDomNode | null): TextDomNode {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    return child;
  }
  /** A DOM's `Text.splitText`: this node keeps `data[0, offset)`, a new node after it holds the rest. */
  splitText(offset: number): TextDomNode {
    if (this.nodeType !== 3) throw new Error("splitText on an element");
    if (offset < 0 || offset > this.data.length) throw new Error("IndexSizeError");
    const rest = new TextDomNode(3, "#text", this.data.slice(offset));
    this.data = this.data.slice(0, offset);
    this.parentNode?.insertBefore(rest, this.nextSibling);
    TextDomNode.splits += 1;
    return rest;
  }
  get nextSibling(): TextDomNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] : null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }
  matches(selector: string): boolean {
    return matchesAttr(this, selector);
  }
  closest(selector: string): TextDomNode | null {
    for (let at: TextDomNode | null = this; at; at = at.parentNode) if (at.nodeType === 1 && matchesAttr(at, selector)) return at;
    return null;
  }
  querySelectorAll(selector: string): TextDomNode[] {
    const out: TextDomNode[] = [];
    const walk = (n: TextDomNode) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1 && matchesAttr(c, selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): TextDomNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** `mark[data-highlight="x"]`, `mark[data-block-mark]`, `.class`, `button, a` and plain tags: what the tests ask of the tree. */
function matchesAttr(n: TextDomNode, selector: string): boolean {
  return selector.split(",").some((one) => {
    const klass = /^\.([\w-]+)$/.exec(one.trim());
    if (klass) return (n.attrs.class ?? "").split(/\s+/).includes(klass[1]);
    const m = /^([a-z]*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(one.trim());
    if (!m) return false;
    const [, tag, attr, value] = m;
    if (tag && n.nodeName.toLowerCase() !== tag.toLowerCase()) return false;
    if (!attr) return true;
    return value === undefined ? n.hasAttribute(attr) : n.getAttribute(attr) === value;
  });
}

export const text = (data: string): TextDomNode => new TextDomNode(3, "#text", data);

/** An element with children (strings become text nodes) and attributes: `el("div", { id: "a" }, "words", el("b", {}, "bold"))`. */
export function el(tag: string, attrs: Record<string, string> = {}, ...kids: (TextDomNode | string)[]): TextDomNode {
  const node = new TextDomNode(1, tag.toUpperCase());
  node.attrs = { ...attrs };
  for (const k of kids) node.appendChild(typeof k === "string" ? text(k) : k);
  return node;
}

/** Every text node under `n`, in order. */
export function textNodesOf(n: TextDomNode): TextDomNode[] {
  return n.nodeType === 3 ? [n] : n.childNodes.flatMap(textNodesOf);
}

/** The tree as tags and text: `a <mark data-highlight="h1">b</mark> c` — marks show their id; other tags show as they are. */
export function show(n: TextDomNode): string {
  if (n.nodeType === 3) return n.data;
  const tag = n.nodeName.toLowerCase();
  const id = n.attrs["data-highlight"];
  const open = id !== undefined ? `<${tag} h=${id}>` : `<${tag}>`;
  return `${open}${n.childNodes.map(show).join("")}</${tag}>`;
}

/** The document-order index of a node, for comparing two points. */
function order(root: TextDomNode, target: TextDomNode): number {
  let index = 0;
  let found = -1;
  const walk = (n: TextDomNode) => {
    if (n === target) found = index;
    index += 1;
    n.childNodes.forEach(walk);
  };
  walk(root);
  return found;
}

/** A range that starts at `(node, offset)` in the tree under `root`: what the hint reads (`startContainer`, `startOffset`, `comparePoint`). */
export function rangeStartingAt(root: TextDomNode, node: TextDomNode, offset: number) {
  return {
    startContainer: node,
    startOffset: offset,
    /** −1: the point is before the range's start; 0: at or after it (the range has no end here, so inside); 1 never. */
    comparePoint(at: TextDomNode, at_offset: number): number {
      const a = order(root, at);
      const b = order(root, node);
      if (a !== b) return a < b ? -1 : 0;
      return at_offset < offset ? -1 : 0;
    },
  };
}
