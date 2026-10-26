// Generated from this OpenSpec change's recalculated evidence.
export type BandFitnessProfile = "low" | "medium" | "high";

type TaskFitness = Readonly<{ coding: number | null; general: number | null }>;

export const BENCHMARK_CONSENSUS_FITNESS: Readonly<
  Record<string, Readonly<Partial<Record<BandFitnessProfile, TaskFitness>>>>
> = {
  "allam-2-7b": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "beam-free": {"low":{"coding":0.7,"general":0.6685393258426966},"medium":{"coding":0.7,"general":0.6573033707865169},"high":{"coding":0.7,"general":0.6235955056179775}},
  "big-pickle": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "canopylabs/orpheus-arabic-saudi": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "canopylabs/orpheus-v1-english": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "cohere/north-mini-code:free": {"low":{"coding":0.42452830188679247,"general":0.15168539325842698},"medium":{"coding":0.42452830188679247,"general":0.15168539325842698},"high":{"coding":0.42452830188679247,"general":0.15168539325842698}},
  "deepseek-ai/deepseek-v4.1-flash": {"low":{"coding":0.9821875,"general":0.7865168539325843},"medium":{"coding":0.9821875,"general":0.7528089887640449},"high":{"coding":0.9821875,"general":0.7528089887640449}},
  "deepseek-v4.1-flash-free": {"low":{"coding":0.9821875,"general":0.7865168539325843},"medium":{"coding":0.9821875,"general":0.7528089887640449},"high":{"coding":0.9821875,"general":0.7528089887640449}},
  "dots-studio/dots-3-note-preview:free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "glm-5.3-flash-free": {"low":{"coding":0.82,"general":0.8258426966292135},"medium":{"coding":0.82,"general":0.8258426966292135},"high":{"coding":0.82,"general":0.8146067415730337}},
  "google/diffusiongemma-26b-a4b-it": {"low":{"coding":0.2554347826086957,"general":0.14606741573033707},"medium":{"coding":0.2554347826086957,"general":0.14606741573033707},"high":{"coding":0.2554347826086957,"general":0.14606741573033707}},
  "google/gemma-4-26b-a4b-it:free": {"low":{"coding":0.5380434782608695,"general":0.33707865168539325},"medium":{"coding":0.5380434782608695,"general":0.33707865168539325},"high":{"coding":0.5380434782608695,"general":0.33707865168539325}},
  "google/gemma-4-31b-it": {"low":{"coding":0.592391304347826,"general":0.29775280898876405},"medium":{"coding":0.592391304347826,"general":0.29775280898876405},"high":{"coding":0.592391304347826,"general":0.29775280898876405}},
  "google/gemma-4-31b-it:free": {"low":{"coding":0.592391304347826,"general":0.29775280898876405},"medium":{"coding":0.592391304347826,"general":0.29775280898876405},"high":{"coding":0.592391304347826,"general":0.29775280898876405}},
  "google/gemma3-270m:free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "google/lyria-3-clip-preview": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "google/lyria-3-pro-preview": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "groq/compound": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "groq/compound-mini": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "kilo-auto/free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "liquid/lfm-2.5-2.6b:free": {"low":{"coding":0.08152173913043478,"general":0.07865168539325842},"medium":{"coding":0.08152173913043478,"general":0.07865168539325842},"high":{"coding":0.08152173913043478,"general":0.07865168539325842}},
  "llama-3.1-8b-instant": {"low":{"coding":0.06521739130434782,"general":0.07865168539325842},"medium":{"coding":0.06521739130434782,"general":0.07865168539325842},"high":{"coding":0.06521739130434782,"general":0.07865168539325842}},
  "llama-3.3-70b-versatile": {"low":{"coding":0.14673913043478262,"general":0.07865168539325842},"medium":{"coding":0.14673913043478262,"general":0.07865168539325842},"high":{"coding":0.14673913043478262,"general":0.07865168539325842}},
  "longcat-2.5-preview-free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "lyria-3-clip-preview": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "lyria-3-pro-preview": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "meta-llama/llama-4-scout-17b-16e-instruct": {"low":{"coding":0.10326086956521739,"general":0.07303370786516854},"medium":{"coding":0.10326086956521739,"general":0.07303370786516854},"high":{"coding":0.10326086956521739,"general":0.07303370786516854}},
  "meta-llama/llama-prompt-guard-2-22m": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "meta-llama/llama-prompt-guard-2-86m": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "meta/llama-3.2-11b-vision-instruct": {"low":{"coding":0.033707865168539325,"general":0.033707865168539325},"medium":{"coding":0.033707865168539325,"general":0.033707865168539325},"high":{"coding":0.033707865168539325,"general":0.033707865168539325}},
  "meta/llama-3.2-90b-vision-instruct": {"low":{"coding":0.06741573033707865,"general":0.06741573033707865},"medium":{"coding":0.06741573033707865,"general":0.06741573033707865},"high":{"coding":0.06741573033707865,"general":0.06741573033707865}},
  "meta/muse-glimmer-30b": {"low":{"coding":0.657608695652174,"general":0.34269662921348315},"medium":{"coding":0.657608695652174,"general":0.34269662921348315},"high":{"coding":0.657608695652174,"general":0.34269662921348315}},
  "mimo-v2.6-flash-free": {"low":{"coding":0.8796875,"general":0.7584269662921348},"medium":{"coding":0.8484375,"general":0.7247191011235955},"high":{"coding":0.8171875,"general":0.7247191011235955}},
  "mistral-medium-3-5": {"low":{"coding":0.6358695652173914,"general":0.28651685393258425},"medium":{"coding":0.6358695652173914,"general":0.28651685393258425},"high":{"coding":0.6358695652173914,"general":0.28651685393258425}},
  "nemotron-3.5-lightning-free": {"low":{"coding":0.42934782608695654,"general":0.2640449438202247},"medium":{"coding":0.41847826086956524,"general":0.2640449438202247},"high":{"coding":0.4076086956521739,"general":0.2640449438202247}},
  "nemotron-3.5-super-vl-free": {"low":{"coding":0.18,"general":0.5898876404494382},"medium":{"coding":0.18,"general":0.5674157303370787},"high":{"coding":0.18,"general":0.5674157303370787}},
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {"low":{"coding":0.15760869565217392,"general":0.15730337078651685},"medium":{"coding":0.15760869565217392,"general":0.15730337078651685},"high":{"coding":0.15760869565217392,"general":0.15730337078651685}},
  "nvidia/nemotron-3-super-120b-a12b:free": {"low":{"coding":0.5108695652173914,"general":0.25842696629213485},"medium":{"coding":0.5108695652173914,"general":0.25842696629213485},"high":{"coding":0.5108695652173914,"general":0.25842696629213485}},
  "nvidia/nemotron-3-ultra-550b-a55b:free": {"low":{"coding":0.6197548326261197,"general":0.4550561797752809},"medium":{"coding":0.6197548326261197,"general":0.4438202247191011},"high":{"coding":0.6148043375766148,"general":0.4438202247191011}},
  "nvidia/nemotron-3.5-content-safety:free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "nvidia/nemotron-3.5-lightning-30b-a3b": {"low":{"coding":0.42934782608695654,"general":0.2640449438202247},"medium":{"coding":0.41847826086956524,"general":0.2640449438202247},"high":{"coding":0.4076086956521739,"general":0.2640449438202247}},
  "nvidia/nemotron-3.5-lightning:free": {"low":{"coding":0.42934782608695654,"general":0.2640449438202247},"medium":{"coding":0.41847826086956524,"general":0.2640449438202247},"high":{"coding":0.4076086956521739,"general":0.2640449438202247}},
  "nvidia/nemotron-3.5-super-vl-120b-a12b": {"low":{"coding":0.18,"general":0.5898876404494382},"medium":{"coding":0.18,"general":0.5674157303370787},"high":{"coding":0.18,"general":0.5674157303370787}},
  "nvidia/nemotron-3.5-super-vl:free": {"low":{"coding":0.18,"general":0.5898876404494382},"medium":{"coding":0.18,"general":0.5674157303370787},"high":{"coding":0.18,"general":0.5674157303370787}},
  "openai/gpt-oss-120b": {"low":{"coding":0.16336633663366337,"general":0.15730337078651685},"medium":{"coding":0.16336633663366337,"general":0.16853932584269662},"high":{"coding":0.16336633663366337,"general":0.21910112359550563}},
  "openai/gpt-oss-20b": {"low":{"coding":0.13786915504511896,"general":0.15730337078651685},"medium":{"coding":0.13786915504511896,"general":0.14606741573033707},"high":{"coding":0.13786915504511896,"general":0.10674157303370786}},
  "openai/gpt-oss-safeguard-20b": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "openrouter/free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "poolside/laguna-s-2.1:free": {"low":{"coding":0.38,"general":0.38},"medium":{"coding":0.38,"general":0.38},"high":{"coding":0.38,"general":0.38}},
  "poolside/laguna-xs-2.1": {"low":{"coding":0.2966981132075472,"general":0.2966981132075472},"medium":{"coding":0.2966981132075472,"general":0.2966981132075472},"high":{"coding":0.2966981132075472,"general":0.2966981132075472}},
  "poolside/laguna-xs-2.1:free": {"low":{"coding":0.2966981132075472,"general":0.2966981132075472},"medium":{"coding":0.2966981132075472,"general":0.2966981132075472},"high":{"coding":0.2966981132075472,"general":0.2966981132075472}},
  "qwen/qwen3-32b": {"low":{"coding":0.21739130434782608,"general":0.07865168539325842},"medium":{"coding":0.21739130434782608,"general":0.07865168539325842},"high":{"coding":0.21739130434782608,"general":0.07865168539325842}},
  "qwen/qwen3.6-27b": {"low":{"coding":0.7380952380952381,"general":0.398876404494382},"medium":{"coding":0.7380952380952381,"general":0.398876404494382},"high":{"coding":0.7380952380952381,"general":0.398876404494382}},
  "qwen/qwen3.8-27b": {"low":{"coding":0.5931521739130434,"general":0.5674157303370787},"medium":{"coding":0.5822826086956522,"general":0.601123595505618},"high":{"coding":0.635,"general":0.6573033707865169}},
  "recursive/flint-v1.0:free": {"low":{"coding":0.44811881188118813,"general":0.44811881188118813},"medium":{"coding":0.44811881188118813,"general":0.44811881188118813},"high":{"coding":0.44811881188118813,"general":0.44811881188118813}},
  "reflection/beam-free": {"low":{"coding":0.7,"general":0.7},"medium":{"coding":0.7,"general":0.7},"high":{"coding":0.7,"general":0.7}},
  "space-bunny-free": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "stealth/glyph-cluster": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "stepfun-ai/step-5-preview": {"low":{"coding":0.8820224719101124,"general":0.8820224719101124},"medium":{"coding":0.848314606741573,"general":0.848314606741573},"high":{"coding":0.8370786516853933,"general":0.8370786516853933}},
  "thinkingmachines/inkling-small:free": {"low":{"coding":0.7397653895824365,"general":0.5337078651685393},"medium":{"coding":0.7397653895824365,"general":0.5224719101123596},"high":{"coding":0.7397653895824365,"general":0.5224719101123596}},
  "thinkingmachines/inkling:free": {"low":{"coding":0.6902173913043478,"general":0.4887640449438202},"medium":{"coding":0.6902173913043478,"general":0.47752808988764045},"high":{"coding":0.6902173913043478,"general":0.47752808988764045}},
  "whisper-large-v3": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "whisper-large-v3-turbo": {"low":{"coding":null,"general":null},"medium":{"coding":null,"general":null},"high":{"coding":null,"general":null}},
  "xingchen-agi/xing4.0-29b-a4b:free": {"low":{"coding":0.3251060820367751,"general":0.3251060820367751},"medium":{"coding":0.3251060820367751,"general":0.3251060820367751},"high":{"coding":0.3251060820367751,"general":0.3251060820367751}},
  "z-ai/glm-5.3": {"low":{"coding":0.94,"general":0.7134831460674157},"medium":{"coding":0.94,"general":0.7584269662921348},"high":{"coding":0.94,"general":0.7584269662921348}},
  "z-ai/glm-5.3-flash": {"low":{"coding":0.82,"general":0.8258426966292135},"medium":{"coding":0.82,"general":0.8258426966292135},"high":{"coding":0.82,"general":0.8146067415730337}}
};

export function getBenchmarkConsensusFitness(
  model: string,
  taskType: string,
  profile: BandFitnessProfile
): number | null {
  let task: "coding" | "general" | null = null;
  if (taskType === "default" || taskType === "general") {
    task = "general";
  } else if (taskType === "coding") {
    task = "coding";
  }
  if (!task) return null;
  return BENCHMARK_CONSENSUS_FITNESS[model.toLowerCase()]?.[profile]?.[task] ?? null;
}
