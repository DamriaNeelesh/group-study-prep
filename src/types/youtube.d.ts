/// <reference types="youtube" />

// YouTube IFrame API type augmentation
declare global {
    interface Window {
        YT: typeof YT;
        onYouTubeIframeAPIReady?: () => void;
    }
}

export { };
