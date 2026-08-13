import {
  createRenderer,
  nodeOps,
  patchProp,
  type App as VueApp,
  type Component,
  type Renderer,
  type RendererOptions,
} from 'vue';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

type HostContainer = Element | ShadowRoot;

interface CachedRenderer {
  document: Document;
  renderer: Renderer<HostContainer>;
}

let cachedRenderer: CachedRenderer | null = null;
const trustedHtmlPolicies = new WeakMap<Document, { createHTML(value: string): string }>();

function toTrustedHtml(doc: Document, content: string): string {
  const trustedTypesApi = (doc.defaultView as any)?.trustedTypes;
  if (!trustedTypesApi) return content;
  const existingPolicy = trustedHtmlPolicies.get(doc);
  if (existingPolicy) return existingPolicy.createHTML(content);
  try {
    const policy = (trustedTypesApi
      .createPolicy('acu-v2-vue', { createHTML: (value: string) => value })
    ) as { createHTML(value: string): string };
    trustedHtmlPolicies.set(doc, policy);
    return policy.createHTML(content);
  } catch {
    return content;
  }
}

function createHostNodeOps(doc: Document): typeof nodeOps {
  return {
    ...nodeOps,
    createElement: (tag, namespace, is, props) => {
      const el = namespace === 'svg'
        ? doc.createElementNS(SVG_NS, tag)
        : namespace === 'mathml'
          ? doc.createElementNS(MATHML_NS, tag)
          : is
            ? doc.createElement(tag, { is })
            : doc.createElement(tag);

      if (tag === 'select' && props && props.multiple != null) {
        el.setAttribute('multiple', props.multiple);
      }
      return el;
    },
    createText: text => doc.createTextNode(text),
    createComment: text => doc.createComment(text),
    querySelector: selector => doc.querySelector(selector),
    insertStaticContent(content, parent, anchor, namespace, start, end) {
      const before = anchor ? anchor.previousSibling : parent.lastChild;
      if (start && (start === end || start.nextSibling)) {
        let node: Node | null = start;
        while (node) {
          parent.insertBefore(node.cloneNode(true), anchor);
          if (node === end) break;
          node = node.nextSibling;
        }
      } else {
        const templateContainer = doc.createElement('template');
        templateContainer.innerHTML = toTrustedHtml(
          doc,
          namespace === 'svg'
            ? `<svg>${content}</svg>`
            : namespace === 'mathml'
              ? `<math>${content}</math>`
              : content,
        ) as string;

        const template = templateContainer.content;
        if (namespace === 'svg' || namespace === 'mathml') {
          const wrapper = template.firstChild;
          if (wrapper) {
            while (wrapper.firstChild) template.appendChild(wrapper.firstChild);
            template.removeChild(wrapper);
          }
        }
        parent.insertBefore(template, anchor);
      }

      return [
        before ? before.nextSibling : parent.firstChild,
        anchor ? anchor.previousSibling : parent.lastChild,
      ];
    },
  };
}

function getHostRenderer(doc: Document): Renderer<HostContainer> {
  if (cachedRenderer?.document === doc) return cachedRenderer.renderer;

  const options: RendererOptions<Node, HostContainer> = {
    patchProp,
    ...createHostNodeOps(doc),
  };
  const renderer = createRenderer<Node, HostContainer>(options);
  cachedRenderer = { document: doc, renderer };
  return renderer;
}

export function createHostDocumentApp(
  rootComponent: Component,
  rootProps: Record<string, unknown>,
  doc: Document,
): VueApp {
  return getHostRenderer(doc).createApp(rootComponent, rootProps);
}

export function __resetHostRendererForTests(): void {
  cachedRenderer = null;
}
