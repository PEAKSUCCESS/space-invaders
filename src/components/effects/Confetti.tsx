import confetti from 'canvas-confetti';

export interface FireOptions {
  // Origin in viewport coordinates [0..1]
  x: number;
  y: number;
}

export function fireConfetti({ x, y }: FireOptions) {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { x, y },
    startVelocity: 35,
    scalar: 0.9,
  });
}
