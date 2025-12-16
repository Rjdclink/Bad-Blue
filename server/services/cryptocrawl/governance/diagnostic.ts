import type { ControlInput, ExecutionContext } from './system-control.js';

export async function diagnose(context: ExecutionContext, input: ControlInput) {
  const [{ isActive }, { exceeded }, { getCurrentLevel }] = await Promise.all([
    import('./kill-switch.js'),
    import('./hard-limits.js'),
    import('./autonomy.js'),
  ]);

  const [kill, limits, autonomy] = await Promise.all([
    isActive(context),
    exceeded(context),
    getCurrentLevel(context, input),
  ]);

  return {
    kill,
    limits,
    autonomy,
  };
}
