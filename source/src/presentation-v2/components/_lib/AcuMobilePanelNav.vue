<template>
  <nav
    ref="rootRef"
    class="acu-mobile-panel-nav"
    aria-label="页面板块"
  >
    <div ref="trackRef" class="acu-mobile-panel-nav__track" role="list">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="acu-mobile-panel-nav__item"
        :class="{ 'is-active': item.id === activeId }"
        :aria-current="item.id === activeId ? 'location' : undefined"
        @click="scrollToPanel(item.id)"
      >
        {{ item.label }}
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { acuCancelAnimationFrame, acuRequestAnimationFrame } from '../../bootstrap/host-env';

interface AcuMobilePanelNavItem {
  id: string;
  label: string;
}

const props = defineProps<{
  items: AcuMobilePanelNavItem[];
}>();

const rootRef = ref<HTMLElement | null>(null);
const trackRef = ref<HTMLElement | null>(null);
const activeId = ref(props.items[0]?.id ?? '');
let scrollContainer: HTMLElement | Window | null = null;
let resizeWindow: Window | null = null;
let frame = 0;
let programmaticTargetId = '';
const USER_SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

watch(
  () => props.items,
  (items) => {
    if (!items.some((item) => item.id === activeId.value)) {
      activeId.value = items[0]?.id ?? '';
    }
    queueActiveUpdate();
  },
  { deep: true },
);

watch(activeId, () => {
  void nextTick(() => {
    keepActiveButtonVisible();
  });
});

function panelElements(): Array<{ item: AcuMobilePanelNavItem; el: HTMLElement }> {
  const doc = ownerDocument();
  return props.items
    .map((item) => ({ item, el: doc.getElementById(item.id) }))
    .filter((entry): entry is { item: AcuMobilePanelNavItem; el: HTMLElement } => Boolean(entry.el));
}

function ownerDocument(): Document {
  return rootRef.value?.ownerDocument ?? document;
}

function ownerWindow(): Window {
  return ownerDocument().defaultView ?? window;
}

function resolveScrollContainer(): HTMLElement | Window {
  return rootRef.value?.closest<HTMLElement>('[data-acu-main]') ?? ownerWindow();
}

function keepActiveButtonVisible(): void {
  const track = trackRef.value;
  const activeButton = rootRef.value?.querySelector<HTMLElement>('[aria-current="location"]');
  if (!track || !activeButton) return;

  const targetLeft = activeButton.offsetLeft - (track.clientWidth - activeButton.offsetWidth) / 2;
  const left = Math.max(0, targetLeft);
  if (typeof track.scrollTo === 'function') {
    track.scrollTo({ left, behavior: 'smooth' });
  } else {
    track.scrollLeft = left;
  }
}

function scrollToPanel(id: string): void {
  lockProgrammaticTarget(id);
  activeId.value = id;
  const target = ownerDocument().getElementById(id);
  if (!target) {
    programmaticTargetId = '';
    return;
  }

  const container = resolveScrollContainer();
  const win = ownerWindow();
  const navHeight = rootRef.value?.offsetHeight ?? 0;
  const extraGap = 10;

  if (container === win) {
    const top = target.getBoundingClientRect().top + win.scrollY - navHeight - extraGap;
    if (typeof win.scrollTo === 'function') {
      win.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView();
    }
    return;
  }

  const containerTop = container.getBoundingClientRect().top;
  const top =
    target.getBoundingClientRect().top -
    containerTop +
    container.scrollTop -
    navHeight -
    extraGap;
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  } else if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView();
  }
}

function lockProgrammaticTarget(id: string): void {
  programmaticTargetId = id;
}

function releaseProgrammaticTarget(): void {
  if (!programmaticTargetId) return;
  programmaticTargetId = '';
  queueActiveUpdate();
}

function onUserScrollIntent(event: Event): void {
  const key = 'key' in event ? String((event as KeyboardEvent).key || '') : '';
  if (key && !USER_SCROLL_KEYS.has(key)) {
    return;
  }
  releaseProgrammaticTarget();
}

function updateActiveFromViewport(): void {
  frame = 0;
  const panels = panelElements();
  if (!panels.length) return;
  const panelRects = panels.map((entry) => ({
    ...entry,
    rect: entry.el.getBoundingClientRect(),
  }));
  if (!panelRects.some(({ rect }) => rect.top !== 0 || rect.bottom !== 0)) return;

  const navBottom = rootRef.value?.getBoundingClientRect().bottom ?? 0;
  const threshold = navBottom + 12;
  if (programmaticTargetId) return;

  let current = panelRects[0].item.id;

  for (const { item, rect } of panelRects) {
    if (rect.top <= threshold) {
      current = item.id;
    } else {
      break;
    }
  }

  activeId.value = current;
}

function queueActiveUpdate(): void {
  if (frame) return;
  frame = acuRequestAnimationFrame(updateActiveFromViewport);
}

onMounted(() => {
  void nextTick(() => {
    scrollContainer = resolveScrollContainer();
    resizeWindow = ownerWindow();
    scrollContainer.addEventListener('scroll', queueActiveUpdate, { passive: true });
    scrollContainer.addEventListener('touchmove', onUserScrollIntent, { passive: true });
    scrollContainer.addEventListener('wheel', onUserScrollIntent, { passive: true });
    resizeWindow.addEventListener('resize', queueActiveUpdate, { passive: true });
    resizeWindow.addEventListener('keydown', onUserScrollIntent);
    queueActiveUpdate();
  });
});

onBeforeUnmount(() => {
  if (scrollContainer) {
    scrollContainer.removeEventListener('scroll', queueActiveUpdate);
    scrollContainer.removeEventListener('touchmove', onUserScrollIntent);
    scrollContainer.removeEventListener('wheel', onUserScrollIntent);
  }
  if (resizeWindow) {
    resizeWindow.removeEventListener('resize', queueActiveUpdate);
    resizeWindow.removeEventListener('keydown', onUserScrollIntent);
    resizeWindow = null;
  }
  if (frame) acuCancelAnimationFrame(frame);
});
</script>

<style scoped>
.acu-mobile-panel-nav {
  display: none;
}

@media (max-width: 860px) {
  .acu-mobile-panel-nav {
    position: sticky;
    top: 0;
    z-index: 30;
    display: block;
    margin: -20px -20px 4px;
    padding: 0;
    border-top: 0;
    border-bottom: 1px solid var(--acu-border-2);
    background: color-mix(in srgb, var(--acu-bg-0) 94%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .acu-mobile-panel-nav::before,
  .acu-mobile-panel-nav::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 1px;
    z-index: 2;
    width: 22px;
    pointer-events: none;
  }

  .acu-mobile-panel-nav::before {
    left: 0;
    background: linear-gradient(to right, var(--acu-bg-0), transparent);
  }

  .acu-mobile-panel-nav::after {
    right: 0;
    background: linear-gradient(to left, var(--acu-bg-0), transparent);
  }

  .acu-mobile-panel-nav__track {
    min-width: 0;
    display: flex;
    gap: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-padding-inline: 18px;
    scrollbar-width: none;
    padding: 0 18px;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .acu-mobile-panel-nav__track::-webkit-scrollbar {
    display: none;
  }

  .acu-mobile-panel-nav__item {
    flex: 0 0 auto;
    position: relative;
    min-width: 84px;
    min-height: 44px;
    max-width: none;
    padding: 0 12px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--acu-text-3);
    font: inherit;
    font-size: var(--acu-font-size-body, 12px);
    font-weight: 650;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .acu-mobile-panel-nav__item:hover {
    background: var(--acu-hover-overlay);
    color: var(--acu-text-1);
  }

  .acu-mobile-panel-nav__item::after {
    content: "";
    position: absolute;
    right: 12px;
    bottom: 0;
    left: 12px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: transparent;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .acu-mobile-panel-nav__item.is-active {
    background: transparent;
    color: var(--acu-text-1);
    box-shadow: none;
  }

  .acu-mobile-panel-nav__item.is-active::after {
    background: var(--acu-accent);
  }

  .acu-mobile-panel-nav__item:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--acu-accent-glow);
  }

  .acu-mobile-panel-nav__item.is-active:focus-visible {
    box-shadow: inset 0 0 0 2px var(--acu-accent-glow);
  }
}

@media (max-width: 720px) {
  .acu-mobile-panel-nav {
    margin: -14px -14px 4px;
  }
}
</style>
