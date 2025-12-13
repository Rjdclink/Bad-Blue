/**
 * Route Mount Test Stub Components
 * 
 * Phase 2 (Power 1.2) - Pure mount proof
 * 
 * These stub components can be swapped in to test if routes
 * stay mounted for 60 seconds without unmounting.
 * 
 * To use:
 * 1. Import { CryptoCrawlerStub, InmateLocatorStub } from './test/route-stubs'
 * 2. Replace CryptoCrawlerDashboard/InmateLocatorPage with stubs in App.tsx
 * 3. Run the app and observe console logs
 */

import { useEffect, useState, useRef } from "react";

interface MountLog {
  event: 'mount' | 'unmount';
  timestamp: number;
  component: string;
}

// Global mount log for testing
const mountLogs: MountLog[] = [];

function logMount(component: string, event: 'mount' | 'unmount') {
  const log = {
    event,
    timestamp: Date.now(),
    component,
  };
  mountLogs.push(log);
  console.log(`[MOUNT_TEST] ${component} ${event} at ${new Date().toISOString()}`);
}

export function getMountLogs() {
  return mountLogs;
}

export function clearMountLogs() {
  mountLogs.length = 0;
}

/**
 * CryptoCrawler Test Stub
 * Renders "CRYPTO OK" and logs mount/unmount
 */
export function CryptoCrawlerStub() {
  const [mountTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const mountRef = useRef(false);
  const unmountLoggedRef = useRef(false);

  useEffect(() => {
    // Prevent double-logging in React StrictMode
    if (!mountRef.current) {
      mountRef.current = true;
      logMount('CryptoCrawlerStub', 'mount');
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - mountTime);
    }, 1000);

    return () => {
      clearInterval(interval);
      // Prevent double unmount logging in StrictMode
      if (!unmountLoggedRef.current) {
        unmountLoggedRef.current = true;
        logMount('CryptoCrawlerStub', 'unmount');
        const mountDuration = Date.now() - mountTime;
        console.log(`[MOUNT_TEST] CryptoCrawlerStub was mounted for ${mountDuration}ms (${Math.floor(mountDuration / 1000)}s)`);
        if (mountDuration < 60000) {
          console.warn(`[MOUNT_TEST] ⚠️ CryptoCrawlerStub unmounted before 60 seconds!`);
        } else {
          console.log(`[MOUNT_TEST] ✅ CryptoCrawlerStub stayed mounted for 60+ seconds`);
        }
      }
    };
  }, [mountTime]);

  const seconds = Math.floor(elapsed / 1000);
  const isOK = seconds >= 60;

  return (
    <div 
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: isOK ? '#22c55e' : '#f97316',
        color: 'white',
        fontSize: '48px',
        fontWeight: 'bold',
        fontFamily: 'monospace',
      }}
    >
      <div>CRYPTO OK</div>
      <div style={{ fontSize: '24px', marginTop: '20px' }}>
        Mounted: {seconds}s
      </div>
      <div style={{ fontSize: '16px', marginTop: '10px', opacity: 0.8 }}>
        {isOK ? '✅ Passed 60s test' : '⏳ Waiting for 60s...'}
      </div>
    </div>
  );
}

/**
 * Inmate Locator Test Stub
 * Renders "INMATE OK" and logs mount/unmount
 */
export function InmateLocatorStub() {
  const [mountTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const mountRef = useRef(false);
  const unmountLoggedRef = useRef(false);

  useEffect(() => {
    // Prevent double-logging in React StrictMode
    if (!mountRef.current) {
      mountRef.current = true;
      logMount('InmateLocatorStub', 'mount');
    }

    const interval = setInterval(() => {
      setElapsed(Date.now() - mountTime);
    }, 1000);

    return () => {
      clearInterval(interval);
      // Prevent double unmount logging in StrictMode
      if (!unmountLoggedRef.current) {
        unmountLoggedRef.current = true;
        logMount('InmateLocatorStub', 'unmount');
        const mountDuration = Date.now() - mountTime;
        console.log(`[MOUNT_TEST] InmateLocatorStub was mounted for ${mountDuration}ms (${Math.floor(mountDuration / 1000)}s)`);
        if (mountDuration < 60000) {
          console.warn(`[MOUNT_TEST] ⚠️ InmateLocatorStub unmounted before 60 seconds!`);
        } else {
          console.log(`[MOUNT_TEST] ✅ InmateLocatorStub stayed mounted for 60+ seconds`);
        }
      }
    };
  }, [mountTime]);

  const seconds = Math.floor(elapsed / 1000);
  const isOK = seconds >= 60;

  return (
    <div 
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: isOK ? '#22c55e' : '#3b82f6',
        color: 'white',
        fontSize: '48px',
        fontWeight: 'bold',
        fontFamily: 'monospace',
      }}
    >
      <div>INMATE OK</div>
      <div style={{ fontSize: '24px', marginTop: '20px' }}>
        Mounted: {seconds}s
      </div>
      <div style={{ fontSize: '16px', marginTop: '10px', opacity: 0.8 }}>
        {isOK ? '✅ Passed 60s test' : '⏳ Waiting for 60s...'}
      </div>
    </div>
  );
}

export default {
  CryptoCrawlerStub,
  InmateLocatorStub,
  getMountLogs,
  clearMountLogs,
};
