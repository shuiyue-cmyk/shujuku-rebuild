export interface UiSurfaceHandlers_ACU {
    openSettings: () => Promise<boolean>;
    openVisualizer: () => Promise<boolean>;
    refreshVisualizer: () => Promise<void>;
    isVisualizerActive?: () => boolean;
}

let registeredUiSurface_ACU: UiSurfaceHandlers_ACU | null = null;

export function registerUiSurface_ACU(handlers: UiSurfaceHandlers_ACU): void {
    registeredUiSurface_ACU = handlers;
}

export function getUiSurface_ACU(): UiSurfaceHandlers_ACU | null {
    return registeredUiSurface_ACU;
}

export function resetUiSurfaceRegistryForTests_ACU(): void {
    registeredUiSurface_ACU = null;
}
