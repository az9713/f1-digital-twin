export interface SessionData {
  meta: {
    session_key: number;
    driver_number: number;
    circuit: string;
    year: number;
    lap_number: number;
    lap_time_s: number;
  };
  dt: number;
  x: number[];
  z: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
}

export async function loadSession(name: string): Promise<SessionData | null> {
  try {
    const r = await fetch(`/sessions/${name}.json`);
    if (!r.ok) return null;
    return (await r.json()) as SessionData;
  } catch {
    return null;
  }
}

/** Linear interpolation into a session channel at time t (seconds into lap). */
export function sampleChannel(s: SessionData, channel: number[], t: number): number {
  const ft = ((t % (s.meta.lap_time_s)) + s.meta.lap_time_s) % s.meta.lap_time_s / s.dt;
  const i = Math.min(Math.floor(ft), channel.length - 2);
  const f = ft - i;
  return channel[i] + (channel[i + 1] - channel[i]) * f;
}
