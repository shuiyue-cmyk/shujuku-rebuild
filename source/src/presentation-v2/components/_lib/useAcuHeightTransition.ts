import {
  acuClearTimeout,
  acuGetComputedStyle,
  acuMatchesMedia,
  acuRequestAnimationFrame,
  acuSetTimeout,
  type AcuTimerHandle,
} from '../../bootstrap/host-env';

const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 200;
const MS_PER_PIXEL = 0.45;

const transitionTimers = new WeakMap<HTMLElement, AcuTimerHandle>();

export interface AcuHeightTransitionOptions {
  restoreOverflow?: (el: HTMLElement) => void;
  collapsedTransform?: string;
  expandedTransform?: string;
}

export function useAcuHeightTransition(options: AcuHeightTransitionOptions = {}) {
  const collapsedTransform = options.collapsedTransform ?? 'translateY(-2px)';
  const expandedTransform = options.expandedTransform ?? 'translateY(0)';

  function prefersReducedMotion(): boolean {
    return acuMatchesMedia('(prefers-reduced-motion: reduce)');
  }

  function scheduleFrame(callback: () => void): void {
    acuRequestAnimationFrame(callback);
  }

  function clearTransitionTimer(el: HTMLElement): void {
    const timer = transitionTimers.get(el);
    if (timer !== undefined) {
      acuClearTimeout(timer);
      transitionTimers.delete(el);
    }
  }

  function restoreOverflow(el: HTMLElement): void {
    if (options.restoreOverflow) {
      options.restoreOverflow(el);
      return;
    }
    el.style.overflowY = 'hidden';
    el.style.overflowX = 'hidden';
  }

  function cleanupTransition(el: Element): void {
    const body = el as HTMLElement;
    clearTransitionTimer(body);
    body.style.transition = '';
    body.style.height = '';
    body.style.opacity = '';
    body.style.transform = '';
    body.style.willChange = '';
    restoreOverflow(body);
  }

  function getBorderHeight(el: HTMLElement): number {
    const style = acuGetComputedStyle(el);
    return (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  }

  function getExpandedHeight(el: HTMLElement): number {
    const contentHeight = el.scrollHeight + getBorderHeight(el);
    const maxHeight = acuGetComputedStyle(el).maxHeight;
    const parsedMax = Number.parseFloat(maxHeight);
    if (Number.isFinite(parsedMax) && parsedMax > 0) {
      return Math.min(contentHeight, parsedMax);
    }
    return contentHeight;
  }

  function durationForHeight(height: number): number {
    if (prefersReducedMotion()) return 1;
    return Math.min(
      MAX_DURATION_MS,
      Math.max(MIN_DURATION_MS, Math.round(height * MS_PER_PIXEL)),
    );
  }

  function runHeightTransition(
    el: HTMLElement,
    targetHeight: number,
    direction: 'enter' | 'leave',
    done: () => void,
  ): void {
    clearTransitionTimer(el);
    const currentHeight = parseFloat(el.style.height) || el.getBoundingClientRect().height || getExpandedHeight(el);
    const duration = durationForHeight(direction === 'enter' ? targetHeight : currentHeight);
    const easing = direction === 'enter' ? 'ease-out' : 'ease-in';

    if (prefersReducedMotion()) {
      el.style.height = direction === 'enter' ? `${targetHeight}px` : '0px';
      el.style.opacity = direction === 'enter' ? '1' : '0';
      done();
      return;
    }

    el.style.willChange = 'height, opacity, transform';
    el.style.transition = `height ${duration}ms ${easing}, opacity ${Math.min(duration, 120)}ms ${easing}, transform ${duration}ms ${easing}`;

    scheduleFrame(() => {
      el.style.height = `${targetHeight}px`;
      el.style.opacity = direction === 'enter' ? '1' : '0';
      el.style.transform = direction === 'enter' ? expandedTransform : collapsedTransform;
    });

    const finish = () => {
      clearTransitionTimer(el);
      el.removeEventListener('transitionend', onEnd);
      done();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === 'height') finish();
    };

    el.addEventListener('transitionend', onEnd);
    transitionTimers.set(el, acuSetTimeout(finish, duration + 60));
  }

  function beforeEnter(el: Element): void {
    const body = el as HTMLElement;
    clearTransitionTimer(body);
    body.style.height = '0px';
    body.style.opacity = '0';
    body.style.transform = collapsedTransform;
    body.style.overflowY = 'hidden';
    body.style.overflowX = 'hidden';
  }

  function enter(el: Element, done: () => void): void {
    runHeightTransition(el as HTMLElement, getExpandedHeight(el as HTMLElement), 'enter', done);
  }

  function afterEnter(el: Element): void {
    cleanupTransition(el);
  }

  function beforeLeave(el: Element): void {
    const body = el as HTMLElement;
    clearTransitionTimer(body);
    body.style.height = `${body.getBoundingClientRect().height || getExpandedHeight(body)}px`;
    body.style.opacity = '1';
    body.style.transform = expandedTransform;
    body.style.overflowY = 'hidden';
    body.style.overflowX = 'hidden';
  }

  function leave(el: Element, done: () => void): void {
    runHeightTransition(el as HTMLElement, 0, 'leave', done);
  }

  function afterLeave(el: Element): void {
    cleanupTransition(el);
  }

  return {
    beforeEnter,
    enter,
    afterEnter,
    beforeLeave,
    leave,
    afterLeave,
    cleanupTransition,
  };
}
