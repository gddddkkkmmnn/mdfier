export const CAPTURE_LIMITS = {
  nodes: 10_000,
  textCharacters: 2_000_000,
  depth: 128,
} as const;

export interface CaptureBudget { nodes: number; textCharacters: number; }

export class CaptureLimitError extends Error {
  constructor() {
    super('capture-too-large');
    this.name = 'CaptureLimitError';
  }
}

export function accountCaptureNode(budget: CaptureBudget, node: Node, depth: number, retainedAttributes: readonly string[]) {
  if (++budget.nodes > CAPTURE_LIMITS.nodes || depth > CAPTURE_LIMITS.depth) throw new CaptureLimitError();
  if (node.nodeType === 3) budget.textCharacters += node.textContent?.length ?? 0;
  else if (node.nodeType === 1) {
    const element = node as Element;
    for (const name of retainedAttributes) {
      if (name === 'href' && element.tagName !== 'A') continue;
      if (name === 'value' && element.tagName !== 'LI') continue;
      if (name === 'alt' && element.tagName !== 'IMG') continue;
      budget.textCharacters += element.getAttribute(name)?.length ?? 0;
    }
  }
  if (budget.textCharacters > CAPTURE_LIMITS.textCharacters) throw new CaptureLimitError();
}
