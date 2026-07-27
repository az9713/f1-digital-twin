export class Input {
  throttle = 0; // 0..1
  brake = 0; // 0..1
  steer = 0; // -1..1 (left positive)
  private keys = new Set<string>();
  onCameraToggle: (() => void) | null = null;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "KeyC") this.onCameraToggle?.();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
  }

  // Smooth key inputs toward targets so the placeholder car is controllable
  update(dt: number) {
    const rate = 3 * dt;
    const steerTarget = (this.keys.has("KeyA") ? 1 : 0) + (this.keys.has("KeyD") ? -1 : 0);
    this.steer += Math.max(-rate, Math.min(rate, steerTarget - this.steer));
    this.throttle = this.keys.has("KeyW") ? Math.min(1, this.throttle + rate) : 0;
    this.brake = this.keys.has("KeyS") ? Math.min(1, this.brake + rate * 2) : 0;
  }
}
