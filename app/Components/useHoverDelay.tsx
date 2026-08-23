import { useEffect, useRef } from 'react';

export function useHoverDelay(doAnyways: () => void, callback: () => void, delay = 2000) {
  const timerRef = useRef<NodeJS.Timeout>(null);

  const onMouseEnter = () => {
    doAnyways();
    
    // Prevent duplicate timers
    if (timerRef.current) return; 

    timerRef.current = setTimeout(() => {
      callback();
    }, delay);
  };

  const onMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Cleanup timer automatically if the component unmounts mid-hover
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { onMouseEnter, onMouseLeave };
}
