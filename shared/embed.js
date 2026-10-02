/**
 * The sleeve-recognition embedding, shared by the index build (Node) and the camera
 * (browser) so both sides are computed identically.
 *
 * DINOv2-small, CLS token, L2-normalised. Measured against synthetic phone photos of
 * 60 of the real sleeves (identify/tests/bench_embed.mjs): 56–60/60 top-1 in good
 * conditions, against 40–60/60 for CLIP ViT-B/32. Mean-pooled patch tokens were
 * worse on loosely framed photos; float32 weights were no better than int8.
 */
export const MODEL_ID = 'Xenova/dinov2-small'

export async function embedFrom(processor, model, image) {
  const inputs = await processor(image)
  const { last_hidden_state: t } = await model(inputs)
  const dim = t.dims[2]
  const v = Array.from(t.data.slice(0, dim))
  let s = 0
  for (const x of v) s += x * x
  s = Math.sqrt(s) || 1
  return v.map((x) => x / s)
}
