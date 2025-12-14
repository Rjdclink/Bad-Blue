import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { markPerformance, logResourceSizes, generatePerformanceReport } from "./lib/performance";
import { setupAudioUnlock } from "./lib/lexaraSpeechClient";

// Performance monitoring
const mountStartTime = performance.now();
console.log('[Performance] React mounting started at:', mountStartTime);
markPerformance('react:mount-start');

// Enable mobile/browser audio playback as soon as possible (first user interaction).
setupAudioUnlock();

// Declare global function type
declare global {
  interface Window {
    hideInitialLoader: () => void;
    appLoadStartTime: number;
  }
}

const root = createRoot(document.getElementById("root")!);

// Render the app and hide the initial loader
root.render(<App />);

// Hide the initial loader after React has mounted
setTimeout(() => {
  if (window.hideInitialLoader) {
    window.hideInitialLoader();
  }
  const mountEndTime = performance.now();
  console.log('[Performance] React mounted. Mount time:', (mountEndTime - mountStartTime).toFixed(2) + 'ms');
  markPerformance('react:mount-complete');
  
  // Log resource sizes after initial load
  setTimeout(() => {
    logResourceSizes();
    // Dynamically import bundle analyzer to avoid blocking initial load
    import('./lib/bundleAnalyzer').then(({ analyzeBundleSize }) => {
      analyzeBundleSize();
    });
    // Generate performance report after 3 seconds
    setTimeout(() => {
      generatePerformanceReport();
    }, 2000);
  }, 1000);
}, 0);
