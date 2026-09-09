/**
 * The camera's ground-plane facing, quantized to a world axis, so keyboard
 * nudges follow what the user sees: ↑ pushes an item away from the camera,
 * → pushes it to the right of the screen, whichever way the view is orbited.
 * Written every frame by <ViewAxisTracker/> inside the canvas and read by the
 * global key handler in App.
 */
export const viewAxis = {
  fx: 0, // "screen up" in world x
  fz: -1, // "screen up" in world z
}

// screen right = forward rotated -90° about Y
export function screenRight(): { x: number; z: number } {
  return { x: -viewAxis.fz, z: viewAxis.fx }
}
