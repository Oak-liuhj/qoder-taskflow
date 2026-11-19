import { useState, useEffect, useRef } from 'react';

export function useTaskflow(api, sessionId, interval = 1200) {
  const [state, setState] = useState({ plan: null, loading: true });
  const latest = useRef(0);
  useEffect(() => {
    let alive = true; const generation = ++latest.current; setState({ plan: null, loading: true });
    let inFlight = false;
    const load = async () => { if (inFlight) return; inFlight = true; try { const value = await api.view(sessionId); if (alive && latest.current === generation) setState({ ...value, loading: false }); } catch (e) { if (alive) setState(s => ({ ...s, loading: false, error: e.message })); } finally { inFlight = false; } };
    void load(); const timer = setInterval(load, interval); return () => { alive = false; clearInterval(timer); };
  }, [api, sessionId, interval]);
  return state;
}

