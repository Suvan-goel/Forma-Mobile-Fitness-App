# MoveNet Model Selection Guide

## Quick Comparison

| Model | Size | Speed | Accuracy | Best For |
|-------|------|-------|----------|----------|
| **Lightning Quantized** | 2.8 MB | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ | Real-time AR, games |
| **Lightning Float32** | 4.5 MB | ⚡⚡⚡ | ⭐⭐⭐⭐ | Development baseline |
| **Thunder Quantized** | 6.8 MB | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ | Balanced performance |
| **Thunder FP16** ✅ | 12 MB | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | Fitness form analysis |

---

## Current Configuration

**Active Model:** Thunder FP16 (12 MB)  
**Inference Rate:** 24 FPS (~42ms throttle)  
**Input Size:** 256×256  
**Expected Latency:** 30-45ms on modern devices

---

## How to Switch Models

Edit `src/screens/CameraScreen.tsx` line 57:

```typescript
// Current (highest accuracy):
const MOVENET_MODEL = MODELS.THUNDER_FLOAT16;

// Change to any of these:
const MOVENET_MODEL = MODELS.LIGHTNING_QUANTIZED; // Fastest
const MOVENET_MODEL = MODELS.LIGHTNING_FLOAT32;   // Baseline
const MOVENET_MODEL = MODELS.THUNDER_QUANTIZED;   // Balanced
```

Don't forget to adjust the inference throttle if needed:
- Lightning: `< 33` (30 FPS)
- Thunder: `< 42` (24 FPS)

---

## Decision Matrix

### Choose **Lightning Quantized** if:
- ✅ You need ultra-low latency (<20ms)
- ✅ Targeting older devices
- ✅ Battery life is critical
- ✅ Simple pose visualization is enough
- ❌ Form analysis is not the priority

### Choose **Thunder FP16** if: (Current)
- ✅ Fitness form analysis is critical
- ✅ Targeting modern devices (Galaxy S22, iPhone 14+)
- ✅ Accuracy matters more than speed
- ✅ Exercise detection needs high confidence
- ❌ Ultra-low latency is not required

### Choose **Thunder Quantized** if:
- ✅ Want best of both worlds
- ✅ Mid-range devices
- ✅ Good accuracy + acceptable speed
- ✅ Battery-conscious but need quality

### Choose **Lightning Float32** if:
- ✅ Development/debugging
- ✅ Need baseline for comparison
- ❌ Not for production (Lightning Quantized is better)

---

## Performance on Target Devices

### Galaxy S22:
| Model | Inference | Total Latency |
|-------|-----------|---------------|
| Lightning Quantized | 10-15ms | 25-35ms |
| Thunder FP16 | 20-30ms | 35-45ms |

### iPhone 14+:
| Model | Inference | Total Latency |
|-------|-----------|---------------|
| Lightning Quantized | 8-12ms | 20-30ms |
| Thunder FP16 | 15-25ms | 30-40ms |

---

## All Models Available

All four models are already downloaded in `assets/models/`:

```
✅ movenet_lightning_quantized.tflite (2.8 MB)
✅ movenet_lightning_float32.tflite (4.5 MB)
✅ movenet_thunder_quantized.tflite (6.8 MB)
✅ movenet_thunder_float16.tflite (12 MB) ← Currently active
```

No additional downloads needed - just change the constant and rebuild.

---

## Recommendation

**For Forma fitness app:** Thunder FP16 is the optimal choice because:
1. Form analysis requires precision
2. Target devices can handle it
3. 24 FPS is still real-time for fitness
4. Accuracy improves exercise detection & rep counting
5. Users expect high-quality tracking in fitness apps

If performance issues arise on specific devices, fall back to Thunder Quantized or Lightning Quantized.
