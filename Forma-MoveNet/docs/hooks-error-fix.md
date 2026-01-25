# React Hooks Error Fix - PoseOverlay Component

## The Problem

The app was crashing with the error:
```
Render Error: Rendered more hooks than during the previous render.
```

This is a **React Rules of Hooks violation**.

## Root Causes

### Issue 1: Conditional Hook Calls
The component had an early return **before** the `useEffect` hook:

```typescript
// ❌ WRONG - Early return before hook
if (width <= 0 || height <= 0) return null;

useEffect(() => {
  // ... effect code
}, [deps]);
```

**Why this breaks React:**
- React requires hooks to be called in the **exact same order** on every render
- Early returns can cause hooks to be skipped on some renders
- This breaks React's internal hook tracking system

### Issue 2: Circular Dependency
The `useEffect` initially had `interpolatedKeypoints` in its dependency array while also calling `setInterpolatedKeypoints` inside:

```typescript
// ❌ WRONG - Circular dependency
useEffect(() => {
  const prev = interpolatedKeypoints || mapped; // reads state
  setInterpolatedKeypoints(newValue);          // writes state
}, [interpolatedKeypoints]); // depends on state it modifies
```

This created an infinite loop of re-renders.

## The Solution

### Fix 1: Move All Hooks to Top
Ensured **all hooks are called unconditionally** before any early returns:

```typescript
// ✅ CORRECT - All hooks first
export const PoseOverlay = ({ keypoints, width, height, mirror, minScore }) => {
  // 1. All hooks are called here (unconditionally)
  const [interpolatedKeypoints, setInterpolatedKeypoints] = useState(null);
  const prevKeypointsRef = useRef(null);
  const targetKeypointsRef = useRef(null);
  const startTimeRef = useRef(0);
  const animationFrameRef = useRef(null);
  const currentInterpolatedRef = useRef(null);

  useEffect(() => {
    // Effect logic handles invalid states internally
    if (width <= 0 || height <= 0) {
      setInterpolatedKeypoints(null);
      return;
    }
    // ... rest of effect
  }, [keypoints, width, height, mirror]);

  // 2. Early returns only AFTER all hooks
  if (width <= 0 || height <= 0) return null;
  if (!interpolatedKeypoints) return null;

  // 3. Render logic
  return <Canvas>...</Canvas>;
};
```

### Fix 2: Break Circular Dependency
Used a ref (`currentInterpolatedRef`) to track the current value without triggering re-renders:

```typescript
// ✅ CORRECT - Use ref instead of state in dependency
const currentInterpolatedRef = useRef(null);

useEffect(() => {
  // Read from ref (doesn't trigger re-render)
  prevKeypointsRef.current = currentInterpolatedRef.current || mapped;
  
  const animate = () => {
    const interpolated = interpolateKeypoints(...);
    currentInterpolatedRef.current = interpolated; // Update ref
    setInterpolatedKeypoints(interpolated);        // Update state for render
  };
}, [keypoints, width, height, mirror]); // No circular dependency
```

## React Rules of Hooks

The fix adheres to React's fundamental rules:

1. **Only Call Hooks at the Top Level**
   - ✅ Don't call hooks inside loops, conditions, or nested functions
   - ✅ All hooks must be called in the same order every render

2. **Only Call Hooks from React Functions**
   - ✅ Call hooks from React function components
   - ✅ Call hooks from custom hooks

3. **Hook Dependencies Must Be Complete**
   - ✅ Include all values used inside the effect
   - ✅ Don't create circular dependencies (state that depends on itself)

## Testing the Fix

After this fix, the component should:
- ✅ Render without errors
- ✅ Display the skeleton overlay smoothly
- ✅ Handle dimension changes correctly
- ✅ Interpolate between pose updates at 60 FPS

## Files Modified

- `src/components/PoseOverlay.tsx` - Fixed hook ordering and circular dependency

## Key Takeaways

1. **Always call hooks at the top** - Before any conditional returns
2. **Never skip hooks conditionally** - React needs consistent hook order
3. **Avoid circular dependencies** - Don't depend on state you're setting in the same effect
4. **Use refs for values that shouldn't trigger re-renders** - Perfect for tracking previous values

## Related Resources

- [React Rules of Hooks](https://reactjs.org/docs/hooks-rules.html)
- [ESLint Plugin: react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks)
- [Common Hook Mistakes](https://reactjs.org/docs/hooks-faq.html#what-can-i-do-if-my-effect-dependencies-change-too-often)
